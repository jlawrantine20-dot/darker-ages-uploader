import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { embeddedDb, migrate } from '../src/db.js';
import { DryRunChannel } from '../src/channels/whatsapp.js';
import type { Ctx } from '../src/services/context.js';

let ctx: Ctx;
let now = new Date('2026-10-05T09:00:00Z');
afterEach(async () => {
  await ctx?.db.close();
  now = new Date('2026-10-05T09:00:00Z');
});

async function boot(env: Record<string, string> = {}) {
  const db = await embeddedDb();
  await migrate(db);
  const channel = new DryRunChannel();
  ctx = { db, channel, config: loadConfig({ DRY_RUN: 'true', PUBLIC_URL: 'https://oja.test', ...env }) };
  const app = createApp(ctx, () => now);
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
  /** Sign in with a phone number through the real code flow; returns a session token. */
  const signIn = async (phone: string, country = 'CM') => {
    const start = await call('POST', '/auth/start', { phone, country });
    expect(start.status).toBe(200);
    const v = await call('POST', '/auth/verify', { phone, country, code: start.body.devCode });
    expect(v.status).toBe(200);
    return v.body.token as string;
  };
  return { app, call, signIn, channel };
}

describe('signing in with WhatsApp', () => {
  it('sends a code, accepts it once, and opens a session', async () => {
    const { call } = await boot();
    const start = await call('POST', '/auth/start', { phone: '6 77 12 34 56', country: 'CM' });
    expect(start.body).toMatchObject({ sent: true, devCode: expect.stringMatching(/^\d{6}$/) });
    expect((await call('POST', '/auth/verify', { phone: '+237677123456', country: 'NG', code: '000000' === start.body.devCode ? '111111' : '000000' })).status).toBe(400);
    const ok = await call('POST', '/auth/verify', { phone: '+237 677 12 34 56', country: 'CM', code: start.body.devCode });
    expect(ok.body).toMatchObject({ token: expect.any(String), user: { wa_id: '237677123456' } });
    expect((await call('GET', '/api/me', undefined, ok.body.token)).body).toMatchObject({ admin: false, user: { wa_id: '237677123456' } });
    // A code works once.
    expect((await call('POST', '/auth/verify', { phone: '677123456', country: 'CM', code: start.body.devCode })).status).toBe(400);
  });

  it('expires codes, limits guesses and limits how often codes are sent', async () => {
    const { call } = await boot();
    const start = await call('POST', '/auth/start', { phone: '677123456', country: 'CM' });
    now = new Date(now.getTime() + 11 * 60_000);
    expect((await call('POST', '/auth/verify', { phone: '677123456', country: 'CM', code: start.body.devCode })).status).toBe(400);

    const again = await call('POST', '/auth/start', { phone: '677123456', country: 'CM' });
    const wrong = again.body.devCode === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await call('POST', '/auth/verify', { phone: '677123456', country: 'CM', code: wrong });
    // Locked after 5 wrong guesses, even with the right code.
    expect((await call('POST', '/auth/verify', { phone: '677123456', country: 'CM', code: again.body.devCode })).status).toBe(400);

    for (let i = 0; i < 3; i++) expect((await call('POST', '/auth/start', { phone: '677123456', country: 'CM' })).status).toBe(200);
    const limited = await call('POST', '/auth/start', { phone: '677123456', country: 'CM' });
    expect(limited.status).toBe(429);
    expect((await call('POST', '/auth/start', { phone: 'not a number', country: 'CM' })).status).toBe(400);
  });

  it('sends the code as a WhatsApp authentication template when live, and never returns it', async () => {
    const { call, channel } = await boot({
      DRY_RUN: 'false', WA_TOKEN: 't', WA_APP_SECRET: 'a', WA_VERIFY_TOKEN: 'v', ADMIN_TOKEN: 'admin', APP_SECRET: 'k', PLATFORM_WA_PHONE_ID: 'oja-number',
    });
    const r = await call('POST', '/auth/start', { phone: '0803 555 2190', country: 'NG' });
    expect(r.body).toEqual({ sent: true });
    const [sent] = channel.sent;
    expect(sent).toMatchObject({ from: 'oja-number', to: '2348035552190', kind: 'template', template: { name: 'login_code_v1', language: 'en' } });
    expect(sent.template!.params[0]).toMatch(/^\d{6}$/);
    expect(sent.template!.buttonParams).toEqual(sent.template!.params);
  });

  it('signs out by revoking the session', async () => {
    const { call, signIn } = await boot();
    const token = await signIn('677123456');
    expect((await call('GET', '/api/sellers', undefined, token)).status).toBe(200);
    await call('POST', '/auth/logout', undefined, token);
    expect((await call('GET', '/api/sellers', undefined, token)).status).toBe(401);
    expect((await call('GET', '/api/sellers', undefined, 'made-up-token')).status).toBe(401);
  });
});

