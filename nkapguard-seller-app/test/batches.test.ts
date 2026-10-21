import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { freeStock, handleInbound } from '../src/services/inbound.js';
import { markOrderPaid } from '../src/services/orders.js';
import { handlePayment, startRestock } from '../src/services/restock.js';
import { T0, at, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});
const last = () => env.channel.sent.at(-1)?.body ?? '';
const product = async (id: string) => (await env.db.query<{ stock: number; batch_left: number | null }>('select stock, batch_left from products where id = $1', [id]))[0];
const batch = (id: string, stock: number, left: number | null) => env.db.query('update products set stock = $2, batch_left = $3 where id = $1', [id, stock, left]);

describe('Selling in batches', () => {
  it('only sells the current batch, and says so honestly', async () => {
    env = await setup({ language: 'fr' });
    await batch(env.black, 400, 3);
    expect(await freeStock(env.db, env.black)).toBe(3);
    await handleInbound(env.ctx, inbound(wa(1), 'vous avez le claw clip ponytail noir ?', T0));
    expect(last()).toContain('Il nous en reste 3 dans ce lot.');
    expect(last()).not.toContain('400');

    // A sale comes out of the stock and out of the batch.
    await handleInbound(env.ctx, inbound(wa(1), 'oui', at(1)));
    const [o] = await env.db.query<{ id: string }>('select id from orders');
    await markOrderPaid(env.ctx, o.id, at(5));
    expect(await product(env.black)).toEqual({ stock: 399, batch_left: 2 });
  });

  it('is sold out to customers once the batch is gone, even with stock in reserve', async () => {
    env = await setup();
    await batch(env.black, 400, 0);
    const r = await handleInbound(env.ctx, inbound(wa(2), 'do you have the jet black claw clip ponytail?', T0));
    expect(r.action).toBe('offered');
    expect(last()).toContain('sold out at the moment');
  });

  it('puts the next batch on sale from the reserve, alerting the waiting list first', async () => {
    env = await setup();
    await batch(env.black, 400, 0);
    await handleInbound(env.ctx, inbound(wa(3), 'do you have the jet black claw clip ponytail?', T0, 'Amaka Obi'));
    await handleInbound(env.ctx, inbound(wa(3), 'yes', at(1)));
    const r = await startRestock(env.ctx, { productId: env.black, units: 20, mode: 'hold', holdMinutes: 60, fromReserve: true }, at(10));
    expect(r.offered).toBe(1);
    // No new stock: the batch comes out of the reserve.
    expect(await product(env.black)).toEqual({ stock: 400, batch_left: 20 });
    // One unit is held for the waiting customer; 19 are open to everyone.
    expect(await freeStock(env.db, env.black)).toBe(19);
    const [offer] = await env.db.query<{ payment_ref: string }>('select payment_ref from offers');
    await handlePayment(env.ctx, { reference: offer.payment_ref, amountMinor: env.clipPrice }, at(20));
    expect(await product(env.black)).toEqual({ stock: 399, batch_left: 19 });
  });

  it("can't put more on sale than the reserve holds", async () => {
    env = await setup();
    await batch(env.black, 30, 20);
    await expect(startRestock(env.ctx, { productId: env.black, units: 11, mode: 'hold', fromReserve: true }, T0)).rejects.toThrow();
  });

  it('adds new stock to the current batch', async () => {
    env = await setup();
    await batch(env.black, 10, 4);
    await startRestock(env.ctx, { productId: env.black, units: 5, mode: 'hold' }, T0);
    expect(await product(env.black)).toEqual({ stock: 15, batch_left: 9 });
  });

  it('is switched on and off from the product, and never exceeds the stock', async () => {
    env = await setup();
    const app = createApp(env.ctx, () => T0);
    const patch = async (body: unknown) => (await app.request(`/api/products/${env.black}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    expect((await patch({ batch: 10 })).batch_left).toBe(6); // only 6 in stock
    expect((await patch({ batch: 2 })).batch_left).toBe(2);
    expect((await patch({ stock: 1 })).batch_left).toBe(1); // a stock correction keeps the batch within it
    expect((await patch({ batch: null })).batch_left).toBeNull();
    expect((await app.request(`/api/products/${env.black}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch: 0 }) })).status).toBe(400);
  });
});
