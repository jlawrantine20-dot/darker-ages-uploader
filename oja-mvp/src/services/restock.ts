import { randomBytes } from 'node:crypto';
import { clockTime, copyFor, firstName, params, productLabel } from '../domain/copy.js';
import type { Q } from '../db.js';
import type { PaymentEvent } from '../payments/providers.js';
import type { Ctx, DispatchResult, Outbound, Recipient } from './context.js';
import { InputError } from './errors.js';
import { dispatch, messageCost } from './outbound.js';
import { money, type Seller } from './sellers.js';

export { InputError } from './errors.js';

export interface RestockInput {
  productId: string;
  units: number;
  mode: 'hold' | 'race';
  holdMinutes?: number;
  perUnit?: number;
}

/** A race stays open this long; after that, unanswered alerts lapse quietly. */
export const RACE_WINDOW_MS = 24 * 60 * 60 * 1000;

interface RestockRow {
  id: string;
  product_id: string;
  units: number;
  mode: 'hold' | 'race';
  hold_minutes: number;
  per_unit: number;
  created_at: Date;
  closed_at: Date | null;
}
interface ProductRow {
  id: string;
  seller_id: string;
  name: string;
  variant: string;
  price_minor: number;
  stock: number;
}
interface CandidateRow {
  interest_id: string;
  contact_id: string;
  wa_id: string;
  name: string | null;
  last_inbound_at: Date | null;
}
interface NewOffer extends CandidateRow {
  offer_id: string;
  payment_ref: string;
  status: 'held' | 'notified';
  expires_at: Date | null;
}

const recipient = (s: Seller, c: { contact_id: string; wa_id: string; last_inbound_at: Date | null }): Recipient => ({
  sellerId: s.id,
  from: s.wa_phone_number_id,
  contactId: c.contact_id,
  to: c.wa_id,
  lastInboundAt: c.last_inbound_at,
  country: s.country,
  language: s.language,
});

async function load(q: Q, restockId: string, lock = false) {
  const [restock] = await q.query<RestockRow>(`select * from restocks where id = $1${lock ? ' for update' : ''}`, [restockId]);
  if (!restock) return null;
  const [product] = await q.query<ProductRow>('select * from products where id = $1', [restock.product_id]);
  const [seller] = await q.query<Seller>('select * from sellers where id = $1', [product.seller_id]);
  return { restock, product, seller };
}

/** Next people in line who still consent and have not had an offer from this restock. */
function candidates(q: Q, restockId: string, productId: string, limit: number) {
  return q.query<CandidateRow>(
    `select i.id as interest_id, c.id as contact_id, c.wa_id, c.name, c.last_inbound_at
       from interests i
       join consents k on k.id = i.consent_id and k.revoked_at is null
       join contacts c on c.id = i.contact_id
      where i.product_id = $1 and i.status = 'waiting'
        and not exists (select 1 from offers o where o.restock_id = $2 and o.interest_id = i.id)
      order by i.created_at, i.seq
      limit $3`,
    [productId, restockId, limit],
  );
}

async function waitingCount(q: Q, productId: string): Promise<number> {
  const [row] = await q.query<{ n: number }>(
    `select count(*)::int as n from interests i join consents k on k.id = i.consent_id and k.revoked_at is null
      where i.product_id = $1 and i.status = 'waiting'`,
    [productId],
  );
  return row.n;
}

async function offerCounts(q: Q, restockId: string) {
  const [row] = await q.query<{ paid: number; held: number; notified: number }>(
    `select count(*) filter (where status = 'paid')::int as paid,
            count(*) filter (where status = 'held')::int as held,
            count(*) filter (where status = 'notified')::int as notified
       from offers where restock_id = $1`,
    [restockId],
  );
  return row;
}

async function openRestockFor(q: Q, productId: string): Promise<string | null> {
  const [row] = await q.query<{ id: string }>('select id from restocks where product_id = $1 and closed_at is null limit 1', [productId]);
  return row?.id ?? null;
}

