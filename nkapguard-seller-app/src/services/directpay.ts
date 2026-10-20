/**
 * Direct payment, for shops without a payment gateway (or still waiting for one to verify them).
 * The seller lists where customers can send money: a mobile money number, a bank account,
 * anything. Each order then tells the customer what to pay and where. The customer says when
 * they have paid (a "payé" in the chat, a screenshot, or the button on the payment page); the
 * seller is told at once, checks their own phone or bank, and confirms. The confirmation is the
 * same as an online payment: stock goes down and the customer gets the "paid" message.
 *
 * While a payment is being checked, its hold is kept for up to a day so the units aren't sold
 * to someone else in the meantime.
 */
import { say } from '../domain/copy.js';
import type { Q } from '../db.js';
import type { Ctx, DispatchResult, Outbound, Recipient } from './context.js';
import { InputError } from './errors.js';
import { markOrderPaid } from './orders.js';
import { dispatch } from './outbound.js';
import { claimNotice, notifyShop } from './push.js';
import { handlePayment } from './restock.js';
import { fmt, type Seller } from './sellers.js';

export interface PayMethod {
  /** What it is, as the customer knows it: "MTN MoMo", "Orange Money", "GTBank". */
  label: string;
  /** The number or account to send to. */
  account: string;
  /** The name the customer will see on the transfer, so they know it's the right account. */
  holder?: string;
  /** Anything else: "Code marchand 123456", "Mention: your name". */
  note?: string;
}

/** Common ways to receive money, per country, offered as suggestions. Sellers can type any other. */
export const PAY_WITH: Record<string, string[]> = {
  CM: ['MTN MoMo', 'Orange Money'],
  CI: ['Orange Money', 'MTN MoMo', 'Moov Money', 'Wave'],
  SN: ['Wave', 'Orange Money', 'Free Money'],
  GA: ['Airtel Money', 'Moov Money'],
  NG: ['Bank transfer', 'OPay', 'PalmPay', 'Moniepoint'],
  GH: ['MTN MoMo', 'Telecel Cash', 'AirtelTigo Money'],
  KE: ['M-Pesa'],
  UG: ['MTN MoMo', 'Airtel Money'],
  TZ: ['M-Pesa', 'Airtel Money', 'Tigo Pesa'],
  RW: ['MTN MoMo', 'Airtel Money'],
  ZA: ['Bank transfer'],
  EG: ['Vodafone Cash', 'InstaPay'],
  IN: ['UPI'],
};
export const DEFAULT_PAY_WITH = ['Bank transfer'];

const MAX_METHODS = 5;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Check and tidy what the seller entered. */
export function cleanMethods(input: unknown): PayMethod[] {
  if (!Array.isArray(input)) throw new InputError('pay_methods_invalid');
  if (input.length > MAX_METHODS) throw new InputError('pay_methods_too_many', { max: MAX_METHODS });
  return input.map((m) => {
    const label = clean(m?.label, 40);
    const account = clean(m?.account, 60);
    if (!label || !account) throw new InputError('pay_method_incomplete');
    const holder = clean(m?.holder, 60);
    const note = clean(m?.note, 160);
    return { label, account, ...(holder ? { holder } : {}), ...(note ? { note } : {}) };
  });
}

export async function setPayMethods(q: Q, sellerId: string, input: unknown): Promise<PayMethod[]> {
  const methods = cleanMethods(input);
  await q.query('update sellers set pay_methods = $2 where id = $1', [sellerId, JSON.stringify(methods)]);
  return methods;
}

export const methodsOf = (s: Pick<Seller, 'pay_methods'>): PayMethod[] => (Array.isArray(s.pay_methods) ? s.pay_methods : []);

/**
 * How this shop takes money:
 *  - online: a connected gateway (or the test checkout in test mode) sends a payment link;
 *  - direct: the customer sends money to the seller's own number or account;
 *  - manual: nothing set up yet, so the seller arranges payment in the chat.
 */
export type PayMode = 'online' | 'direct' | 'manual';
export function payMode(ctx: Ctx, s: Seller): PayMode {
  if (s.payment_provider !== 'test' && s.payment_secret_enc) return 'online';
  if (methodsOf(s).length) return 'direct';
  return ctx.config.dryRun ? 'online' : 'manual';
}

