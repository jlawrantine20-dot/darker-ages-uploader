/**
 * Orders placed in the chat for items in stock. The customer says "je le prends"; the units
 * are held for an hour and they get a payment link. Paid: stock goes down and they get a
 * confirmation. Unpaid: the hold lapses and the units go back on sale. Sellers who take cash or
 * a mobile money transfer to their own number can mark an order paid by hand.
 */
import { randomBytes } from 'node:crypto';
import { say, slots } from '../domain/copy.js';
import type { Q } from '../db.js';
import type { PaymentEvent } from '../payments/providers.js';
import type { Ctx, DispatchResult, Outbound, Recipient } from './context.js';
import { InputError } from './errors.js';
import { dispatch } from './outbound.js';
import { fmt, type Seller } from './sellers.js';

/** How long an order keeps its units aside while the customer pays. */
export const ORDER_HOLD_MINUTES = 60;

export interface OrderRow {
  id: string;
  seller_id: string;
  contact_id: string;
  product_id: string;
  quantity: number;
  amount_minor: number;
  status: 'held' | 'paid' | 'expired' | 'cancelled' | 'refund_due';
  channel: string;
  payment_ref: string;
  paid_via: 'online' | 'manual' | null;
  created_at: Date;
  expires_at: Date;
  paid_at: Date | null;
}

export const isOrderRef = (ref: string) => ref.startsWith('ord_');

/** Units of a product kept aside by unpaid orders. */
export const HELD_BY_ORDERS_SQL = `coalesce((select sum(quantity)::int from orders o where o.product_id = p.id and o.status = 'held'), 0)`;

/** Whether this shop can send a payment link: live with a provider connected, or in test mode. */
export const takesPaymentsOnline = (ctx: Ctx, s: Seller) => ctx.config.dryRun || (s.payment_provider !== 'test' && !!s.payment_secret_enc);

export async function createOrder(
  q: Q, sellerId: string, contactId: string, product: { id: string; price_minor: number }, quantity: number, channel: string, now: Date,
): Promise<OrderRow> {
  const ref = 'ord_' + randomBytes(9).toString('base64url');
  const [o] = await q.query<OrderRow>(
    `insert into orders (seller_id, contact_id, product_id, quantity, amount_minor, status, channel, payment_ref, created_at, expires_at)
     values ($1, $2, $3, $4, $5, 'held', $6, $7, $8, $9) returning *`,
    [sellerId, contactId, product.id, quantity, Number(product.price_minor) * quantity, channel, ref, now, new Date(now.getTime() + ORDER_HOLD_MINUTES * 60_000)],
  );
  return o;
}

/** The customer's unpaid order for this product, if they already have one running. */
export async function heldOrder(q: Q, contactId: string, productId: string): Promise<OrderRow | null> {
  const [o] = await q.query<OrderRow>(`select * from orders where contact_id = $1 and product_id = $2 and status = 'held' order by created_at desc limit 1`, [contactId, productId]);
  return o ?? null;
}

interface OrderContext {
  order: OrderRow;
  seller: Seller;
  product: { id: string; name: string; variant: string; price_minor: number; stock: number };
  contact: { id: string; wa_id: string; name: string | null; last_inbound_at: Date | null; language: 'en' | 'fr' | null; channel: string; channel_account_id: string | null };
}

async function loadOrder(q: Q, where: string, value: string, lock: boolean): Promise<OrderContext | null> {
  const [order] = await q.query<OrderRow>(`select * from orders where ${where} = $1${lock ? ' for update' : ''}`, [value]);
  if (!order) return null;
  const [seller] = await q.query<Seller>('select * from sellers where id = $1', [order.seller_id]);
  // Lock the product too, so two payments for the last units cannot both win.
  const [product] = await q.query<OrderContext['product']>(`select * from products where id = $1${lock ? ' for update' : ''}`, [order.product_id]);
  const [contact] = await q.query<OrderContext['contact']>('select * from contacts where id = $1', [order.contact_id]);
  return { order, seller, product, contact };
}

function recipientFor(c: OrderContext): Recipient {
  const { seller, contact } = c;
  const whatsapp = contact.channel === 'whatsapp';
  return {
    sellerId: seller.id,
    from: whatsapp ? seller.wa_phone_number_id! : contact.channel_account_id!,
    contactId: contact.id,
    to: contact.wa_id,
    channel: contact.channel as Recipient['channel'],
    lastInboundAt: contact.last_inbound_at,
    country: seller.country,
    language: contact.language ?? seller.language,
  };
}

