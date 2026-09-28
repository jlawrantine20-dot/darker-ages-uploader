/**
 * Notifications on sellers' phones: a new customer message, a new order, a payment. Every
 * member of the shop who turned notifications on gets them, in the language their app is in.
 * Sending never holds up or breaks the chat: failures are logged and dead subscriptions removed.
 */
import { sendWebPush, type PushSubscriptionKeys } from '../channels/webpush.js';
import { formatMoney } from '../domain/money.js';
import { productLabel } from '../domain/copy.js';
import type { Ctx } from './context.js';
import type { UiLang } from './errors.js';

export interface Notice {
  title: string;
  body: string;
  /** Where tapping it opens the app, e.g. "#/chat/<id>". */
  url: string;
  /** Notifications with the same tag replace each other, so one chat doesn't pile up. */
  tag: string;
}

export const pushEnabled = (ctx: Ctx) => !!(ctx.config.push.publicKey && ctx.config.push.privateKey);

export async function saveSubscription(ctx: Ctx, userId: string, sub: PushSubscriptionKeys, lang: UiLang) {
  await ctx.db.query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth, lang) values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang`,
    [userId, sub.endpoint, sub.p256dh, sub.auth, lang],
  );
}

export async function removeSubscription(ctx: Ctx, userId: string, endpoint: string) {
  await ctx.db.query('delete from push_subscriptions where user_id = $1 and endpoint = $2', [userId, endpoint]);
}

/** Send a notice to every subscribed member of a shop. */
export async function notifyShop(ctx: Ctx, sellerId: string, build: (lang: UiLang) => Notice): Promise<number> {
  if (!pushEnabled(ctx)) return 0;
  try {
    const subs = await ctx.db.query<PushSubscriptionKeys & { id: string; lang: UiLang }>(
      `select s.id, s.endpoint, s.p256dh, s.auth, s.lang from push_subscriptions s
         join shop_members m on m.user_id = s.user_id where m.seller_id = $1`,
      [sellerId],
    );
    let sent = 0;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          const status = await sendWebPush(sub, { ...build(sub.lang), sellerId }, ctx.config.push, ctx.fetch ?? fetch);
          if (status === 404 || status === 410) await ctx.db.query('delete from push_subscriptions where id = $1', [sub.id]);
          else if (status < 300) sent++;
          else console.error(`Push to ${new URL(sub.endpoint).host} failed (${status})`);
        } catch (err) {
          console.error('Push failed', err);
        }
      }),
    );
    return sent;
  } catch (err) {
    console.error('Push failed', err);
    return 0;
  }
}

const cut = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A customer wrote. The title is who, the body what they said. */
export const messageNotice = (who: string, text: string, contactId: string) => (): Notice => ({
  title: who,
  body: cut(text),
  url: `#/chat/${contactId}`,
  tag: `chat-${contactId}`,
});

interface Money { minor: number; currency: string; country: string }
const amount = (m: Money, lang: UiLang) => formatMoney(m.minor, m.currency, lang, m.country);
const item = (p: { name: string; variant: string }, quantity: number, lang: UiLang) => `${quantity > 1 ? `${quantity} × ` : ''}${productLabel(p, lang)}`;

/** A customer ordered in the chat. */
export const orderNotice = (who: string, p: { name: string; variant: string }, quantity: number, m: Money) => (lang: UiLang): Notice => ({
  title: lang === 'fr' ? 'Nouvelle commande' : 'New order',
  body: `${who} · ${item(p, quantity, lang)} · ${amount(m, lang)}`,
  url: '#/orders',
  tag: 'orders',
});

/** Money came in, or came in too late and needs refunding. */
export const paymentNotice = (who: string, p: { name: string; variant: string }, quantity: number, m: Money, refund = false) => (lang: UiLang): Notice => ({
  title: refund ? (lang === 'fr' ? 'Remboursement à faire' : 'Refund to send') : lang === 'fr' ? 'Paiement reçu' : 'Payment received',
  body: `${who} · ${item(p, quantity, lang)} · ${amount(m, lang)}`,
  url: refund ? '#/insights' : '#/orders',
  tag: `pay-${Date.now()}`,
});
