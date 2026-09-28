/**
 * Price-drop alerts. Customers who bargained and said yes to "tell me if the price drops"
 * (consent purpose 'price_alert') are told when the seller lowers that item's price:
 *  - only while the item is in stock;
 *  - never someone who has already bought it, or was already told about this price or lower;
 *  - as a plain reply inside the 24-hour window, otherwise as the approved marketing template.
 * Both prices come from the product itself, so the "was" price is always the real one.
 */
import { say, slots } from '../domain/copy.js';
import type { Ctx, DispatchResult, Outbound, Recipient } from './context.js';
import { InputError } from './errors.js';
import { freeStock } from './inbound.js';
import { dispatch, messageCost } from './outbound.js';
import { photoUrl } from './photos.js';
import { fmt, type Seller } from './sellers.js';
import { whatsappWindowOpen } from '../domain/windows.js';

interface Watcher {
  contact_id: string;
  wa_id: string;
  name: string | null;
  last_inbound_at: Date | null;
  language: 'en' | 'fr' | null;
}

async function load(ctx: Ctx, productId: string) {
  const [product] = await ctx.db.query<{
    id: string; seller_id: string; name: string; variant: string; price_minor: string; photo_version: string | null;
    previous_price_minor: string | null; price_lowered_at: Date | null;
  }>(
    'select * from products where id = $1',
    [productId],
  );
  if (!product) throw new InputError('product_not_found');
  const [seller] = await ctx.db.query<Seller>('select * from sellers where id = $1', [product.seller_id]);
  return { product, seller };
}

/** Customers waiting for this item's price to drop to at most newPrice. */
async function watchers(ctx: Ctx, productId: string, newPrice: number): Promise<Watcher[]> {
  return ctx.db.query<Watcher>(
    `select distinct on (c.id) c.id as contact_id, c.wa_id, c.name, c.last_inbound_at, c.language
       from consents k join contacts c on c.id = k.contact_id
      where k.product_id = $1 and k.purpose = 'price_alert' and k.revoked_at is null and c.channel = 'whatsapp'
        and not exists (select 1 from orders o where o.contact_id = c.id and o.product_id = $1 and o.status = 'paid')
        and not exists (select 1 from interests i where i.contact_id = c.id and i.product_id = $1 and i.status = 'bought')
        and not exists (select 1 from price_alert_sends s where s.contact_id = c.id and s.product_id = $1 and s.new_price_minor <= $2)
      order by c.id`,
    [productId, newPrice],
  );
}

/** Who would be told and what it would cost, without sending anything. */
export async function previewPriceDrop(ctx: Ctx, productId: string, now: Date) {
  const { product, seller } = await load(ctx, productId);
  const list = await watchers(ctx, productId, Number(product.price_minor));
  const inWindow = list.filter((w) => whatsappWindowOpen(w.last_inbound_at, now)).length;
  const cost = inWindow * messageCost(ctx, seller.country, 'service') + (list.length - inWindow) * messageCost(ctx, seller.country, 'marketing');
  return { watchers: list.length, inStock: (await freeStock(ctx.db, productId)) > 0, costUsdMicros: cost };
}

/** How long after a price cut its alert can still go out. */
const CUT_VALID_MS = 7 * 24 * 60 * 60 * 1000;

/** Tell the watchers about the last price cut. The old price is the one the server recorded. */
export async function sendPriceDrop(ctx: Ctx, productId: string, now: Date): Promise<{ sent: DispatchResult[] }> {
  const { product, seller } = await load(ctx, productId);
  const price = Number(product.price_minor);
  const fromPriceMinor = Number(product.previous_price_minor);
  const recent = product.price_lowered_at && now.getTime() - new Date(product.price_lowered_at).getTime() < CUT_VALID_MS;
  if (!(fromPriceMinor > price) || !recent) throw new InputError('price_not_lower');
  if ((await freeStock(ctx.db, productId)) <= 0) throw new InputError('price_drop_sold_out');
  const f = fmt(seller);
  const outs: Outbound[] = [];
  for (const w of await watchers(ctx, productId, price)) {
    const lang = w.language ?? seller.language;
    const to: Recipient = {
      sellerId: seller.id, from: seller.wa_phone_number_id, contactId: w.contact_id, to: w.wa_id,
      channel: 'whatsapp', lastInboundAt: w.last_inbound_at, country: seller.country, language: lang,
    };
    const facts = { name: w.name, product, priceMinor: price, oldPriceMinor: fromPriceMinor };
    outs.push({
      ...to, kind: 'text', body: say(lang, 'priceDrop', facts, f), imageUrl: photoUrl(ctx, product) ?? undefined,
      fallback: { template: 'priceDrop', category: 'marketing', params: slots(lang, 'priceDrop', facts, f), preview: say(lang, 'priceDrop', facts, f) },
    });
    await ctx.db.query(
      'insert into price_alert_sends (seller_id, contact_id, product_id, old_price_minor, new_price_minor, sent_at) values ($1, $2, $3, $4, $5, $6)',
      [seller.id, w.contact_id, productId, fromPriceMinor, price, now],
    );
    // "Répondez OUI pour le commander": a yes places the order.
    await ctx.db.query(
      'update contacts set awaiting_order_product_id = $2, awaiting_order_at = $3, awaiting_consent_product_id = null, awaiting_consent_at = null where id = $1',
      [w.contact_id, productId, now],
    );
  }
  return { sent: await dispatch(ctx, outs, now) };
}
