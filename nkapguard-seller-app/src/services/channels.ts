/**
 * Connecting a shop's own Instagram professional account or Facebook Page. Both are optional:
 * a shop connects only the ones it sells on, and can pause or disconnect them at any time.
 *
 * Instagram uses Instagram Login (no Facebook Page needed); Messenger uses Facebook Login and
 * lets the seller pick one of their Pages. Tokens are stored encrypted, like payment keys.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SocialChannel } from '../channels/meta.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Config } from '../config.js';
import type { Ctx } from './context.js';
import { InputError, uiLang, type UiLang } from './errors.js';

export const CHANNEL_NAMES: Record<SocialChannel, string> = { instagram: 'Instagram', facebook: 'Messenger' };

const IG_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'];
const FB_SCOPES = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'];
const STATE_TTL_MS = 15 * 60_000;

/** Where the seller app lives: its own host, or /app on the API when served together. */
export const appBase = (config: Config) => (config.appUrl || `${config.publicUrl.replace(/\/$/, '')}/app`).replace(/\/$/, '');
export const redirectUri = (config: Config, channel: SocialChannel) => `${config.publicUrl.replace(/\/$/, '')}/oauth/${channel}`;

export function channelAvailable(config: Config, channel: SocialChannel): boolean {
  return channel === 'instagram' ? !!(config.meta.igAppId && config.meta.igAppSecret) : !!(config.meta.appId && config.meta.appSecret);
}

// The sign-in round trip carries which shop is connecting, signed so it can't be swapped.
function sign(config: Config, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', `oauth-state:${config.appSecret}`).update(body).digest('base64url');
  return `${body}.${mac}`;
}
/** The app language the seller started a connection in, so the result is shown in it. Only a display hint, so unchecked. */
export function stateLang(state: string | undefined): UiLang {
  try {
    return uiLang(JSON.parse(Buffer.from((state ?? '').split('.')[0], 'base64url').toString()).l);
  } catch {
    return 'en';
  }
}
function unsign<T>(config: Config, state: string | undefined): T {
  const [body, mac] = (state ?? '').split('.');
  const expected = createHmac('sha256', `oauth-state:${config.appSecret}`).update(body ?? '').digest();
  const given = Buffer.from(mac ?? '', 'base64url');
  if (!body || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new InputError('oauth_invalid');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { e: number };
  if (payload.e < Date.now()) throw new InputError('oauth_expired');
  return payload;
}

/** The Instagram or Facebook sign-in page for a shop. */
export function connectUrl(ctx: Ctx, channel: SocialChannel, sellerId: string, lang: UiLang = 'en', startedBy: string | null = null): string {
  const { config } = ctx;
  if (!channelAvailable(config, channel)) throw new InputError('channel_unavailable', { channel: CHANNEL_NAMES[channel] });
  // u: who pressed Connect. Only they can confirm the result (see confirmPending).
  const state = sign(config, { s: sellerId, c: channel, e: Date.now() + STATE_TTL_MS, l: lang, u: startedBy });
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  if (channel === 'instagram') {
    return `https://www.instagram.com/oauth/authorize?${q({ client_id: config.meta.igAppId, redirect_uri: redirectUri(config, channel), response_type: 'code', scope: IG_SCOPES.join(','), state })}`;
  }
  return `https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth?${q({ client_id: config.meta.appId, redirect_uri: redirectUri(config, channel), response_type: 'code', scope: FB_SCOPES.join(','), state })}`;
}

async function getJson(ctx: Ctx, url: string, init?: RequestInit): Promise<any> {
  const res = await (ctx.fetch ?? fetch)(url, init);
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json.error) {
    const why = json.error?.message ?? json.error_message ?? `HTTP ${res.status}`;
    throw new InputError('meta_refused', { why });
  }
  return json;
}

async function saveAccount(
  ctx: Ctx, sellerId: string,
  a: { channel: SocialChannel; externalId: string; name: string | null; username: string | null; token: string; expiresAt: Date | null },
) {
  const [other] = await ctx.db.query<{ seller_id: string }>('select seller_id from channel_accounts where channel = $1 and external_id = $2', [a.channel, a.externalId]);
  if (other && other.seller_id !== sellerId) throw new InputError('channel_taken', { channel: CHANNEL_NAMES[a.channel] });
  // One account per channel per shop: connecting a new one replaces the old.
  await ctx.db.query('delete from channel_accounts where seller_id = $1 and channel = $2 and external_id <> $3', [sellerId, a.channel, a.externalId]);
  await ctx.db.query(
    `insert into channel_accounts (seller_id, channel, external_id, name, username, token_enc, token_expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (channel, external_id) do update
       set name = excluded.name, username = excluded.username, token_enc = excluded.token_enc,
           token_expires_at = excluded.token_expires_at, enabled = true, connected_at = now()`,
    [sellerId, a.channel, a.externalId, a.name, a.username, encryptSecret(a.token, ctx.config.appSecret), a.expiresAt],
  );
}

