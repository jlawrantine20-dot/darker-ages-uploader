/**
 * One polite reminder for a sale that stalled:
 *  - quiet: we said "in stock, reply YES to order" and the customer went silent;
 *  - order_expired: their order's one-hour hold ran out unpaid.
 * It only goes out inside the 24-hour reply window (so it's a plain reply, not a paid
 * template), never at night in the shop's time zone, never twice for the same item in a week,
 * and never once the seller has stepped into the chat, the customer ordered, or asked to stop.
 */
import { say } from '../domain/copy.js';
import type { Ctx, DispatchResult, Outbound, Recipient } from './context.js';
import { freeStock } from './inbound.js';
import { dispatch } from './outbound.js';
import { photoUrl } from './photos.js';
import { fmt, type Seller } from './sellers.js';

/** How long after the "in stock" answer the reminder goes out. */
export const QUIET_AFTER_MS = 3 * 60 * 60 * 1000;
/** Keep an hour of the 24-hour window spare, so a reply to the reminder can still be answered. */
const WINDOW_LEFT_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** No reminders between 21:00 and 08:00, shop time. */
const QUIET_HOURS = { from: 21, to: 8 };

export function daytime(now: Date, timezone: string): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(now));
  return hour >= QUIET_HOURS.to && hour < QUIET_HOURS.from;
}

interface Candidate {
  contact_id: string;
  product_id: string;
  wa_id: string;
  name: string | null;
  channel: string;
  channel_account_id: string | null;
  last_inbound_at: Date;
  language: 'en' | 'fr' | null;
  seller_id: string;
}

// Shared conditions: the shop wants follow-ups, the window is still open, the customer hasn't
// said STOP, and there's no reminder for this item in the last week.
const COMMON = `
  s.follow_ups
  and c.last_inbound_at > $2
  and not exists (select 1 from consents k where k.contact_id = c.id and k.revoked_at is not null)
  and not exists (select 1 from follow_ups f where f.contact_id = c.id and f.product_id = %PRODUCT% and f.sent_at > $3)`;

export async function runFollowUps(ctx: Ctx, now: Date): Promise<DispatchResult[]> {
  const windowStart = new Date(now.getTime() - DAY_MS + WINDOW_LEFT_MS);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  // Silent since our "in stock, reply YES" answer, and nothing else happened in the chat since.
  const quiet = await ctx.db.query<Candidate>(
    `select c.id as contact_id, c.awaiting_order_product_id as product_id, c.wa_id, c.name, c.channel, c.channel_account_id,
            c.last_inbound_at, c.language, c.seller_id
       from contacts c join sellers s on s.id = c.seller_id
      where c.awaiting_order_product_id is not null
        and c.awaiting_order_at <= $1
        and c.last_inbound_at <= c.awaiting_order_at
        and not exists (select 1 from messages m where m.contact_id = c.id and m.created_at > c.awaiting_order_at + interval '5 seconds')
        and not exists (select 1 from orders o where o.contact_id = c.id and o.created_at >= c.awaiting_order_at)
        and ${COMMON.replace('%PRODUCT%', 'c.awaiting_order_product_id')}`,
    [new Date(now.getTime() - QUIET_AFTER_MS), windowStart, weekAgo],
  );

  // Orders whose hold ran out in the last half hour, with no newer order or message since.
  const expired = await ctx.db.query<Candidate>(
    `select distinct on (c.id, o.product_id) c.id as contact_id, o.product_id, c.wa_id, c.name, c.channel, c.channel_account_id,
            c.last_inbound_at, c.language, c.seller_id
       from orders o join contacts c on c.id = o.contact_id join sellers s on s.id = c.seller_id
      where o.status = 'expired' and o.expires_at > $1 and o.expires_at <= $4
        and not exists (select 1 from orders n where n.contact_id = c.id and n.created_at > o.created_at)
        and not exists (select 1 from messages m where m.contact_id = c.id and m.direction = 'in' and m.created_at > o.expires_at)
        and ${COMMON.replace('%PRODUCT%', 'o.product_id')}
      order by c.id, o.product_id, o.expires_at desc`,
    [new Date(now.getTime() - 30 * 60_000), windowStart, weekAgo, now],
  );

  const outs: Outbound[] = [];
  for (const [kind, rows] of [['quiet', quiet], ['order_expired', expired]] as const) {
    for (const r of rows) {
      const [seller] = await ctx.db.query<Seller>('select * from sellers where id = $1', [r.seller_id]);
      if (!daytime(now, seller.timezone)) continue;
      const [product] = await ctx.db.query<{ id: string; name: string; variant: string; price_minor: number; photo_version: string | null }>('select * from products where id = $1', [r.product_id]);
      if (!product) continue;
      const free = await freeStock(ctx.db, product.id);
      if (free <= 0) continue;
      const whatsapp = r.channel === 'whatsapp';
      if (!whatsapp && !r.channel_account_id) continue;
      const lang = r.language ?? seller.language;
      const to: Recipient = {
        sellerId: seller.id, from: whatsapp ? seller.wa_phone_number_id : r.channel_account_id!, contactId: r.contact_id, to: r.wa_id,
        channel: r.channel as Recipient['channel'], lastInboundAt: r.last_inbound_at, country: seller.country, language: lang,
      };
      const facts = { name: r.name, product, priceMinor: Number(product.price_minor), stock: free };
      outs.push({ ...to, kind: 'text', body: say(lang, kind === 'quiet' ? 'followUp' : 'orderExpired', facts, fmt(seller)), imageUrl: photoUrl(ctx, product) ?? undefined });
      await ctx.db.query('insert into follow_ups (seller_id, contact_id, product_id, kind, sent_at) values ($1, $2, $3, $4, $5)', [seller.id, r.contact_id, product.id, kind, now]);
      // A YES to the reminder places the order, like a YES to the first answer.
      await ctx.db.query(
        'update contacts set awaiting_order_product_id = $2, awaiting_order_at = $3, awaiting_consent_product_id = null, awaiting_consent_at = null where id = $1',
        [r.contact_id, product.id, now],
      );
    }
  }
  return outs.length ? dispatch(ctx, outs, now) : [];
}