async function createOffers(q: Q, restock: RestockRow, rows: CandidateRow[], now: Date): Promise<NewOffer[]> {
  const out: NewOffer[] = [];
  const status = restock.mode === 'hold' ? 'held' : 'notified';
  const expires = restock.mode === 'hold' ? new Date(now.getTime() + restock.hold_minutes * 60_000) : null;
  for (const r of rows) {
    const ref = 'oja_' + randomBytes(9).toString('base64url');
    const [o] = await q.query<{ id: string }>(
      `insert into offers (restock_id, interest_id, status, sent_at, expires_at, payment_ref)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [restock.id, r.interest_id, status, now, expires, ref],
    );
    out.push({ ...r, offer_id: o.id, payment_ref: ref, status, expires_at: expires });
  }
  return out;
}

/**
 * Alerts carry Oja's own link. The provider checkout is created only when the customer
 * taps it (see /pay/:ref), so it never expires before the hold does, and an ended offer
 * shows a clear page instead of a stale checkout.
 */
export const payLink = (ctx: Ctx, ref: string) => `${ctx.config.publicUrl.replace(/\/$/, '')}/pay/${ref}`;

/** Build the alert messages. Runs after the transaction commits. */
async function announce(
  ctx: Ctx,
  loaded: { restock: RestockRow; product: ProductRow; seller: Seller },
  offers: NewOffer[],
  waiting: number,
): Promise<Outbound[]> {
  const { restock, product, seller } = loaded;
  const t = copyFor(seller.language);
  const label = productLabel(product, seller.language);
  const price = money(seller, product.price_minor);
  const outs: Outbound[] = [];
  for (const o of offers) {
    const url = payLink(ctx, o.payment_ref);
    await ctx.db.query('update offers set payment_url = $2 where id = $1', [o.offer_id, url]);
    const first = firstName(o.name, seller.language);
    if (restock.mode === 'hold') {
      const a = { first, label, units: restock.units, waiting, until: clockTime(o.expires_at!, seller.timezone, seller.language), price, url };
      outs.push({ ...recipient(seller, o), kind: 'template', template: 'hold', category: 'marketing', params: params.hold(a), preview: t.holdPreview(a) });
    } else {
      const a = { first, label, units: restock.units, told: offers.length, price, url };
      outs.push({ ...recipient(seller, o), kind: 'template', template: 'race', category: 'marketing', params: params.race(a), preview: t.racePreview(a) });
    }
  }
  return outs;
}

function validated(input: RestockInput) {
  const units = Math.trunc(input.units);
  if (!(units >= 1 && units <= 10_000)) throw new InputError('units must be between 1 and 10000');
  if (input.mode !== 'hold' && input.mode !== 'race') throw new InputError("mode must be 'hold' or 'race'");
  const holdMinutes = Math.trunc(input.holdMinutes ?? 120);
  const perUnit = Math.trunc(input.perUnit ?? 5);
  if (!(holdMinutes >= 5 && holdMinutes <= 7 * 24 * 60)) throw new InputError('holdMinutes must be between 5 and 10080');
  if (!(perUnit >= 1 && perUnit <= 50)) throw new InputError('perUnit must be between 1 and 50');
  return { units, mode: input.mode, holdMinutes, perUnit, limit: input.mode === 'hold' ? units : units * perUnit };
}

/** What a restock would do, without changing anything: who gets messaged, the wording and the estimated cost. */
export async function previewRestock(ctx: Ctx, input: RestockInput, now: Date) {
  const v = validated(input);
  const [product] = await ctx.db.query<ProductRow>('select * from products where id = $1', [input.productId]);
  if (!product) throw new InputError('product not found');
  const [seller] = await ctx.db.query<Seller>('select * from sellers where id = $1', [product.seller_id]);
  const waiting = await waitingCount(ctx.db, product.id);
  const [next] = await ctx.db.query<{ name: string | null }>(
    `select c.name from interests i join consents k on k.id = i.consent_id and k.revoked_at is null join contacts c on c.id = i.contact_id
      where i.product_id = $1 and i.status = 'waiting' order by i.created_at, i.seq limit 1`,
    [product.id],
  );
  const toMessage = Math.min(v.limit, waiting);
  const soldOutNotes = v.mode === 'race' ? Math.max(0, toMessage - v.units) : 0;
  const t = copyFor(seller.language);
  const first = firstName(next?.name, seller.language);
  const label = productLabel(product, seller.language);
  const price = money(seller, product.price_minor);
  const url = `${ctx.config.publicUrl.replace(/\/$/, '')}/pay/…`;
  const preview =
    v.mode === 'hold'
      ? t.holdPreview({ first, label, units: v.units, waiting, until: clockTime(new Date(now.getTime() + v.holdMinutes * 60_000), seller.timezone, seller.language), price, url })
      : t.racePreview({ first, label, units: v.units, told: toMessage, price, url });
  const marketing = messageCost(ctx, seller.country, 'marketing');
  const utility = messageCost(ctx, seller.country, 'utility');
  return {
    waiting,
    toMessage,
    soldOutNotes,
    preview,
    costUsdMicros: { alerts: toMessage * marketing, soldOutNotes: soldOutNotes * utility, total: toMessage * marketing + soldOutNotes * utility },
    perMessageUsdMicros: { marketing, utility },
    running: (await openRestockFor(ctx.db, product.id)) !== null,
  };
}

export async function startRestock(ctx: Ctx, input: RestockInput, now: Date) {
  const { units, holdMinutes, perUnit, limit } = validated(input);
  const result = await ctx.db.tx(async (q) => {
    const [locked] = await q.query<{ id: string }>('select id from products where id = $1 for update', [input.productId]);
    if (!locked) throw new InputError('product not found');
    if (await openRestockFor(q, input.productId)) {
      throw new InputError('A restock for this item is still running. Wait for it to finish before adding more.');
    }
    await q.query('update products set stock = stock + $2 where id = $1', [input.productId, units]);
    const [r] = await q.query<{ id: string }>(
      `insert into restocks (product_id, units, mode, hold_minutes, per_unit, created_at) values ($1, $2, $3, $4, $5, $6) returning id`,
      [input.productId, units, input.mode, holdMinutes, perUnit, now],
    );
    const loaded = (await load(q, r.id))!;
    const offers = await createOffers(q, loaded.restock, await candidates(q, r.id, input.productId, limit), now);
    if (!offers.length) await q.query('update restocks set closed_at = $2 where id = $1', [r.id, now]);
    return { loaded, offers, waiting: await waitingCount(q, input.productId) };
  });

  const sent = await dispatch(ctx, await announce(ctx, result.loaded, result.offers, result.waiting), now);
  return { restockId: result.loaded.restock.id, offered: result.offers.length, waiting: result.waiting, sent };
}

/** Expire lapsed holds, pass freed units down the line, close finished restocks. Run every minute. */
export async function tick(ctx: Ctx, now: Date): Promise<DispatchResult[]> {
  const sent: DispatchResult[] = [];
  const open = await ctx.db.query<{ id: string }>('select id from restocks where closed_at is null order by created_at');
  for (const { id } of open) {
    const res = await ctx.db.tx(async (q) => {
      const loaded = await load(q, id, true);
      if (!loaded || loaded.restock.closed_at) return null;
      const { restock } = loaded;
      if (restock.mode === 'race') {
        if (now.getTime() - restock.created_at.getTime() >= RACE_WINDOW_MS) {
          await q.query(`update offers set status = 'expired' where restock_id = $1 and status = 'notified'`, [id]);
          await q.query('update restocks set closed_at = $2 where id = $1', [id, now]);
        }
        return null;
      }
      await q.query(`update offers set status = 'expired' where restock_id = $1 and status = 'held' and expires_at <= $2`, [id, now]);
      const c = await offerCounts(q, id);
      const free = restock.units - c.paid - c.held;
      const offers = free > 0 ? await createOffers(q, restock, await candidates(q, id, restock.product_id, free), now) : [];
      if (c.paid >= restock.units || c.held + offers.length === 0) {
        await q.query('update restocks set closed_at = $2 where id = $1', [id, now]);
      }
      return offers.length ? { loaded, offers, waiting: await waitingCount(q, restock.product_id) } : null;
    });
    if (res) sent.push(...(await dispatch(ctx, await announce(ctx, res.loaded, res.offers, res.waiting), now)));
  }
  return sent;
}

export type PaymentOutcome = 'paid' | 'duplicate' | 'unknown' | 'underpaid' | 'refund_due';

/** Each checkout attempt uses "<payment_ref>.<attempt>" with the provider, since references must be unique per attempt. */
export const baseRef = (providerRef: string) => providerRef.split('.')[0];

export async function handlePayment(ctx: Ctx, rawEvent: PaymentEvent, now: Date): Promise<{ outcome: PaymentOutcome; sent: DispatchResult[] }> {
  const event = { ...rawEvent, reference: baseRef(rawEvent.reference) };
  const res = await ctx.db.tx(async (q) => {
    const [ref] = await q.query<{ restock_id: string }>('select restock_id from offers where payment_ref = $1', [event.reference]);
    if (!ref) return { outcome: 'unknown' as const, outs: [] as Outbound[] };
    // Lock the restock first so two payments for the last unit cannot both win.
    const loaded = (await load(q, ref.restock_id, true))!;
    const { restock, product, seller } = loaded;
    const t = copyFor(seller.language);
    const [offer] = await q.query<{ id: string; status: string; interest_id: string } & CandidateRow>(
      `select o.id, o.status, o.interest_id, c.id as contact_id, c.wa_id, c.name, c.last_inbound_at
         from offers o join interests i on i.id = o.interest_id join contacts c on c.id = i.contact_id
        where o.payment_ref = $1 for update of o`,
      [event.reference],
    );
    const to = recipient(seller, offer);
    const label = productLabel(product, seller.language);
    if (offer.status === 'paid') return { outcome: 'duplicate' as const, outs: [] };
    if (event.amountMinor < product.price_minor || (event.currency && event.currency.toUpperCase() !== seller.currency)) {
      return { outcome: 'underpaid' as const, outs: [] };
    }

    const c = await offerCounts(q, restock.id);
    const unitReserved = offer.status === 'held';
    const unitFree = restock.units - c.paid - c.held > 0 && product.stock > 0;
    if (!unitReserved && !unitFree) {
      await q.query(`update offers set status = 'missed', refund_due = true where id = $1`, [offer.id]);
      return {
        outcome: 'refund_due' as const,
        outs: [{
          ...to, kind: 'text' as const, body: t.paidTooLate(label),
          fallback: { template: 'refund' as const, category: 'utility' as const, params: params.label(label), preview: t.paidTooLate(label) },
        }],
      };
    }

    await q.query(`update offers set status = 'paid', paid_at = $2 where id = $1`, [offer.id, now]);
    await q.query(`update interests set status = 'bought' where id = $1`, [offer.interest_id]);
    await q.query('update products set stock = stock - 1 where id = $1', [product.id]);
    const outs: Outbound[] = [{
      ...to, kind: 'text', body: t.paid(label),
      fallback: { template: 'paid', category: 'utility', params: params.label(label), preview: t.paid(label) },
    }];

    if (c.paid + 1 >= restock.units) {
      await q.query('update restocks set closed_at = $2 where id = $1', [restock.id, now]);
      const losers = await q.query<CandidateRow>(
        `update offers o set status = 'missed' from interests i, contacts c
          where o.restock_id = $1 and o.status = 'notified' and i.id = o.interest_id and c.id = i.contact_id
        returning i.id as interest_id, c.id as contact_id, c.wa_id, c.name, c.last_inbound_at`,
        [restock.id],
      );
      for (const l of losers) {
        const a = { first: firstName(l.name, seller.language), label };
        outs.push({ ...recipient(seller, l), kind: 'template', template: 'soldOut', category: 'utility', params: params.soldOut(a), preview: t.soldOutPreview(a) });
      }
    }
    return { outcome: 'paid' as const, outs };
  });
  return { outcome: res.outcome, sent: await dispatch(ctx, res.outs, now) };
}