/** Park a finished sign-in until the person who started it confirms it in the app. */
async function hold(ctx: Ctx, sellerId: string, kind: SocialChannel, startedBy: string | null, data: unknown): Promise<string> {
  const [row] = await ctx.db.query<{ id: string }>(
    'insert into channel_pending (seller_id, kind, started_by, pages_enc, expires_at) values ($1, $2, $3, $4, $5) returning id',
    [sellerId, kind, startedBy, encryptSecret(JSON.stringify(data), ctx.config.appSecret), new Date(Date.now() + STATE_TTL_MS)],
  );
  return row.id;
}

interface IgAccount { externalId: string; name: string | null; username: string | null; token: string; expiresAt: string | null }

/**
 * Instagram sign-in came back: swap the code for a 60-day token. The account is held until
 * the seller confirms it in the app; see confirmPending.
 */
export async function completeInstagram(ctx: Ctx, code: string, state: string): Promise<{ sellerId: string; pendingId: string }> {
  const { config } = ctx;
  const { s: sellerId, u: startedBy } = unsign<{ s: string; u?: string | null }>(config, state);
  const short = await getJson(ctx, 'https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: config.meta.igAppId, client_secret: config.meta.igAppSecret, grant_type: 'authorization_code', redirect_uri: redirectUri(config, 'instagram'), code }),
  });
  const shortToken: string = short.access_token ?? short.data?.[0]?.access_token;
  const long = await getJson(ctx, `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: config.meta.igAppSecret, access_token: shortToken })}`);
  const token: string = long.access_token;
  const v = config.meta.graphVersion;
  const me = await getJson(ctx, `https://graph.instagram.com/${v}/me?fields=user_id,username,name&access_token=${encodeURIComponent(token)}`);
  // Say it now, rather than after the seller confirms, if another shop already has this account.
  const [other] = await ctx.db.query<{ seller_id: string }>(`select seller_id from channel_accounts where channel = 'instagram' and external_id = $1`, [String(me.user_id)]);
  if (other && other.seller_id !== sellerId) throw new InputError('channel_taken', { channel: CHANNEL_NAMES.instagram });
  const account: IgAccount = {
    externalId: String(me.user_id), name: me.name ?? null, username: me.username ?? null, token,
    expiresAt: long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() : null,
  };
  return { sellerId, pendingId: await hold(ctx, sellerId, 'instagram', startedBy ?? null, account) };
}

interface Page { id: string; name: string; access_token: string }

async function connectPage(ctx: Ctx, sellerId: string, page: Page) {
  const v = ctx.config.meta.graphVersion;
  await getJson(ctx, `https://graph.facebook.com/${v}/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed&access_token=${encodeURIComponent(page.access_token)}`, { method: 'POST' });
  // Page tokens from a long-lived user token don't expire.
  await saveAccount(ctx, sellerId, { channel: 'facebook', externalId: page.id, name: page.name, username: null, token: page.access_token, expiresAt: null });
}

/** Facebook sign-in came back. The Pages are held until the seller confirms one in the app. */
export async function completeFacebook(ctx: Ctx, code: string, state: string): Promise<{ sellerId: string; pendingId: string }> {
  const { config } = ctx;
  const { s: sellerId, u: startedBy } = unsign<{ s: string; u?: string | null }>(config, state);
  const v = config.meta.graphVersion;
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const short = await getJson(ctx, `https://graph.facebook.com/${v}/oauth/access_token?${q({ client_id: config.meta.appId, client_secret: config.meta.appSecret, redirect_uri: redirectUri(config, 'facebook'), code })}`);
  const long = await getJson(ctx, `https://graph.facebook.com/${v}/oauth/access_token?${q({ grant_type: 'fb_exchange_token', client_id: config.meta.appId, client_secret: config.meta.appSecret, fb_exchange_token: short.access_token })}`);
  const pages: Page[] = (await getJson(ctx, `https://graph.facebook.com/${v}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(long.access_token)}`)).data ?? [];
  if (!pages.length) throw new InputError('no_pages');
  return { sellerId, pendingId: await hold(ctx, sellerId, 'facebook', startedBy ?? null, pages) };
}

/**
 * A held sign-in, for the person who started it only. Anyone else (another member, or a
 * seller who was sent someone else's Connect link) sees nothing.
 */
