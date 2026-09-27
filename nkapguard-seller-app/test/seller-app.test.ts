import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { nodeWebFiles } from '../src/web-files.js';
import { at, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});

function client(now: () => Date) {
  const app = createApp(env.ctx, now);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
  return { call, app };
}

describe('seller app API', () => {
  it('lists chats with unread counts and waitlist tags, and marks them read when opened', async () => {
    env = await setup();
    let now = at(0);
    const { call } = client(() => now);
    await call('POST', '/dev/inbound', { sellerId: env.sellerId, from: wa(1), name: 'Amaka Obi', text: 'Do you have the brown claw clip ponytail?' });
    now = at(1);
    await call('POST', '/dev/inbound', { sellerId: env.sellerId, from: wa(1), text: 'yes' });
    now = at(2);
    await call('POST', '/dev/inbound', { sellerId: env.sellerId, from: wa(2), name: 'Tunde', text: 'How much is delivery to Ikeja?' });

    const chats = (await call('GET', `/api/chats?sellerId=${env.sellerId}`)).body;
    expect(chats.map((c: { name: string }) => c.name)).toEqual(['Tunde', 'Amaka Obi']);
    expect(chats[1]).toMatchObject({ unread: 2, waiting_for: ['12" Claw Clip Ponytail Brown'], window_open: true, channel: 'whatsapp', last_direction: 'out' });

    const detail = (await call('GET', `/api/chats/${chats[1].id}`)).body;
    expect(detail.messages).toHaveLength(4);
    expect(detail.waitingFor[0]).toMatchObject({ variant: 'Brown', position: 1 });
    expect(detail.consents[0].quote).toBe('yes');
    expect((await call('GET', `/api/chats?sellerId=${env.sellerId}`)).body[1].unread).toBe(0);
  });

  it('sends a reply inside the window and refuses one after it', async () => {
    env = await setup();
    let now = at(0);
    const { call } = client(() => now);
    await call('POST', '/dev/inbound', { sellerId: env.sellerId, from: wa(1), name: 'Tunde', text: 'How much is delivery to Ikeja?' });
    const [chat] = (await call('GET', `/api/chats?sellerId=${env.sellerId}`)).body;
    expect((await call('POST', `/api/chats/${chat.id}/reply`, { body: 'FCFA 1,500 to Bonamoussadi.' })).status).toBe(201);
    expect(env.channel.sent.at(-1)).toMatchObject({ kind: 'text', body: 'FCFA 1,500 to Bonamoussadi.' });
    expect((await call('POST', `/api/chats/${chat.id}/reply`, { body: '  ' })).status).toBe(400);
    now = at(60 * 25);
    const late = await call('POST', `/api/chats/${chat.id}/reply`, { body: 'Still there?' });
    expect(late.status).toBe(409);
    expect(late.body.error).toContain('24 hours');
  });

  it('previews a restock without changing anything, then blocks a second one while the first runs', async () => {
    env = await setup();
    const now = at(0);
    const { call } = client(() => now);
    for (let i = 1; i <= 4; i++) {
      await call('POST', '/dev/inbound', { sellerId: env.sellerId, from: wa(i), name: `Buyer${i} X`, text: 'una get the brown claw clip?' });
      await call('POST', '/dev/inbound', { sellerId: env.sellerId, from: wa(i), text: 'yes' });
    }
    env.channel.sent.length = 0;
    const pv = (await call('POST', `/api/products/${env.brown}/restocks/preview`, { units: 2, mode: 'race', perUnit: 3 })).body;
    expect(pv).toMatchObject({ waiting: 4, toMessage: 4, soldOutNotes: 2, running: false, costUsdMicros: { alerts: 4 * 22500, soldOutNotes: 2 * 4000, total: 4 * 22500 + 2 * 4000 } });
    expect(pv.preview).toContain('Hi Buyer1, good news: the brown 12" Claw Clip Ponytail is back! Units in: 2.');
    expect(env.channel.sent).toHaveLength(0);
    expect((await call('GET', `/api/products/${env.brown}`)).body.product.stock).toBe(0);

    expect((await call('POST', `/api/products/${env.brown}/restocks`, { units: 2, mode: 'hold' })).status).toBe(201);
    const again = await call('POST', `/api/products/${env.brown}/restocks`, { units: 1, mode: 'hold' });
    expect(again.status).toBe(400);
    expect(again.body.error).toContain('still running');
    expect((await call('POST', `/api/products/${env.brown}/restocks/preview`, { units: 1, mode: 'hold' })).body.running).toBe(true);
    const detail = (await call('GET', `/api/products/${env.brown}`)).body;
    expect(detail.restocks[0]).toMatchObject({ units: 2, messaged: 2, sold: 0 });
  });

  it('edits a product and validates the stock count', async () => {
    env = await setup();
    const { call } = client(() => at(0));
    const ok = await call('PATCH', `/api/products/${env.black}`, { stock: 2, price: 16500, aliases: ['claw ponytail'] });
    expect(ok.body).toMatchObject({ stock: 2, price_minor: 16500, aliases: ['claw ponytail'] });
    expect((await call('PATCH', `/api/products/${env.black}`, { stock: -1 })).status).toBe(400);
  });

  it('reports sales, spend, demand and refunds for the month', async () => {
    env = await setup();
    const now = at(0);
    const { call } = client(() => now);
    for (let i = 1; i <= 3; i++) {
      await call('POST', '/dev/inbound', { sellerId: env.sellerId, from: wa(i), name: `B${i}`, text: 'una get the brown claw clip?' });
      await call('POST', '/dev/inbound', { sellerId: env.sellerId, from: wa(i), text: 'yes' });
    }
    const { restockId } = (await call('POST', `/api/products/${env.brown}/restocks`, { units: 1, mode: 'race', perUnit: 3 })).body;
    const offers = (await call('GET', `/api/restocks/${restockId}`)).body.offers;
    const ref = (o: { payment_ref: string }) => o.payment_ref;
    await call('POST', `/dev/pay/${ref(offers[0])}`);
    await call('POST', `/dev/pay/${ref(offers[1])}`); // too late: refund

    const ins = (await call('GET', `/api/insights?sellerId=${env.sellerId}`)).body;
    expect(ins.sales).toEqual({ orders: 1, revenue_minor: 15000 });
    expect(ins.refunds).toHaveLength(1);
    const brown = ins.demand.find((d: { variant: string }) => d.variant === 'Brown');
    expect(brown).toMatchObject({ waiting: 2, bought_pct: 33 });
    expect(ins.spend.cost_usd_micros).toBe(3 * 22500 + 2 * 4000);
  });

  it('serves the web app', async () => {
    env = await setup();
    const app = createApp(env.ctx, () => at(0), { webFiles: nodeWebFiles() });
    const page = await app.request('/app/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>NKAPGUARD Seller App</title>');
    expect((await app.request('/app/app.js')).status).toBe(200);
    expect((await app.request('/')).headers.get('location')).toBe('/app/');
  });
});
