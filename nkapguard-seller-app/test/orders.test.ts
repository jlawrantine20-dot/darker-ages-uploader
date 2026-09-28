import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney } from '../src/domain/money.js';
import { isOrderRequest, orderQuantity } from '../src/domain/intent.js';
import { createApp } from '../src/app.js';
import { freeStock, handleInbound } from '../src/services/inbound.js';
import { expireOrders, markOrderPaid } from '../src/services/orders.js';
import { handlePayment } from '../src/services/restock.js';
import { T0, at, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});

const orders = () => env.db.query<{ payment_ref: string; status: string; quantity: number; amount_minor: string; paid_via: string | null }>('select * from orders order by created_at');
const stock = async (id: string) => (await env.db.query<{ stock: number }>('select stock from products where id = $1', [id]))[0].stock;
const last = () => env.channel.sent.at(-1)?.body ?? '';

describe('Reading an order', () => {
  it('knows an order from a question', () => {
    for (const t of ['je le prends', "j'en prends 2", 'je voudrais commander le modèle Claw Clip noir', "I'll take two", 'I want it', 'make I buy am', 'comment commander ?']) {
      expect(isOrderRequest(t), t).toBe(true);
    }
    for (const t of ['vous avez le claw clip noir ?', "c'est combien ?", 'I want to know the price', 'oui']) expect(isOrderRequest(t), t).toBe(false);
  });
  it('reads a quantity only next to an order or unit word', () => {
    expect(orderQuantity("j'en prends 2")).toBe(2);
    expect(orderQuantity("I'll take three")).toBe(3);
    expect(orderQuantity('je veux 3 pièces')).toBe(3);
    expect(orderQuantity('4')).toBe(4);
    expect(orderQuantity('Perruque lisse 20 pouces')).toBeNull();
    expect(orderQuantity('je le prends')).toBeNull();
  });
});