async function pending(ctx: Ctx, pendingId: string, sellerId: string, viewerUserId: string | null) {
  const [row] = await ctx.db.query<{ kind: SocialChannel; started_by: string | null; pages_enc: string }>(
    'select kind, started_by, pages_enc from channel_pending where id = $1 and seller_id = $2 and expires_at > now()',
    [pendingId, sellerId],
  );
  if (!row || (row.started_by ?? null) !== viewerUserId) throw new InputError('page_choice_expired');
  return { kind: row.kind, data: JSON.parse(decryptSecret(row.pages_enc, ctx.config.appSecret)) as Page[] | IgAccount };
}

/** What the sign-in found, without tokens: the Instagram account, or the Pages to choose from. */
export async function describePending(ctx: Ctx, pendingId: string, sellerId: string, viewerUserId: string | null) {
  const p = await pending(ctx, pendingId, sellerId, viewerUserId);
  if (p.kind === 'instagram') {
    const a = p.data as IgAccount;
    return { channel: 'instagram' as const, account: { name: a.name, username: a.username } };
  }
  return { channel: 'facebook' as const, pages: (p.data as Page[]).map((x) => ({ id: x.id, name: x.name })) };
}

/** The seller confirms in the app: connect the Instagram account, or the Page they picked. */
export async function confirmPending(ctx: Ctx, pendingId: string, sellerId: string, viewerUserId: string | null, pageId?: string) {
  const p = await pending(ctx, pendingId, sellerId, viewerUserId);
  if (p.kind === 'instagram') {
    const a = p.data as IgAccount;
    await getJson(ctx, `https://graph.instagram.com/${ctx.config.meta.graphVersion}/me/subscribed_apps?subscribed_fields=messages,comments&access_token=${encodeURIComponent(a.token)}`, { method: 'POST' });
    await saveAccount(ctx, sellerId, { channel: 'instagram', externalId: a.externalId, name: a.name, username: a.username, token: a.token, expiresAt: a.expiresAt ? new Date(a.expiresAt) : null });
  } else {
    const pages = p.data as Page[];
    const page = pageId ? pages.find((x) => x.id === pageId) : pages.length === 1 ? pages[0] : undefined;
    if (!page) throw new InputError('pick_listed_page');
    await connectPage(ctx, sellerId, page);
  }
  await ctx.db.query('delete from channel_pending where id = $1', [pendingId]);
  return p.kind;
}

/**
 * Instagram tokens last 60 days. Refresh any that expire within a week (Instagram allows it
 * once a token is a day old). Run from the scheduler; failures are logged, not thrown.
 */
export async function refreshInstagramTokens(ctx: Ctx, now: Date): Promise<number> {
  const due = await ctx.db.query<{ id: string; token_enc: string }>(
    `select id, token_enc from channel_accounts where channel = 'instagram' and token_expires_at is not null and token_expires_at < $1`,
    [new Date(now.getTime() + 7 * 24 * 3600_000)],
  );
  let refreshed = 0;
  for (const a of due) {
    try {
      const token = decryptSecret(a.token_enc, ctx.config.appSecret);
      const r = await getJson(ctx, `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
      await ctx.db.query('update channel_accounts set token_enc = $2, token_expires_at = $3 where id = $1', [
        a.id, encryptSecret(r.access_token, ctx.config.appSecret), new Date(now.getTime() + Number(r.expires_in) * 1000),
      ]);
      refreshed++;
    } catch (err) {
      console.error(`Instagram token refresh failed for account ${a.id}: ${(err as Error).message}`);
    }
  }
  return refreshed;
}

/**
 * Meta's signed_request: "<signature>.<payload>", both base64url, signed with the app secret
 * (the Meta app's, or Instagram's for Instagram Login). Returns the payload, or null if no
 * secret we hold signed it.
 */
export function parseSignedRequest(signed: string | undefined, secrets: string[]): { user_id?: string } | null {
  const [sig, payload] = (signed ?? '').split('.');
  if (!sig || !payload) return null;
  const given = Buffer.from(sig, 'base64url');
  const ok = secrets.filter(Boolean).some((s) => {
    const expected = createHmac('sha256', s).update(payload).digest();
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}

/**
 * A person asked Meta to delete their data, or removed the app from their Instagram or
 * Facebook account. Delete their chats with every shop (messages, consents and waitlist places
 * go with them) and any account of theirs a shop connected. Returns how many records went.
 */
export async function deleteMetaUser(ctx: Ctx, userId: string): Promise<number> {
  const chats = await ctx.db.query(`delete from contacts where channel in ('instagram', 'facebook') and wa_id = $1 returning id`, [userId]);
  const accounts = await ctx.db.query('delete from channel_accounts where external_id = $1 returning id', [userId]);
  return chats.length + accounts.length;
}
