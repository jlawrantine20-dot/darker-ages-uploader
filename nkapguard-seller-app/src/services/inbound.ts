import type { InboundText } from '../channels/whatsapp.js';
import { say } from '../domain/copy.js';
import { asksAvailability, detectProduct, isConsentYes, isStop } from '../domain/intent.js';
import { CONSENT_PROMPT_TTL_MS } from '../domain/windows.js';
import type { Q } from '../db.js';
import type { Ctx, DispatchResult, Outbound, Recipient } from './context.js';
import { dispatch } from './outbound.js';
import { fmt, type Seller } from './sellers.js';

export type InboundAction = 'unknown_seller' | 'stopped' | 'joined' | 'already_waiting' | 'offered' | 'in_stock' | 'unhandled';

interface ContactRow {
  id: string;
  seller_id: string;
  wa_id: string;
  name: string | null;
  last_inbound_at: Date | null;
  awaiting_consent_product_id: string | null;
  awaiting_consent_at: Date | null;
}

interface ProductRow {
  id: string;
  name: string;
  variant: string;
  aliases: string[];
  price_minor: number;
  stock: number;
}

/** Units on the shelf that are not already held for someone on the waitlist. */
export async function freeStock(q: Q, productId: string): Promise<number> {
  const [row] = await q.query<{ free: number }>(
    `select p.stock - coalesce((select count(*)::int from offers o join restocks r on r.id = o.restock_id
                                 where r.product_id = p.id and o.status = 'held'), 0) as free
       from products p where p.id = $1`,
    [productId],
  );
  return row?.free ?? 0;
}

export async function waitlistPosition(q: Q, interestId: string): Promise<number> {
  const [row] = await q.query<{ pos: number }>(
    `select count(*)::int as pos from interests o, interests me
      where me.id = $1 and o.product_id = me.product_id and o.status = 'waiting'
        and (o.created_at, o.seq) <= (me.created_at, me.seq)`,
    [interestId],
  );
  return row.pos;
}

export async function handleInbound(ctx: Ctx, msg: InboundText): Promise<{ action: InboundAction; sent: DispatchResult[] }> {
  const [seller] = await ctx.db.query<Seller>('select * from sellers where wa_phone_number_id = $1', [msg.phoneNumberId]);
  if (!seller) return { action: 'unknown_seller', sent: [] };
  const lang = seller.language;
  const f = fmt(seller);

  const { action, outs } = await ctx.db.tx(async (q) => {
    const [contact] = await q.query<ContactRow>(
      `insert into contacts (seller_id, wa_id, name, last_inbound_at) values ($1, $2, $3, $4)
       on conflict (seller_id, wa_id) do update
         set name = coalesce(excluded.name, contacts.name),
             last_inbound_at = greatest(contacts.last_inbound_at, excluded.last_inbound_at)
       returning *`,
      [seller.id, msg.from, msg.name ?? null, msg.at],
    );
    await q.query(
      `insert into messages (seller_id, contact_id, direction, kind, body, provider_id, created_at)
       values ($1, $2, 'in', 'text', $3, $4, $5)`,
      [seller.id, contact.id, msg.text, msg.providerId, msg.at],
    );
    const to: Recipient = {
      sellerId: seller.id, from: seller.wa_phone_number_id, contactId: contact.id, to: contact.wa_id,
      lastInboundAt: contact.last_inbound_at, country: seller.country, language: seller.language,
    };
    const reply = (body: string): Outbound[] => [{ ...to, kind: 'text', body }];

    if (isStop(msg.text)) {
      await q.query('update consents set revoked_at = $2 where contact_id = $1 and revoked_at is null', [contact.id, msg.at]);
      await q.query(`update interests set status = 'removed' where contact_id = $1 and status = 'waiting'`, [contact.id]);
      await q.query('update contacts set awaiting_consent_product_id = null, awaiting_consent_at = null where id = $1', [contact.id]);
      return { action: 'stopped' as const, outs: reply(say(lang, 'stopped', { seller: seller.name }, f)) };
    }

    const promptLive =
      contact.awaiting_consent_product_id &&
      contact.awaiting_consent_at &&
      msg.at.getTime() - contact.awaiting_consent_at.getTime() < CONSENT_PROMPT_TTL_MS;
    if (promptLive && isConsentYes(msg.text)) {
      const [product] = await q.query<ProductRow>('select * from products where id = $1', [contact.awaiting_consent_product_id]);
      await q.query('update contacts set awaiting_consent_product_id = null, awaiting_consent_at = null where id = $1', [contact.id]);
      const [existing] = await q.query<{ id: string }>(
        `select id from interests where product_id = $1 and contact_id = $2 and status = 'waiting'`,
        [product.id, contact.id],
      );
      if (existing) {
        return { action: 'already_waiting' as const, outs: reply(say(lang, 'alreadyWaiting', { product, position: await waitlistPosition(q, existing.id) }, f)) };
      }
      const [consent] = await q.query<{ id: string }>(
        `insert into consents (seller_id, contact_id, channel, purpose, product_id, quote, granted_at)
         values ($1, $2, 'whatsapp', 'restock_alert', $3, $4, $5) returning id`,
        [seller.id, contact.id, product.id, msg.text, msg.at],
      );
      const [interest] = await q.query<{ id: string }>(
        `insert into interests (seller_id, product_id, contact_id, consent_id, created_at)
         values ($1, $2, $3, $4, $5) returning id`,
        [seller.id, product.id, contact.id, consent.id, msg.at],
      );
      return { action: 'joined' as const, outs: reply(say(lang, 'joined', { product, position: await waitlistPosition(q, interest.id) }, f)) };
    }

    if (asksAvailability(msg.text) || msg.text.includes('?')) {
      const catalog = await q.query<ProductRow>('select * from products where seller_id = $1', [seller.id]);
      const product = detectProduct(msg.text, catalog);
      if (product) {
        const free = await freeStock(q, product.id);
        if (free > 0) {
          return { action: 'in_stock' as const, outs: reply(say(lang, 'inStock', { name: contact.name, product, priceMinor: product.price_minor, stock: free }, f)) };
        }
        await q.query('update contacts set awaiting_consent_product_id = $2, awaiting_consent_at = $3 where id = $1', [contact.id, product.id, msg.at]);
        return { action: 'offered' as const, outs: reply(say(lang, 'offerAlert', { name: contact.name, product }, f)) };
      }
    }
    return { action: 'unhandled' as const, outs: [] as Outbound[] };
  });

  return { action, sent: await dispatch(ctx, outs, msg.at) };
}
