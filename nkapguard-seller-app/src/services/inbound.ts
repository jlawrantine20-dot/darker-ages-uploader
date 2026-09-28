import type { SocialChannel, SocialInbound } from '../channels/meta.js';
import type { InboundText } from '../channels/whatsapp.js';
import { parts, productLabel, say } from '../domain/copy.js';
import { asksAvailability, asksDelivery, detectZone, isBargain, detectLanguage, detectProduct, fold, isAlertRequest, isConsentYes, isOrderRequest, isStop, orderQuantity, pickVariant, productFamily } from '../domain/intent.js';
import { CONSENT_PROMPT_TTL_MS } from '../domain/windows.js';
import type { Q } from '../db.js';
import type { Ctx, DispatchResult, Outbound, Recipient } from './context.js';
import { appBase } from './channels.js';
import { dispatch, socialAccount, socialFor } from './outbound.js';
import { photoUrl } from './photos.js';
import { messageNotice, notifyShop, orderNotice } from './push.js';
import { HELD_BY_ORDERS_SQL, createOrder, heldOrder, takesPaymentsOnline } from './orders.js';
import { fmt, type Seller } from './sellers.js';

export type InboundAction =
  | 'unknown_seller' | 'stopped' | 'joined' | 'already_waiting' | 'offered' | 'in_stock' | 'asked_variant' | 'sold_out' | 'shop_link' | 'unhandled'
  | 'ordered' | 'ordered_manual' | 'order_again' | 'asked_quantity' | 'asked_zone' | 'delivery_fee'
  | 'price_alert_offered' | 'price_alert_joined' | 'duplicate';

interface ContactRow {
  id: string;
  seller_id: string;
  wa_id: string;
  name: string | null;
  last_inbound_at: Date | null;
  awaiting_consent_product_id: string | null;
  awaiting_consent_at: Date | null;
  language: 'en' | 'fr' | null;
  awaiting_choice_name: string | null;
  awaiting_choice_at: Date | null;
  awaiting_order_product_id: string | null;
  awaiting_order_at: Date | null;
  delivery_zone_id: string | null;
  awaiting_zone_at: Date | null;
  pending_order_product_id: string | null;
  pending_order_quantity: number | null;
  awaiting_price_alert_product_id: string | null;
  awaiting_price_alert_at: Date | null;
  channel: string;
}

interface ZoneRow {
  id: string;
  name: string;
  aliases: string[];
  fee_minor: number;
}

interface ProductRow {
  id: string;
  name: string;
  variant: string;
  aliases: string[];
  price_minor: number;
  stock: number;
  photo_version: string | null;
}