/** A short code the customer can put in the transfer's reason, so the seller can match it. */
export const shortRef = (ref: string) => ref.replace(/^(ord|nkg)_/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();

interface Claimable {
  kind: 'order' | 'offer';
  id: string;
  seller_id: string;
  contact_id: string;
  payment_ref: string;
  amount_minor: string;
  name: string;
  variant: string;
  quantity: number;
  claimed_at: Date | null;
}

/** The customer's most recent unpaid order or restock offer that they could have paid for. */
async function latestClaimable(q: Q, contactId: string, now: Date): Promise<Claimable | null> {
  const [row] = await q.query<Claimable>(
    `select * from (
       select 'order' as kind, o.id, o.seller_id, o.contact_id, o.payment_ref, o.amount_minor::text as amount_minor, p.name, p.variant, o.quantity, o.claimed_at, o.created_at
         from orders o join products p on p.id = o.product_id
        where o.contact_id = $1 and o.status = 'held' and o.expires_at > $2
       union all
       select 'offer', f.id, p.seller_id, i.contact_id, f.payment_ref, coalesce(f.amount_minor, p.price_minor)::text, p.name, p.variant, 1, f.claimed_at, f.sent_at
         from offers f join restocks r on r.id = f.restock_id join products p on p.id = r.product_id join interests i on i.id = f.interest_id
        where i.contact_id = $1 and ((f.status = 'held' and f.expires_at > $2) or (f.status = 'notified' and r.closed_at is null))
     ) x order by created_at desc limit 1`,
    [contactId, now],
  );
  return row ?? null;
}

async function claimByRef(q: Q, ref: string): Promise<Claimable | null> {
  const [row] = await q.query<Claimable>(
    `select 'order' as kind, o.id, o.seller_id, o.contact_id, o.payment_ref, o.amount_minor::text as amount_minor, p.name, p.variant, o.quantity, o.claimed_at
       from orders o join products p on p.id = o.product_id where o.payment_ref = $1 and o.status = 'held'
     union all
     select 'offer', f.id, p.seller_id, i.contact_id, f.payment_ref, coalesce(f.amount_minor, p.price_minor)::text, p.name, p.variant, 1, f.claimed_at
       from offers f join restocks r on r.id = f.restock_id join products p on p.id = r.product_id join interests i on i.id = f.interest_id
      where f.payment_ref = $1 and (f.status = 'held' or (f.status = 'notified' and r.closed_at is null))`,
    [ref],
  );
  return row ?? null;
}

/** How long a claimed payment keeps its hold while the seller checks. */
const CHECK_HOLD_MS = 24 * 60 * 60 * 1000;

async function record(q: Q, c: Claimable, note: string | null, now: Date) {
  const until = new Date(now.getTime() + CHECK_HOLD_MS);
  const table = c.kind === 'order' ? 'orders' : 'offers';
  await q.query(
    `update ${table} set claimed_at = coalesce(claimed_at, $2), claim_note = coalesce($3, claim_note),
            expires_at = case when expires_at is null then null else greatest(expires_at, $4) end
      where id = $1`,
    [c.id, now, note, until],
  );
}

/** "j'ai payé", "c'est envoyé", "paid", "done", or a transfer receipt. Only read when something is waiting for payment. */
export function isPaymentClaim(text: string): boolean {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/\b(j'?ai|jai|c'?est|deja|bien)\s+(paye|payer|envoye|envoyer|fait|transfere|regle)\b/.test(t)) return true;
  if (/\b(paiement|transfert|depot|virement)\s+(effectue|fait|envoye|ok)\b/.test(t)) return true;
  if (/^\s*(paye|payer|envoye|c fait|c'est fait|fait|ok paye|done|paid|sent)\s*[.!]*\s*$/.test(t)) return true;
  if (/\b(i\s*(have|'ve)?\s*(paid|sent|transferred|done it)|payment\s+(made|sent|done)|money\s+sent|transfer\s+(done|made|sent))\b/.test(t)) return true;
  // A pasted mobile money receipt: "Transaction ID: MP2409.1234.A56789", "Ref 1234567890".
  if (/\b(transaction|trans|txn|ref(erence)?|id)\b[^\n]{0,12}[a-z0-9.\-]{8,}/.test(t) && /\d{4,}/.test(t)) return true;
  return false;
}

/** The transfer reference, when the customer pasted one. */
export function claimNote(text: string): string | null {
  const m = text.match(/\b(?=[A-Z0-9.\-]*\d)[A-Z0-9][A-Z0-9.\-]{7,}\b/i);
  return m ? m[0].slice(0, 80) : null;
}

function recipient(seller: Seller, contact: { id: string; wa_id: string; last_inbound_at: Date | null; language: 'en' | 'fr' | null; channel: string; channel_account_id: string | null }): Recipient {
  const whatsapp = contact.channel === 'whatsapp';
  return {
    sellerId: seller.id, from: whatsapp ? seller.wa_phone_number_id : contact.channel_account_id!, contactId: contact.id, to: contact.wa_id,
    channel: contact.channel as Recipient['channel'], lastInboundAt: contact.last_inbound_at, country: seller.country, language: contact.language ?? seller.language,
  };
}

async function tellShop(ctx: Ctx, seller: Seller, c: Claimable, who: string, note: string | null) {
  await notifyShop(ctx, seller.id, claimNotice(who, { name: c.name, variant: c.variant }, c.quantity, { minor: Number(c.amount_minor), currency: seller.currency, country: seller.country }, note, c.kind));
}

/**
 * A chat message on a shop that takes direct payment: if it says "I've paid" (or is a receipt
 * or a screenshot) and something is waiting for payment, record the claim. Returns the reply,
 * or null when the message isn't a payment claim.
 */
export async function claimFromChat(
  q: Q, seller: Seller, contactId: string, text: string, isImage: boolean, now: Date,
): Promise<{ claim: Claimable; note: string | null } | null> {
  if (!isImage && !isPaymentClaim(text)) return null;
  const c = await latestClaimable(q, contactId, now);
  if (!c || c.seller_id !== seller.id) return null;
  const note = isImage ? (claimNote(text) ?? 'photo') : claimNote(text);
  await record(q, c, note, now);
  return { claim: c, note };
}

/** Told after the claim is recorded: the shop's phones, so someone checks quickly. */
export async function notifyClaim(ctx: Ctx, seller: Seller, claim: Claimable, who: string, note: string | null) {
  await tellShop(ctx, seller, claim, who, note);
}

/** "I've paid" from the payment page. */
export async function claimFromPage(ctx: Ctx, ref: string, note: string | null, now: Date): Promise<'claimed' | 'ended'> {
  const res = await ctx.db.tx(async (q) => {
    const c = await claimByRef(q, ref);
    if (!c) return null;
    await record(q, c, note ? note.slice(0, 80) : null, now);
    const [seller] = await q.query<Seller>('select * from sellers where id = $1', [c.seller_id]);
    const [contact] = await q.query<{ name: string | null; wa_id: string }>('select name, wa_id from contacts where id = $1', [c.contact_id]);
    return { c, seller, who: contact?.name ?? `+${contact?.wa_id}` };
  });
  if (!res) return 'ended';
  await tellShop(ctx, res.seller, res.c, res.who, note);
  return 'claimed';
}

/** The seller saw the money arrive: settle it exactly like an online payment. */
export async function confirmOffer(ctx: Ctx, offerId: string, now: Date) {
  const [o] = await ctx.db.query<{ payment_ref: string; seller_id: string; amount_minor: string }>(
    `select f.payment_ref, p.seller_id, coalesce(f.amount_minor, p.price_minor)::text as amount_minor
       from offers f join restocks r on r.id = f.restock_id join products p on p.id = r.product_id where f.id = $1`,
    [offerId],
  );
  if (!o) throw new InputError('order_not_found');
  return handlePayment(ctx, { reference: o.payment_ref, amountMinor: Number(o.amount_minor) }, now, o.seller_id);
}
export { markOrderPaid as confirmOrder };

/** The money hasn't arrived: clear the claim and ask the customer to check. */
export async function rejectClaim(ctx: Ctx, kind: 'order' | 'offer', id: string, now: Date): Promise<DispatchResult[]> {
  const outs = await ctx.db.tx(async (q) => {
    const table = kind === 'order' ? 'orders' : 'offers';
    const [row] = await q.query<{ seller_id: string; contact_id: string; amount_minor: string; name: string; variant: string; claimed_at: Date | null }>(
      kind === 'order'
        ? `select o.seller_id, o.contact_id, o.amount_minor::text as amount_minor, p.name, p.variant, o.claimed_at
             from orders o join products p on p.id = o.product_id where o.id = $1`
        : `select p.seller_id, i.contact_id, coalesce(f.amount_minor, p.price_minor)::text as amount_minor, p.name, p.variant, f.claimed_at
             from offers f join restocks r on r.id = f.restock_id join products p on p.id = r.product_id join interests i on i.id = f.interest_id where f.id = $1`,
      [id],
    );
    if (!row) throw new InputError('order_not_found');
    if (!row.claimed_at) return [] as Outbound[];
    await q.query(`update ${table} set claimed_at = null, claim_note = null where id = $1`, [id]);
    const [seller] = await q.query<Seller>('select * from sellers where id = $1', [row.seller_id]);
    const [contact] = await q.query<Parameters<typeof recipient>[1] & { name: string | null }>('select * from contacts where id = $1', [row.contact_id]);
    const to = recipient(seller, contact);
    const facts = { name: contact.name, product: { name: row.name, variant: row.variant }, priceMinor: Number(row.amount_minor) };
    return [{ ...to, kind: 'text', body: say(to.language, 'claimMissing', facts, fmt(seller)) } as Outbound];
  });
  return outs.length ? dispatch(ctx, outs, now) : [];
}

/** What the payment page shows for a direct-pay shop. */
export function directCheckout(seller: Seller, ref: string, amountMinor: number, label: string, claimed: boolean) {
  return { methods: methodsOf(seller), amountMinor, currency: seller.currency, country: seller.country, ref: shortRef(ref), label, shop: seller.name, claimed };
}