describe('each seller sees only their own shop', () => {
  async function twoShops() {
    const t = await boot();
    const alice = await t.signIn('677000001');
    const bob = await t.signIn('677000002');
    const shopA = (await t.call('POST', '/api/sellers', { name: 'Alice Wigs', waPhoneNumberId: 'pa', country: 'CM' }, alice)).body;
    const shopB = (await t.call('POST', '/api/sellers', { name: 'Bob Braids', waPhoneNumberId: 'pb', country: 'NG' }, bob)).body;
    const prodB = (await t.call('POST', '/api/products', { sellerId: shopB.id, name: 'Claw Clip', variant: 'Brown', price: 18500 }, bob)).body;
    await t.call('POST', '/dev/inbound', { sellerId: shopB.id, from: '0803 555 2190', name: 'Tunde', text: 'una get the brown claw clip?' }, bob);
    await t.call('POST', '/dev/inbound', { sellerId: shopB.id, from: '0803 555 2190', text: 'yes' }, bob);
    const chatB = (await t.call('GET', `/api/chats?sellerId=${shopB.id}`, undefined, bob)).body[0];
    const restockB = (await t.call('POST', `/api/products/${prodB.id}/restocks`, { units: 1, mode: 'hold' }, bob)).body;
    return { ...t, alice, bob, shopA, shopB, prodB, chatB, restockB };
  }

  it('makes the creator the owner and lists only their shops', async () => {
    const t = await twoShops();
    expect(t.shopA.role).toBe('owner');
    expect((await t.call('GET', '/api/sellers', undefined, t.alice)).body.map((s: { name: string }) => s.name)).toEqual(['Alice Wigs']);
    expect((await t.call('GET', '/api/sellers', undefined, t.bob)).body.map((s: { name: string }) => s.name)).toEqual(['Bob Braids']);
  });

  it("refuses every route into another seller's data, without revealing it exists", async () => {
    const t = await twoShops();
    const a = t.alice;
    const denied = [
      await t.call('GET', `/api/chats?sellerId=${t.shopB.id}`, undefined, a),
      await t.call('GET', `/api/chats/${t.chatB.id}`, undefined, a),
      await t.call('POST', `/api/chats/${t.chatB.id}/reply`, { body: 'hi' }, a),
      await t.call('GET', `/api/products?sellerId=${t.shopB.id}`, undefined, a),
      await t.call('GET', `/api/products/${t.prodB.id}`, undefined, a),
      await t.call('PATCH', `/api/products/${t.prodB.id}`, { stock: 99 }, a),
      await t.call('GET', `/api/products/${t.prodB.id}/waitlist`, undefined, a),
      await t.call('POST', `/api/products/${t.prodB.id}/restocks/preview`, { units: 1, mode: 'hold' }, a),
      await t.call('POST', `/api/products/${t.prodB.id}/restocks`, { units: 1, mode: 'hold' }, a),
      await t.call('GET', `/api/restocks/${t.restockB.restockId}`, undefined, a),
      await t.call('GET', `/api/consents?sellerId=${t.shopB.id}`, undefined, a),
      await t.call('GET', `/api/insights?sellerId=${t.shopB.id}`, undefined, a),
      await t.call('PATCH', `/api/sellers/${t.shopB.id}`, { name: 'Mine now' }, a),
      await t.call('PUT', `/api/sellers/${t.shopB.id}/payments`, { provider: 'test' }, a),
      await t.call('GET', `/api/sellers/${t.shopB.id}/members`, undefined, a),
      await t.call('POST', '/api/products', { sellerId: t.shopB.id, name: 'Sneaky', price: 1 }, a),
      await t.call('POST', '/dev/inbound', { sellerId: t.shopB.id, from: '0803 555 2191', text: 'hi' }, a),
      await t.call('GET', '/api/products/00000000-0000-0000-0000-000000000000', undefined, a),
    ];
    expect(denied.map((r) => r.status)).toEqual(denied.map(() => 404));
    // Nothing leaked into the responses.
    expect(JSON.stringify(denied)).not.toContain('Tunde');
    // Lists need a shop id, so nothing is returned across shops by default.
    expect((await t.call('GET', '/api/chats', undefined, a)).status).toBe(400);
    // Bob's data is untouched.
    expect((await t.call('GET', `/api/products/${t.prodB.id}`, undefined, t.bob)).body.product.stock).toBe(1);
  });

  it('lets the operator admin token see every shop', async () => {
    const t = await twoShops();
    ctx.config.adminToken = 'ops-token';
    expect((await t.call('GET', '/api/sellers', undefined, 'ops-token')).body).toHaveLength(2);
    expect((await t.call('GET', `/api/chats/${t.chatB.id}`, undefined, 'ops-token')).status).toBe(200);
  });
});