/** Units on the shelf not already held for someone: a waitlister's restock hold or an unpaid chat order. */
export async function freeStock(q: Q, productId: string): Promise<number> {
  const [row] = await q.query<{ free: number }>(
    `select p.stock - coalesce((select count(*)::int from offers o join restocks r on r.id = o.restock_id
                                 where r.product_id = p.id and o.status = 'held'), 0)
                    - ${HELD_BY_ORDERS_SQL} as free
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

/** One incoming customer message, from any channel. */
interface Incoming {
  channel: 'whatsapp' | SocialChannel;
  from: string;
  name?: string | null;
  username?: string | null;
  text: string;
  providerId: string;
  at: Date;
}

interface AccountRow {
  id: string;
  seller_id: string;
  channel: SocialChannel;
  external_id: string;
  enabled: boolean;
  comment_replies: boolean;
}

export async function handleInbound(ctx: Ctx, msg: InboundText): Promise<{ action: InboundAction; sent: DispatchResult[] }> {
  const [seller] = await ctx.db.query<Seller>('select * from sellers where wa_phone_number_id = $1', [msg.phoneNumberId]);
  if (!seller) return { action: 'unknown_seller', sent: [] };
  return handle(ctx, seller, null, { channel: 'whatsapp', from: msg.from, name: msg.name, text: msg.text, providerId: msg.providerId, at: msg.at });
}

/**
 * An Instagram or Messenger DM or comment. Nothing happens unless the shop connected that
 * account and has it switched on: the channels are optional, per shop.
 */
export async function handleSocialInbound(ctx: Ctx, m: SocialInbound): Promise<{ action: InboundAction | 'ignored'; sent: DispatchResult[] }> {
  const [account] = await ctx.db.query<AccountRow>('select * from channel_accounts where channel = $1 and external_id = $2', [m.channel, m.accountId]);
  if (!account) return { action: 'unknown_seller', sent: [] };
  if (!account.enabled) return { action: 'ignored', sent: [] };
  const seller = (await ctx.db.query<Seller>('select * from sellers where id = $1', [account.seller_id]))[0];
  // DMs carry no name; ask the platform once, for customers we haven't seen.
  let name = m.name ?? null;
  let username = m.username ?? null;
  if (!name) {
    const [known] = await ctx.db.query<{ name: string | null }>('select name from contacts where seller_id = $1 and channel = $2 and wa_id = $3', [seller.id, m.channel, m.from]);
    if (!known?.name) {
      const acct = await socialAccount(ctx, account.id);
      const p = acct ? await socialFor(ctx).profile(acct, m.from).catch(() => ({ name: null, username: null })) : null;
      name = p?.name ?? null;
      username = username ?? p?.username ?? null;
    }
  }
  const incoming: Incoming = { channel: m.channel, from: m.from, name, username, text: m.text, providerId: m.providerId, at: m.at };
  if (m.comment) return handleComment(ctx, seller, account, incoming, m.comment);
  return handle(ctx, seller, account, incoming);
}

/** "Bonjour, prévenez-moi quand le modèle X revient" as a WhatsApp link: one tap joins the waitlist there. */
function whatsappAlertLink(seller: Seller, lang: string, product: { name: string; variant: string }): string | null {
  if (!seller.wa_display_phone) return null;
  const base = parts(lang)[0];
  const label = productLabel(product, base);
  const text = base === 'fr' ? `Bonjour, prévenez-moi quand le modèle ${label} revient, s'il vous plaît.` : `Hi, please let me know when the ${label} is back.`;
  return `https://wa.me/${seller.wa_display_phone}?text=${encodeURIComponent(text)}`;
}

async function upsertContact(q: Q, seller: Seller, account: AccountRow | null, msg: Incoming, opensWindow: boolean): Promise<ContactRow> {
  const [contact] = await q.query<ContactRow>(
    `insert into contacts (seller_id, channel, wa_id, name, username, channel_account_id, last_inbound_at, language)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (seller_id, channel, wa_id) do update
       set name = coalesce(excluded.name, contacts.name),
           username = coalesce(excluded.username, contacts.username),
           channel_account_id = coalesce(excluded.channel_account_id, contacts.channel_account_id),
           last_inbound_at = greatest(contacts.last_inbound_at, excluded.last_inbound_at),
           language = coalesce(excluded.language, contacts.language)
     returning *`,
    [seller.id, msg.channel, msg.from, msg.name ?? null, msg.username ?? null, account?.id ?? null, opensWindow ? msg.at : null, detectLanguage(msg.text)],
  );
  return contact;
}

async function handle(ctx: Ctx, seller: Seller, account: AccountRow | null, msg: Incoming): Promise<{ action: InboundAction; sent: DispatchResult[] }> {
  const f = fmt(seller);
  const whatsapp = msg.channel === 'whatsapp';

  const { action, outs, contact } = await ctx.db.tx(async (q) => {
    const contact = await upsertContact(q, seller, account, msg, true);
    const logged = await q.query(
      `insert into messages (seller_id, contact_id, channel, direction, kind, body, provider_id, created_at)
       values ($1, $2, $3, 'in', 'text', $4, $5, $6)
       on conflict (seller_id, channel, provider_id) where direction = 'in' and provider_id is not null do nothing
       returning id`,
      [seller.id, contact.id, msg.channel, msg.text, msg.providerId, msg.at],
    );
    // A second delivery of a message we already handled: answer nothing.
    if (!logged.length) return { action: 'duplicate' as const, outs: [] as Outbound[], contact };
    // Answer in the language the customer writes in; it's remembered for later alerts.
    const lang = contact.language ?? seller.language;
    const to: Recipient = {
      sellerId: seller.id, from: whatsapp ? seller.wa_phone_number_id : account!.id, contactId: contact.id, to: contact.wa_id,
      lastInboundAt: contact.last_inbound_at, country: seller.country, language: lang, channel: msg.channel,
    };
    const reply = (body: string): Outbound[] => [{ ...to, kind: 'text', body }];
    return { ...(await decide(ctx, q, seller, contact, msg, lang, f, reply)), contact };
  });

  if (action === 'duplicate') return { action, sent: [] };
  const sent = await dispatch(ctx, outs, msg.at);
  // Tell the seller's phones: a new order, or simply a new message.
  const who = contact.name ?? (whatsapp ? `+${contact.wa_id}` : msg.username ? `@${msg.username}` : contact.wa_id);
  const [order] = action === 'ordered' || action === 'ordered_manual'
    ? await ctx.db.query<{ quantity: number; amount_minor: string; name: string; variant: string }>(
        `select o.quantity, o.amount_minor, p.name, p.variant from orders o join products p on p.id = o.product_id
          where o.contact_id = $1 order by o.created_at desc limit 1`,
        [contact.id],
      )
    : [];
  await notifyShop(ctx, seller.id, order
    ? orderNotice(who, order, order.quantity, { minor: Number(order.amount_minor), currency: seller.currency, country: seller.country })
    : messageNotice(who, msg.text, contact.id));
  return { action, sent };
}

/** What to answer. Waitlists and consent live on WhatsApp; Instagram and Messenger hand off to it. */
async function decide(
  ctx: Ctx, q: Q, seller: Seller, contact: ContactRow, msg: Incoming, lang: string, f: ReturnType<typeof fmt>,
  reply: (body: string) => Outbound[],
): Promise<{ action: InboundAction; outs: Outbound[] }> {
  const whatsapp = msg.channel === 'whatsapp';

  const joinWaitlist = async (product: ProductRow) => {
    await q.query('update contacts set awaiting_consent_product_id = null, awaiting_consent_at = null where id = $1', [contact.id]);
    const [existing] = await q.query<{ id: string }>(
      `select id from interests where product_id = $1 and contact_id = $2 and status = 'waiting'`,
      [product.id, contact.id],
    );
    if (existing) {
      return { action: 'already_waiting' as const, outs: reply(say(lang, 'alreadyWaiting', { product, position: await waitlistPosition(q, existing.id) }, f)) };
    }
    // The customer's own words are the consent record.
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
  };

  if (whatsapp && isStop(msg.text)) {
    await q.query('update consents set revoked_at = $2 where contact_id = $1 and revoked_at is null', [contact.id, msg.at]);
    await q.query(`update interests set status = 'removed' where contact_id = $1 and status = 'waiting'`, [contact.id]);
    await q.query('update contacts set awaiting_consent_product_id = null, awaiting_consent_at = null where id = $1', [contact.id]);
    return { action: 'stopped', outs: reply(say(lang, 'stopped', { seller: seller.name }, f)) };
  }

  const promptLive =
    contact.awaiting_consent_product_id &&
    contact.awaiting_consent_at &&
    msg.at.getTime() - contact.awaiting_consent_at.getTime() < CONSENT_PROMPT_TTL_MS;
  if (whatsapp && promptLive && isConsentYes(msg.text)) {
    const [product] = await q.query<ProductRow>('select * from products where id = $1', [contact.awaiting_consent_product_id]);
    return joinWaitlist(product);
  }

  // A yes to "want us to tell you if the price drops?": their words are the consent record.
  const priceLive =
    contact.awaiting_price_alert_product_id &&
    contact.awaiting_price_alert_at &&
    msg.at.getTime() - contact.awaiting_price_alert_at.getTime() < CONSENT_PROMPT_TTL_MS;
  if (whatsapp && priceLive && isConsentYes(msg.text)) {
    const [product] = await q.query<ProductRow>('select * from products where id = $1', [contact.awaiting_price_alert_product_id]);
    // They may still decide to buy at today's price: "je le prends" keeps working.
    await q.query(
      'update contacts set awaiting_price_alert_product_id = null, awaiting_price_alert_at = null, awaiting_order_product_id = $2, awaiting_order_at = $3 where id = $1',
      [contact.id, product.id, msg.at],
    );
    const [existing] = await q.query(
      `select 1 from consents where contact_id = $1 and product_id = $2 and purpose = 'price_alert' and revoked_at is null`,
      [contact.id, product.id],
    );
    if (!existing) {
      await q.query(
        `insert into consents (seller_id, contact_id, channel, purpose, product_id, quote, granted_at) values ($1, $2, 'whatsapp', 'price_alert', $3, $4, $5)`,
        [seller.id, contact.id, product.id, msg.text, msg.at],
      );
    }
    return { action: 'price_alert_joined' as const, outs: reply(say(lang, 'priceAlertJoined', { product }, f)) };
  }

  // Answer about one product: in stock with the price, or sold out with a way to get an alert.
  const answerFor = async (product: ProductRow) => {
    await q.query('update contacts set awaiting_choice_name = null, awaiting_choice_at = null where id = $1', [contact.id]);
    const free = await freeStock(q, product.id);
    if (free > 0) {
      // "To order, reply YES": remember what a yes would be for.
      await q.query('update contacts set awaiting_order_product_id = $2, awaiting_order_at = $3, awaiting_consent_product_id = null, awaiting_consent_at = null where id = $1', [contact.id, product.id, msg.at]);
      // With the product's photo when it has one: customers buy what they can see.
      const outs = reply(say(lang, 'inStock', { name: contact.name, product, priceMinor: product.price_minor, stock: free }, f));
      const photo = photoUrl(ctx, product);
      if (photo && outs[0]?.kind === 'text') outs[0].imageUrl = photo;
      return { action: 'in_stock' as const, outs };
    }
    if (whatsapp) {
      // "Prévenez-moi quand … revient" (from the shop page or an Instagram hand-off) is a clear yes already.
      if (isAlertRequest(msg.text)) return joinWaitlist(product);
      await q.query('update contacts set awaiting_consent_product_id = $2, awaiting_consent_at = $3, awaiting_order_product_id = null, awaiting_order_at = null where id = $1', [contact.id, product.id, msg.at]);
      return { action: 'offered' as const, outs: reply(say(lang, 'offerAlert', { name: contact.name, product }, f)) };
    }
    // Instagram and Messenger can't send an alert days later, so the alert moves to WhatsApp.
    const url = whatsappAlertLink(seller, lang, product);
    return url
      ? { action: 'offered' as const, outs: reply(say(lang, 'offerWhatsApp', { name: contact.name, product, url }, f)) }
      : { action: 'sold_out' as const, outs: reply(say(lang, 'soldOutPlain', { name: contact.name, product }, f)) };
  };
  const catalog = () => q.query<ProductRow>('select * from products where seller_id = $1', [seller.id]);

  const zones = await q.query<ZoneRow>('select * from delivery_zones where seller_id = $1 order by fee_minor, name', [seller.id]);
  const knownZone = () => zones.find((z) => z.id === contact.delivery_zone_id) ?? null;

  /** Hold the units for an hour and send the payment link, or say how many are left. */
  const placeOrder = async (product: ProductRow, quantity: number) => {
    const free = await freeStock(q, product.id);
    const again = await heldOrder(q, contact.id, product.id);
    const until = (o: { expires_at: Date }) => o.expires_at;
    const link = (ref: string) => `${ctx.config.publicUrl.replace(/\/$/, '')}/pay/${ref}`;
    // Already held for them: repeat it rather than holding more units.
    if (again) {
      const againZone = again.delivery_zone ? { name: again.delivery_zone, fee_minor: Number(again.delivery_fee_minor) } : undefined;
      const facts = { product, quantity: again.quantity, priceMinor: Number(again.amount_minor), until: until(again), url: link(again.payment_ref), zone: againZone };
      return { action: 'order_again' as const, outs: reply(say(lang, takesPaymentsOnline(ctx, seller) ? 'orderAgain' : 'orderManual', facts, f)) };
    }
    if (free <= 0) return answerFor(product);
    if (quantity > free) {
      await q.query('update contacts set awaiting_order_product_id = $2, awaiting_order_at = $3 where id = $1', [contact.id, product.id, msg.at]);
      return { action: 'asked_quantity' as const, outs: reply(say(lang, 'orderShort', { product, stock: free }, f)) };
    }
    // A shop that delivers needs the customer's area first; it's remembered for next time.
    const zone = zones.length ? detectZone(msg.text, zones) ?? knownZone() : null;
    if (zones.length && !zone) {
      await q.query(
        `update contacts set awaiting_order_product_id = null, awaiting_order_at = null, awaiting_zone_at = $2,
                pending_order_product_id = $3, pending_order_quantity = $4 where id = $1`,
        [contact.id, msg.at, product.id, quantity],
      );
      return { action: 'asked_zone' as const, outs: reply(say(lang, 'askZone', { zones }, f)) };
    }
    await q.query(
      `update contacts set awaiting_order_product_id = null, awaiting_order_at = null, awaiting_choice_name = null, awaiting_choice_at = null,
              awaiting_zone_at = null, pending_order_product_id = null, pending_order_quantity = null, delivery_zone_id = coalesce($2, delivery_zone_id)
        where id = $1`,
      [contact.id, zone?.id ?? null],
    );
    const order = await createOrder(q, seller.id, contact.id, product, quantity, msg.channel, msg.at, zone);
    const facts = { product, quantity, priceMinor: Number(order.amount_minor), until: order.expires_at, url: link(order.payment_ref), zone: zone ?? undefined };
    // Without an online payment provider, the seller arranges payment (cash, mobile money transfer) and marks it paid.
    return takesPaymentsOnline(ctx, seller)
      ? { action: 'ordered' as const, outs: reply(say(lang, 'orderLink', facts, f)) }
      : { action: 'ordered_manual' as const, outs: reply(say(lang, 'orderManual', facts, f)) };
  };

  // Bargaining ("trop cher", "last price?") about a product we know: offer a price-drop alert.
  // Only on WhatsApp, the one channel that can message them later.
  if (whatsapp && isBargain(msg.text) && !isOrderRequest(msg.text)) {
    const recent = contact.awaiting_order_product_id && contact.awaiting_order_at && msg.at.getTime() - contact.awaiting_order_at.getTime() < CONSENT_PROMPT_TTL_MS;
    const named = detectProduct(msg.text, await catalog());
    const [product] = named ? [named] : recent ? await q.query<ProductRow>('select * from products where id = $1', [contact.awaiting_order_product_id]) : [];
    if (product) {
      await q.query(
        `update contacts set awaiting_price_alert_product_id = $2, awaiting_price_alert_at = $3,
                awaiting_consent_product_id = null, awaiting_consent_at = null, awaiting_order_product_id = null, awaiting_order_at = null
          where id = $1`,
        [contact.id, product.id, msg.at],
      );
      return { action: 'price_alert_offered' as const, outs: reply(say(lang, 'priceAlertOffer', { name: contact.name, product, priceMinor: product.price_minor }, f)) };
    }
  }

  // The answer to "which area?": finish the waiting order, or give that area's fee.
  const zoneLive = contact.awaiting_zone_at && msg.at.getTime() - contact.awaiting_zone_at.getTime() < CONSENT_PROMPT_TTL_MS;
  const namedZone = zones.length ? detectZone(msg.text, zones) : null;
  if (zoneLive && namedZone) {
    await q.query('update contacts set delivery_zone_id = $2, awaiting_zone_at = null where id = $1', [contact.id, namedZone.id]);
    contact.delivery_zone_id = namedZone.id;
    if (contact.pending_order_product_id) {
      const [product] = await q.query<ProductRow>('select * from products where id = $1', [contact.pending_order_product_id]);
      if (product) return placeOrder(product, contact.pending_order_quantity ?? 1);
    }
    return { action: 'delivery_fee' as const, outs: reply(say(lang, 'deliveryFee', { zone: namedZone }, f)) };
  }
  // "La livraison à Akwa c'est combien ?" on its own; a product question gets the fee added below.
  const deliveryQuestion = zones.length > 0 && asksDelivery(msg.text);
  if (deliveryQuestion && !detectProduct(msg.text, await catalog()) && !isOrderRequest(msg.text)) {
    if (namedZone) {
      await q.query('update contacts set delivery_zone_id = $2 where id = $1', [contact.id, namedZone.id]);
      return { action: 'delivery_fee' as const, outs: reply(say(lang, 'deliveryFee', { zone: namedZone }, f)) };
    }
    await q.query('update contacts set awaiting_zone_at = $2, pending_order_product_id = null, pending_order_quantity = null where id = $1', [contact.id, msg.at]);
    return { action: 'delivery_fee' as const, outs: reply(say(lang, 'deliveryZones', { zones }, f)) };
  }

  // "Oui", "je le prends" or "2" right after "to order, reply YES".
  const orderLive =
    contact.awaiting_order_product_id &&
    contact.awaiting_order_at &&
    msg.at.getTime() - contact.awaiting_order_at.getTime() < CONSENT_PROMPT_TTL_MS;
  const quantity = orderQuantity(msg.text);
  if (orderLive && (isConsentYes(msg.text) || isOrderRequest(msg.text) || /^\s*\d{1,2}\s*$/.test(msg.text))) {
    // "Je prends plutôt le noir" names another product: that one wins.
    const named = isOrderRequest(msg.text) ? detectProduct(msg.text, await catalog()) : null;
    const [product] = named ? [named] : await q.query<ProductRow>('select * from products where id = $1', [contact.awaiting_order_product_id]);
    if (product) return placeOrder(product, quantity ?? 1);
  }
  // "Je voudrais commander le modèle … noir" in one message, as the shop page writes it.
  if (isOrderRequest(msg.text)) {
    const product = detectProduct(msg.text, await catalog());
    if (product) return placeOrder(product, quantity ?? 1);
  }

  // A short answer to "which one?" ("jet black", "le noir") picks the variant.
  const choiceLive =
    contact.awaiting_choice_name &&
    contact.awaiting_choice_at &&
    msg.at.getTime() - contact.awaiting_choice_at.getTime() < CONSENT_PROMPT_TTL_MS;
  if (choiceLive) {
    const family = (await catalog()).filter((p) => fold(p.name) === contact.awaiting_choice_name);
    const picked = pickVariant(msg.text, family);
    if (picked) return answerFor(picked);
  }

  if (asksAvailability(msg.text) || isAlertRequest(msg.text) || msg.text.includes('?')) {
    const products = await catalog();
    const product = detectProduct(msg.text, products);
    if (product) {
      const answer = await answerFor(product);
      // "Vous avez le noir ? Et la livraison à Akwa ?": one reply answers both.
      const first = answer.outs[0];
      if (deliveryQuestion && namedZone && first?.kind === 'text') {
        first.body = `${first.body} ${say(lang, 'deliveryFee', { zone: namedZone }, f)}`;
        await q.query('update contacts set delivery_zone_id = $2 where id = $1', [contact.id, namedZone.id]);
      }
      return answer;
    }
    // The product comes in several variants and the customer didn't say which: list them.
    const family = productFamily(msg.text, products);
    if (family) {
      const options = [];
      for (const p of family) options.push({ variant: p.variant, free: await freeStock(q, p.id) });
      await q.query('update contacts set awaiting_choice_name = $2, awaiting_choice_at = $3 where id = $1', [contact.id, fold(family[0].name), msg.at]);
      return {
        action: 'asked_variant',
        outs: reply(say(lang, 'whichVariant', { name: contact.name, product: { name: family[0].name, variant: '' }, options }, f)),
      };
    }
  }
  return { action: 'unhandled', outs: [] };
}

/** Comment words that are worth a private reply: a price or stock question. */
const COMMENT_QUESTION = /\?|\b(prix|combien|dispo|disponible|price|how much|cost|available|in stock|still have|una get)\b/i;

/**
 * A comment on the shop's post. Platforms allow one private reply per comment (within 7
 * days); the chat only continues if the person answers. Only comments that ask about price
 * or stock get one, at most once per person per post per day.
 */
async function handleComment(
  ctx: Ctx, seller: Seller, account: AccountRow, msg: Incoming, comment: { id: string; postId: string },
): Promise<{ action: InboundAction | 'ignored'; sent: DispatchResult[] }> {
  if (!account.comment_replies || !COMMENT_QUESTION.test(fold(msg.text))) return { action: 'ignored', sent: [] };
  const f = fmt(seller);
  const { action, outs } = await ctx.db.tx(async (q) => {
    const [recent] = await q.query(
      `select 1 from comment_replies where account_id = $1 and commenter_id = $2 and post_id = $3 and created_at > $4`,
      [account.id, msg.from, comment.postId, new Date(msg.at.getTime() - 24 * 3600_000)],
    );
    if (recent) return { action: 'ignored' as const, outs: [] as Outbound[] };
    // A comment doesn't open a chat window; only the person's reply does.
    const contact = await upsertContact(q, seller, account, msg, false);
    await q.query(
      `insert into messages (seller_id, contact_id, channel, direction, kind, body, provider_id, created_at)
       values ($1, $2, $3, 'in', 'text', $4, $5, $6)
       on conflict (seller_id, channel, provider_id) where direction = 'in' and provider_id is not null do nothing`,
      [seller.id, contact.id, msg.channel, `Comment on your post: ${msg.text}`, msg.providerId, msg.at],
    );
    const lang = contact.language ?? seller.language;
    const to: Recipient = {
      sellerId: seller.id, from: account.id, contactId: contact.id, to: contact.wa_id,
      lastInboundAt: contact.last_inbound_at, country: seller.country, language: lang, channel: msg.channel, commentId: comment.id,
    };
    const reply = (body: string): Outbound[] => [{ ...to, kind: 'text', body }];
    let decided = await decide(ctx, q, seller, contact, msg, lang, f, reply);
    if (decided.action === 'unhandled') {
      // No product named ("prix ?"): send the shop page, which lists everything with prices.
      if (!seller.slug) return { action: 'ignored' as const, outs: [] as Outbound[] };
      const url = `${appBase(ctx.config)}/shop.html?s=${encodeURIComponent(seller.slug)}`;
      decided = { action: 'shop_link', outs: reply(say(lang, 'commentReply', { name: contact.name ?? msg.username, url }, f)) };
    }
    await q.query('insert into comment_replies (account_id, commenter_id, post_id, created_at) values ($1, $2, $3, $4)', [account.id, msg.from, comment.postId, msg.at]);
    return decided;
  });
  return { action, sent: await dispatch(ctx, outs, msg.at) };
}
