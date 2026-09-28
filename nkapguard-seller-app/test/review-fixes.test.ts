// Regression tests for the full-system review: each case is a bug that was found and fixed.
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { orderQuantity } from '../src/domain/intent.js';
import { handleInbound } from '../src/services/inbound.js';
import { handlePayment, startRestock } from '../src/services/restock.js';
import { T0, at, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});
const json = (body: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const orders = () => env.db.query<{ status: string; amount_minor: string; delivery_fee_minor: string; payment_ref: string }>('select * from orders order by created_at');
async function orderFor(i: number) {
  await handleInbound(env.ctx, inbound(wa(i), 'do you have the jet black claw clip ponytail?', T0));
  expect((await handleInbound(env.ctx, inbound(wa(i), 'yes', at(1)))).action).toBe('ordered');
  return (await orders()).at(-1)!;
}

describe('Payments can only be real, and only for the right shop', () => {
  it('refuses the unsigned test webhook on a live server', async () => {
    env = await setup();
    const o = await orderFor(1);
    const live = createApp({ ...env.ctx, config: { ...env.ctx.config, dryRun: false } }, () => at(2));
    const r = await live.request(`/webhooks/payments/${env.sellerId}`, json({ reference: o.payment_ref, amountMinor: 15000 }));
    expect(r.status).toBe(404);
    expect((await orders())[0].status).toBe('held');
  });

  it("ignores another shop's payment reference", async () => {
    env = await setup();
    const o = await orderFor(2);
    const [other] = await env.db.query<{ id: string }>(
      `insert into sellers (name, wa_phone_number_id, country, currency, language, timezone) values ('Other', 'pn-x', 'CM', 'XAF', 'en', 'Africa/Douala') returning id`,
    );
    const r = await createApp(env.ctx, () => at(2)).request(`/webhooks/payments/${other.id}`, json({ reference: o.payment_ref, amountMinor: 15000 }));
    expect(await r.json()).toEqual({ outcome: 'unknown' });
    expect((await orders())[0].status).toBe('held');
  });
});

describe('Chat handling', () => {
  it("doesn't hold more units when a shop without online payments hears 'je le prends' again", async () => {
    env = await setup();
    env.ctx.config = { ...env.ctx.config, dryRun: false };
    await handleInbound(env.ctx, inbound(wa(3), 'do you have the jet black claw clip ponytail?', T0));
    expect((await handleInbound(env.ctx, inbound(wa(3), 'yes', at(1)))).action).toBe('ordered_manual');
    expect((await handleInbound(env.ctx, inbound(wa(3), "I'll take the jet black claw clip ponytail", at(2)))).action).toBe('order_again');
    expect(await orders()).toHaveLength(1);
  });

  it('handles a message Meta delivers twice only once', async () => {
    env = await setup();
    const msg = inbound(wa(4), 'do you have the jet black claw clip ponytail?', T0);
    await handleInbound(env.ctx, msg);
    expect((await handleInbound(env.ctx, msg)).action).toBe('duplicate');
    expect(await env.db.query(`select 1 from messages where direction = 'in'`)).toHaveLength(1);
    expect(env.channel.sent).toHaveLength(1);
  });

  it('reads "12 pouces" as a size, not twelve units', () => {
    expect(orderQuantity('je veux 12 pouces noir')).toBeNull();
    expect(orderQuantity('I want 20 inches')).toBeNull();
    expect(orderQuantity('je prends 2 perruques 20 pouces')).toBe(2);
  });
});

describe('Money stays right over time', () => {
  it('converts delivery fees and unpaid orders when the currency changes', async () => {
    env = await setup();
    const app = createApp(env.ctx, () => at(2));
    await app.request('/api/delivery-zones', json({ sellerId: env.sellerId, name: 'Akwa', fee: 1000 }));
    await handleInbound(env.ctx, inbound(wa(5), 'do you have the jet black claw clip ponytail?', T0));
    await handleInbound(env.ctx, inbound(wa(5), 'yes', at(1)));
    await handleInbound(env.ctx, inbound(wa(5), 'Akwa', at(1)));
    expect(Number((await orders())[0].amount_minor)).toBe(16000);
    // 1 XAF = 0.0016 EUR (in cents: 16 000 FCFA = 25.60 €).
    const r = await app.request(`/api/sellers/${env.sellerId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ country: 'FR', currency: 'EUR', timezone: 'Europe/Paris', rate: 0.0016 }) });
    expect(r.status).toBe(200);
    const [o] = await orders();
    expect(Number(o.amount_minor)).toBe(2560);
    expect(Number(o.delivery_fee_minor)).toBe(160);
    const [z] = await env.db.query<{ fee_minor: string }>('select fee_minor from delivery_zones');
    expect(Number(z.fee_minor)).toBe(160);
  });

  it('keeps past restock sales at the price that was paid', async () => {
    env = await setup();
    await handleInbound(env.ctx, inbound(wa(6), 'do you have the brown claw clip ponytail?', T0));
    await handleInbound(env.ctx, inbound(wa(6), 'yes', at(1)));
    await startRestock(env.ctx, { productId: env.brown, units: 1, mode: 'hold' }, at(5));
    const [{ payment_ref }] = await env.db.query<{ payment_ref: string }>('select payment_ref from offers');
    expect((await handlePayment(env.ctx, { reference: payment_ref, amountMinor: env.clipPrice }, at(6))).outcome).toBe('paid');
    await env.db.query('update products set price_minor = 9000 where id = $1', [env.brown]);
    const ins = await (await createApp(env.ctx, () => at(10)).request(`/api/insights?sellerId=${env.sellerId}`)).json();
    expect(Number(ins.sales.revenue_minor)).toBe(env.clipPrice);
  });
});