describe('shop teams', () => {
  it('lets an owner add staff, who can sell but not touch payments or the team', async () => {
    const t = await boot();
    const owner = await t.signIn('677000001');
    const shop = (await t.call('POST', '/api/sellers', { name: 'Douala Hair', waPhoneNumberId: 'p1', country: 'CM' }, owner)).body;
    const product = (await t.call('POST', '/api/products', { sellerId: shop.id, name: 'Claw Clip', price: 15000 }, owner)).body;
    // Local Cameroon number, read in the shop's country.
    expect((await t.call('POST', `/api/sellers/${shop.id}/members`, { phone: '6 99 00 00 03', role: 'staff' }, owner)).status).toBe(201);

    const staff = await t.signIn('699000003');
    const mine = (await t.call('GET', '/api/sellers', undefined, staff)).body;
    expect(mine).toMatchObject([{ id: shop.id, role: 'staff' }]);
    expect((await t.call('GET', `/api/chats?sellerId=${shop.id}`, undefined, staff)).status).toBe(200);
    expect((await t.call('POST', `/api/products/${product.id}/restocks`, { units: 2, mode: 'hold' }, staff)).status).toBe(201);

    expect((await t.call('PUT', `/api/sellers/${shop.id}/payments`, { provider: 'test' }, staff)).status).toBe(403);
    expect((await t.call('PATCH', `/api/sellers/${shop.id}`, { name: 'x' }, staff)).status).toBe(403);
    expect((await t.call('POST', `/api/sellers/${shop.id}/members`, { phone: '699000004' }, staff)).status).toBe(403);

    const members = (await t.call('GET', `/api/sellers/${shop.id}/members`, undefined, staff)).body;
    expect(members.map((m: { wa_id: string; role: string }) => [m.wa_id, m.role])).toEqual([['237677000001', 'owner'], ['237699000003', 'staff']]);

    // The last owner can't be removed; staff can.
    const ownerId = members[0].user_id;
    expect((await t.call('DELETE', `/api/sellers/${shop.id}/members/${ownerId}`, undefined, owner)).status).toBe(400);
    expect((await t.call('DELETE', `/api/sellers/${shop.id}/members/${members[1].user_id}`, undefined, owner)).status).toBe(200);
    expect((await t.call('GET', `/api/chats?sellerId=${shop.id}`, undefined, staff)).status).toBe(404);
  });
});