describe('Ordering in the chat', () => {
  it('holds the item, sends a payment link, and confirms when paid', async () => {
    env = await setup({ language: 'fr' });
    await handleInbound(env.ctx, inbound(wa(1), 'vous avez le claw clip ponytail noir ?', T0, 'Paul Eto'));
    expect(last()).toContain('Pour le commander, répondez simplement OUI.');
    const r = await handleInbound(env.ctx, inbound(wa(1), 'oui', at(1)));
    expect(r.action).toBe('ordered');
    const [o] = await orders();
    expect(o).toMatchObject({ status: 'held', quantity: 1 });
    expect(last()).toBe(`Parfait, le modèle 12" Claw Clip Ponytail noir est à vous ! Nous vous le réservons jusqu'à 11:01. Réglez ${formatMoney(15000, 'XAF', 'fr', 'CM')} ici pour confirmer votre commande :\nhttps://nkapguard.test/pay/${o.payment_ref}`);
    // The held unit can't be sold to someone else meanwhile.
    expect(await freeStock(env.db, env.black)).toBe(5);
    expect(await stock(env.black)).toBe(6);

    const paid = await handlePayment(env.ctx, { reference: `${o.payment_ref}.abc`, amountMinor: env.clipPrice }, at(20));
    expect(paid.outcome).toBe('paid');
    expect(await stock(env.black)).toBe(5);
    expect(await freeStock(env.db, env.black)).toBe(5);
    expect(last()).toBe('Paiement bien reçu, merci ! Le modèle 12" Claw Clip Ponytail noir est à vous. Nous revenons très vite vers vous pour la livraison.');
    expect((await orders())[0]).toMatchObject({ status: 'paid', paid_via: 'online' });
    // A second webhook for the same payment changes nothing.
    expect((await handlePayment(env.ctx, { reference: o.payment_ref, amountMinor: env.clipPrice }, at(21))).outcome).toBe('duplicate');
    expect(await stock(env.black)).toBe(5);
  });

  it('takes a quantity and an order in one message, as the shop page writes it', async () => {
    env = await setup();
    const r = await handleInbound(env.ctx, inbound(wa(2), "Hi, I'd like to order the jet black claw clip ponytail, I'll take two", T0, 'Amaka Obi'));
    expect(r.action).toBe('ordered');
    const [o] = await orders();
    expect(o.quantity).toBe(2);
    expect(Number(o.amount_minor)).toBe(env.clipPrice * 2);
    expect(last()).toMatch(/^Great, 2 × jet black 12" Claw Clip Ponytail are yours! We're holding them for you until 11:00 AM\. Pay FCFA 30,000 here/);
  });

  it("orders straight from the shop page's button", async () => {
    env = await setup({ language: 'fr' });
    const r = await handleInbound(env.ctx, inbound(wa(10), `Bonjour, je voudrais commander le modèle 12" Claw Clip Ponytail noir, s'il vous plaît.`, T0));
    expect(r.action).toBe('ordered');
    expect(last()).toContain('est à vous !');
  });

  it('asks how many when the customer wants more than is left', async () => {
    env = await setup();
    await handleInbound(env.ctx, inbound(wa(3), 'do you have the jet black claw clip ponytail?', T0));
    const r = await handleInbound(env.ctx, inbound(wa(3), 'I want 10 pieces', at(1)));
    expect(r.action).toBe('asked_quantity');
    expect(last()).toBe('We only have 6 left of the jet black 12" Claw Clip Ponytail. How many would you like?');
    expect((await handleInbound(env.ctx, inbound(wa(3), '4', at(2)))).action).toBe('ordered');
    expect((await orders())[0].quantity).toBe(4);
  });

  it('resends the same link instead of holding twice', async () => {
    env = await setup();
    await handleInbound(env.ctx, inbound(wa(4), 'do you have the jet black claw clip ponytail?', T0));
    await handleInbound(env.ctx, inbound(wa(4), 'yes', at(1)));
    const r = await handleInbound(env.ctx, inbound(wa(4), "I'll take the jet black claw clip ponytail", at(5)));
    expect(r.action).toBe('order_again');
    expect((await orders()).length).toBe(1);
    expect(last()).toContain(`/pay/${(await orders())[0].payment_ref}`);
  });

  it('offers an alert instead when the item is sold out', async () => {
    env = await setup();
    const r = await handleInbound(env.ctx, inbound(wa(5), "I'll take the brown claw clip ponytail", T0));
    expect(r.action).toBe('offered');
    expect((await orders()).length).toBe(0);
  });

  it('puts the unit back on sale when the hour runs out, and handles a late payment', async () => {
    env = await setup();
    await env.db.query('update products set stock = 1 where id = $1', [env.black]);
    await handleInbound(env.ctx, inbound(wa(6), 'do you have the jet black claw clip ponytail?', T0));
    await handleInbound(env.ctx, inbound(wa(6), 'yes', at(1)));
    expect(await freeStock(env.db, env.black)).toBe(0);
    expect(await expireOrders(env.ctx, at(62))).toBe(1);
    expect(await freeStock(env.db, env.black)).toBe(1);
    // The payment link now shows a clear page instead of a checkout.
    const [o] = await orders();
    const page = await createApp(env.ctx, () => at(63)).request(`/pay/${o.payment_ref}`);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain('The hour to pay for this order has passed');

    // Someone else buys the last one; then the first customer's late payment lands: refund.
    await handleInbound(env.ctx, inbound(wa(7), 'do you have the jet black claw clip ponytail?', at(64)));
    await handleInbound(env.ctx, inbound(wa(7), 'yes', at(65)));
    const second = (await orders())[1];
    expect((await handlePayment(env.ctx, { reference: second.payment_ref, amountMinor: env.clipPrice }, at(66))).outcome).toBe('paid');
    expect((await handlePayment(env.ctx, { reference: o.payment_ref, amountMinor: env.clipPrice }, at(67))).outcome).toBe('refund_due');
    expect(last()).toContain("We're refunding you in full");
    expect(await stock(env.black)).toBe(0);
  });

  it('lets the seller take cash or a transfer when no payment provider is connected', async () => {
    env = await setup({ language: 'fr' });
    env.ctx.config = { ...env.ctx.config, dryRun: false };
    await handleInbound(env.ctx, inbound(wa(8), 'vous avez le claw clip ponytail noir ?', T0, 'Carine Fouda'));
    const r = await handleInbound(env.ctx, inbound(wa(8), "d'accord je le prends", at(1)));
    expect(r.action).toBe('ordered_manual');
    expect(last()).toBe(`Parfait, c'est noté ! Nous vous mettons le modèle 12" Claw Clip Ponytail noir de côté jusqu'à 11:01. Nous vous écrivons très vite pour le paiement de ${formatMoney(15000, 'XAF', 'fr', 'CM')}.`);
    const [{ id }] = await env.db.query<{ id: string }>('select id from orders');
    expect((await markOrderPaid(env.ctx, id, at(30))).outcome).toBe('paid');
    expect((await orders())[0]).toMatchObject({ status: 'paid', paid_via: 'manual' });
    expect(await stock(env.black)).toBe(5);
    expect(last()).toContain('Paiement bien reçu');
  });

  it('shows orders to the seller, who can cancel an unpaid one', async () => {
    env = await setup();
    await handleInbound(env.ctx, inbound(wa(9), 'do you have the jet black claw clip ponytail?', T0, 'Tunde Bakare'));
    await handleInbound(env.ctx, inbound(wa(9), 'yes', at(1)));
    const app = createApp(env.ctx, () => at(2));
    const list = await (await app.request(`/api/orders?sellerId=${env.sellerId}`)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Tunde Bakare', status: 'held', quantity: 1, amount_minor: env.clipPrice, variant: 'Jet black' });
    expect((await app.request(`/api/orders/${list[0].id}/cancel`, { method: 'POST' })).status).toBe(200);
    expect((await orders())[0].status).toBe('cancelled');
    expect(await freeStock(env.db, env.black)).toBe(6);
    const chats = await (await app.request(`/api/chats?sellerId=${env.sellerId}`)).json();
    expect(chats[0].order_status).toBe('cancelled');
  });
});
