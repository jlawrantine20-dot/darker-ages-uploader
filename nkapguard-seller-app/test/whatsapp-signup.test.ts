import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { whatsappCloud } from '../src/channels/whatsapp.js';
import { tokenLookup } from '../src/services/whatsappSignup.js';
import { setup } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});

const WABA = '5550001112223';
const NUMBER = '7770001112223';

/** Meta's Graph API, as far as signup needs it. Records every call. */
function fakeMeta(opts: { refuseCode?: boolean; numbers?: string[] } = {}) {
  const calls: { method: string; url: string; auth: string | null; body?: string }[] = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null, body: init?.body as string | undefined });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/oauth/access_token')) return opts.refuseCode ? json(400, { error: { message: 'Invalid verification code' } }) : json(200, { access_token: 'seller-token' });
    if (url.includes(`/${WABA}/phone_numbers`)) return json(200, { data: (opts.numbers ?? [NUMBER]).map((id) => ({ id, display_phone_number: '+237 6 77 00 11 22', verified_name: 'Gold Cosmetics' })) });
    if (url.includes('/subscribed_apps') || url.includes('/register')) return json(200, { success: true });
    if (url.includes('/message_templates')) return method === 'POST' ? json(200, { id: 't', status: 'PENDING' }) : json(200, { data: [] });
    if (url.includes('/messages')) return json(200, { messages: [{ id: 'wamid.sent' }] });
    return json(404, { error: { message: 'not faked: ' + url } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

async function withSignup(opts?: Parameters<typeof fakeMeta>[0]) {
  env = await setup();
  const meta = fakeMeta(opts);
  const c = env.ctx.config;
  env.ctx.config = { ...c, meta: { ...c.meta, appId: '123', appSecret: 'app-secret' }, whatsapp: { ...c.whatsapp, signupConfigId: 'cfg-1' } };
  env.ctx.fetch = meta.fetchFn;
  const app = createApp(env.ctx);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { meta, call };
}
const shop = { name: 'Gold Cosmetics', country: 'CM', whatsapp: { code: 'one-time-code', phoneNumberId: NUMBER, wabaId: WABA } };

describe('Connecting a WhatsApp number with Embedded Signup', () => {
  it('tells the app when signup is available', async () => {
    const { call } = await withSignup();
    expect((await call('GET', '/health')).body.whatsappSignup).toEqual({ appId: '123', configId: 'cfg-1', graphVersion: env.ctx.config.meta.graphVersion });
  });

  it('creates a shop on the seller\'s own number, with its own key, and submits its templates', async () => {
    const { meta, call } = await withSignup();
    const r = await call('POST', '/api/sellers', shop);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ wa_phone_number_id: NUMBER, waba_id: WABA, wa_verified_name: 'Gold Cosmetics', wa_display_phone: '237677001122', wa_own_account: true });
    // The key itself never leaves the server.
    expect(JSON.stringify(r.body)).not.toContain('seller-token');
    expect(r.body.wa_token_enc).toBeUndefined();
    // The code exchange uses the app secret, and every later call the seller's key.
    expect(meta.calls[0].url).toContain('client_secret=app-secret');
    const after = meta.calls.slice(1);
    expect(after.every((c) => c.auth === 'Bearer seller-token')).toBe(true);
    expect(after.some((c) => c.method === 'POST' && c.url.endsWith(`/${WABA}/subscribed_apps`))).toBe(true);
    const reg = after.find((c) => c.url.endsWith(`/${NUMBER}/register`))!;
    expect(JSON.parse(reg.body!).pin).toMatch(/^\d{6}$/);
    // Shop templates only: sign-in codes come from NKAPGUARD's own number.
    const submitted = after.filter((c) => c.method === 'POST' && c.url.includes('/message_templates')).map((c) => JSON.parse(c.body!));
    expect(submitted).toHaveLength(18);
    expect(submitted.some((t) => t.category === 'AUTHENTICATION')).toBe(false);
  });

  it('sends from that number with its own key, and from other numbers with NKAPGUARD\'s', async () => {
    const { meta, call } = await withSignup();
    await call('POST', '/api/sellers', shop);
    const channel = whatsappCloud({ token: 'platform-token', apiVersion: 'v21.0', fetchFn: meta.fetchFn, tokenFor: tokenLookup(env.db, env.ctx.config.appSecret) });
    await channel.sendText(NUMBER, '237677000001', 'Bonjour');
    await channel.sendText('1098765432', '237677000001', 'Bonjour');
    const sends = meta.calls.filter((c) => c.url.endsWith('/messages'));
    expect(sends.map((c) => c.auth)).toEqual(['Bearer seller-token', 'Bearer platform-token']);
  });

  it("refuses a number that isn't in the connected account", async () => {
    const { call } = await withSignup({ numbers: ['999'] });
    const r = await call('POST', '/api/sellers', shop);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('is not in the WhatsApp account');
  });

  it('says why when Meta refuses the code', async () => {
    const { call } = await withSignup({ refuseCode: true });
    const r = await call('POST', '/api/sellers', shop);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('Invalid verification code');
  });

  it("won't put one number on two shops, and changes an existing shop's number", async () => {
    const { call } = await withSignup();
    await call('POST', '/api/sellers', shop);
    expect((await call('POST', '/api/sellers', { ...shop, name: 'Copycat' })).status).toBe(400);
    const r = await call('PUT', `/api/sellers/${env.sellerId}/whatsapp`, shop.whatsapp);
    expect(r.status).toBe(400);
  });

  it('is off until the server has the signup configuration', async () => {
    env = await setup();
    const app = createApp(env.ctx);
    const res = await app.request('/api/sellers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(shop) });
    expect(res.status).toBe(400);
    expect((await (await app.request('/health')).json()).whatsappSignup).toBeNull();
  });
});