/** Units free to sell now: stock minus restock holds and unpaid orders. */
async function free(q: Q, productId: string): Promise<number> {
  const [row] = await q.query<{ free: number }>(
    `select p.stock
            - coalesce((select count(*)::int from offers o join restocks r on r.id = o.restock_id where r.product_id = p.id and o.status = 'held'), 0)
            - ${HELD_BY_ORDERS_SQL} as free
       from products p where p.id = $1`,
    [productId],
  );
  return row?.free ?? 0;
}

function paidMessage(c: OrderContext): Outbound {
  const to = recipientFor(c);
  const f = fmt(c.seller);
  const facts = { product: c.product };
  return {
    ...to, kind: 'text', body: say(to.language, 'paid', facts, f),
    fallback: { template: 'paid', category: 'utility', params: slots(to.language, 'paid', facts, f), preview: say(to.language, 'paid', facts, f) },
  };
}

/** Mark paid inside a transaction that holds the order and product locks. */
async function settle(q: Q, c: OrderContext, via: 'online' | 'manual', now: Date): Promise<{ outcome: 'paid' | 'refund_due'; outs: Outbound[] }> {
  const { order, product } = c;
  // A held order already has its units; an expired one only gets them if they're still free.
  if (order.status !== 'held' && (await free(q, product.id)) < order.quantity) {
    await q.query(`update orders set status = 'refund_due', paid_at = $2, paid_via = $3 where id = $1`, [order.id, now, via]);
    const to = recipientFor(c);
    return { outcome: 'refund_due', outs: [{ ...to, kind: 'text', body: say(to.language, 'orderRefund', { product }, fmt(c.seller)) }] };
  }
  await q.query(`update orders set status = 'paid', paid_at = $2, paid_via = $3 where id = $1`, [order.id, now, via]);
  await q.query('update products set stock = greatest(0, stock - $2) where id = $1', [product.id, order.quantity]);
  return { outcome: 'paid', outs: [paidMessage(c)] };
}

export type OrderPaymentOutcome = 'paid' | 'duplicate' | 'unknown' | 'underpaid' | 'refund_due';

/** A payment for a chat order, from the provider's webhook (or the test checkout). */
export async function handleOrderPayment(ctx: Ctx, event: PaymentEvent, now: Date): Promise<{ outcome: OrderPaymentOutcome; sent: DispatchResult[] }> {
  const res = await ctx.db.tx(async (q) => {
    const c = await loadOrder(q, 'payment_ref', event.reference, true);
    if (!c) return { outcome: 'unknown' as const, outs: [] as Outbound[] };
    if (c.order.status === 'paid' || c.order.status === 'refund_due') return { outcome: 'duplicate' as const, outs: [] };
    if (event.amountMinor < Number(c.order.amount_minor) || (event.currency && event.currency.toUpperCase() !== c.seller.currency)) {
      return { outcome: 'underpaid' as const, outs: [] };
    }
    return settle(q, c, 'online', now);
  });
  return { outcome: res.outcome, sent: await dispatch(ctx, res.outs, now) };
}

/** The seller got the money another way (cash, a transfer to their own number) and marks it paid. */
export async function markOrderPaid(ctx: Ctx, orderId: string, now: Date) {
  const res = await ctx.db.tx(async (q) => {
    const c = await loadOrder(q, 'id', orderId, true);
    if (!c) throw new InputError('order_not_found');
    if (c.order.status === 'paid') return { outcome: 'duplicate' as const, outs: [] as Outbound[] };
    if (c.order.status === 'refund_due') throw new InputError('order_closed');
    return settle(q, c, 'manual', now);
  });
  return { outcome: res.outcome, sent: await dispatch(ctx, res.outs, now) };
}

/** The seller cancels an unpaid order; its units go back on sale. The customer is not messaged. */
export async function cancelOrder(ctx: Ctx, orderId: string) {
  const [o] = await ctx.db.query<{ id: string }>(`update orders set status = 'cancelled' where id = $1 and status in ('held', 'expired') returning id`, [orderId]);
  if (!o) throw new InputError('order_closed');
}

/** Unpaid holds that ran out go back on sale. Run every minute with the restock tick. */
export async function expireOrders(ctx: Ctx, now: Date): Promise<number> {
  const rows = await ctx.db.query(`update orders set status = 'expired' where status = 'held' and expires_at <= $1 returning id`, [now]);
  return rows.length;
}

/** For the payment link: the order and what the customer sees, or null when there's no such order. */
export async function orderForCheckout(ctx: Ctx, ref: string) {
  const c = await loadOrder(ctx.db, 'payment_ref', ref, false);
  return c;
}
