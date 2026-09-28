/**
 * Instagram DMs (Instagram API with Instagram Login) and Facebook Messenger (Messenger
 * Platform). Both only allow replies within 24 hours of the customer's last message and have
 * no templates, so they are for answering and capturing; restock alerts go out on WhatsApp.
 */
import type { SendResult } from './whatsapp.js';

export type SocialChannel = 'instagram' | 'facebook';

/** A connected account, with its token already decrypted. */
export interface SocialAccount {
  channel: SocialChannel;
  /** Instagram professional account id, or Facebook Page id. */
  externalId: string;
  token: string;
}

/** Who a message goes to: a person in a chat, or a comment to answer privately. */
export type SocialTarget = { userId: string } | { commentId: string };

export interface SocialSender {
  send(account: SocialAccount, to: SocialTarget, text: string): Promise<SendResult>;
  /** A photo in a chat (not in a comment reply, which is text only). */
  sendImage(account: SocialAccount, to: { userId: string }, imageUrl: string): Promise<SendResult>;
  /** The person's display name and handle, when the platform shares them. */
  profile(account: SocialAccount, userId: string): Promise<{ name: string | null; username: string | null }>;
}

export interface SocialSentRecord {
  channel: SocialChannel;
  account: string;
  to: SocialTarget;
  text: string;
  imageUrl?: string;
}

/** Records instead of sending. Used in tests and test mode. */
export class DryRunSocial implements SocialSender {
  sent: SocialSentRecord[] = [];
  private n = 0;
  constructor(private onSend?: (m: SocialSentRecord) => void) {}
  async send(account: SocialAccount, to: SocialTarget, text: string) {
    const m = { channel: account.channel, account: account.externalId, to, text };
    this.sent.push(m);
    this.onSend?.(m);
    return { providerId: `dry-social-${++this.n}` };
  }
  async sendImage(account: SocialAccount, to: { userId: string }, imageUrl: string) {
    const m = { channel: account.channel, account: account.externalId, to, text: '', imageUrl };
    this.sent.push(m);
    this.onSend?.(m);
    return { providerId: `dry-social-${++this.n}` };
  }
  async profile() {
    return { name: null, username: null };
  }
}

const recipient = (to: SocialTarget) => ('commentId' in to ? { comment_id: to.commentId } : { id: to.userId });

export function metaGraph(opts: { version: string; fetchFn?: typeof fetch }): SocialSender {
  const f = opts.fetchFn ?? fetch;
  const base = (a: SocialAccount) => (a.channel === 'instagram' ? 'https://graph.instagram.com' : 'https://graph.facebook.com');
  const call = async (url: string, token: string, init?: RequestInit) => {
    const res = await f(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    const json = (await res.json().catch(() => ({}))) as any;
    return { res, json };
  };
  return {
    async send(account, to, text) {
      const body = account.channel === 'facebook'
        ? { recipient: recipient(to), messaging_type: 'RESPONSE', message: { text } }
        : { recipient: recipient(to), message: { text } };
      const { res, json } = await call(`${base(account)}/${opts.version}/${account.externalId}/messages`, account.token, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok || !json.message_id) {
        const where = account.channel === 'instagram' ? 'Instagram' : 'Messenger';
        throw new Error(`${where} send failed (${res.status}): ${json.error?.message ?? 'no message id returned'}`);
      }
      return { providerId: json.message_id };
    },
    async sendImage(account, to, imageUrl) {
      const message = { attachment: { type: 'image', payload: { url: imageUrl } } };
      const body = account.channel === 'facebook' ? { recipient: { id: to.userId }, messaging_type: 'RESPONSE', message } : { recipient: { id: to.userId }, message };
      const { res, json } = await call(`${base(account)}/${opts.version}/${account.externalId}/messages`, account.token, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok || !json.message_id) throw new Error(`Photo not sent (${res.status}): ${json.error?.message ?? 'no message id returned'}`);
      return { providerId: json.message_id };
    },
    async profile(account, userId) {
      const fields = account.channel === 'instagram' ? 'name,username' : 'first_name,last_name';
      const { res, json } = await call(`${base(account)}/${opts.version}/${userId}?fields=${fields}`, account.token);
      if (!res.ok) return { name: null, username: null };
      if (account.channel === 'instagram') return { name: json.name ?? null, username: json.username ?? null };
      const name = [json.first_name, json.last_name].filter(Boolean).join(' ');
      return { name: name || null, username: null };
    },
  };
}

export interface SocialInbound {
  channel: SocialChannel;
  /** The shop's account the message was sent to. */
  accountId: string;
  from: string;
  /** Instagram gives the commenter's handle; DMs carry no name. */
  username?: string;
  name?: string;
  text: string;
  providerId: string;
  at: Date;
  /** Set for a comment on a post: answered with one private reply. */
  comment?: { id: string; postId: string };
}

/**
 * Customer DMs and comments out of an Instagram (object "instagram") or Page (object "page")
 * webhook. The shop's own messages and comments (echoes) are skipped.
 */
export function parseMetaWebhook(body: unknown): SocialInbound[] {
  const b = body as { object?: string; entry?: any[] };
  const channel: SocialChannel | null = b?.object === 'instagram' ? 'instagram' : b?.object === 'page' ? 'facebook' : null;
  if (!channel) return [];
  const out: SocialInbound[] = [];
  for (const entry of b.entry ?? []) {
    const accountId = String(entry.id ?? '');
    for (const m of entry.messaging ?? []) {
      const text: string | undefined = m.message?.text ?? m.postback?.title;
      if (!text || m.message?.is_echo || !m.sender?.id || m.sender.id === accountId) continue;
      out.push({
        channel, accountId, from: String(m.sender.id), text,
        providerId: m.message?.mid ?? m.postback?.mid ?? `${accountId}-${m.timestamp}`,
        at: new Date(Number(m.timestamp) || Date.now()),
      });
    }
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (channel === 'instagram' && change.field === 'comments') {
        if (!v.id || !v.text || !v.from?.id || v.from.id === accountId) continue;
        out.push({
          channel, accountId, from: String(v.from.id), username: v.from.username, text: v.text, providerId: `comment-${v.id}`,
          at: new Date((Number(entry.time) || Date.now() / 1000) * (Number(entry.time) > 1e12 ? 1 : 1000)),
          comment: { id: String(v.id), postId: String(v.media?.id ?? '') },
        });
      }
      if (channel === 'facebook' && change.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
        if (!v.comment_id || !v.message || !v.from?.id || v.from.id === accountId) continue;
        out.push({
          channel, accountId, from: String(v.from.id), name: v.from.name, text: v.message, providerId: `comment-${v.comment_id}`,
          at: new Date((Number(v.created_time) || Date.now() / 1000) * 1000),
          comment: { id: String(v.comment_id), postId: String(v.post_id ?? '') },
        });
      }
    }
  }
  return out;
}
