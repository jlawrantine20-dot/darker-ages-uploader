import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { verifyMetaSignature, parseWebhook } from '../src/channels/whatsapp.js';
import { loadConfig } from '../src/config.js';
import { verifyPaystackSignature } from '../src/payments/paystack.js';
import { PHONE_ID, T0, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});

const waPayload = (from: string, text: string, name = 'Amaka Obi') => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: PHONE_ID },
    contacts: [{ wa_id: from, profile: { name } }],
    messages: [{ from, id: 'wamid.x' + Math.random(), timestamp: String(Math.floor(T0.getTime() / 1000)), type: 'text', text: { body: text } }],
  } }] }],
});

describe('webhook plumbing', () => {
  it('parses text and button replies, and skips status updates', () => {
    const p = waPayload(wa(1), 'hello');
    (p.entry[0].changes[0].value.messages as unknown[]).push(
      { from: wa(1), id: 'b', timestamp: '1', type: 'button', button: { text: 'YES' } },
      { from: wa(1), id: 'i', timestamp: '1', type: 'image', image: {} },
    );
    const msgs = parseWebhook(p);
    expect(msgs.map((m) => m.text)).toEqual(['hello', 'YES']);
    expect(msgs[0]).toMatchObject({ phoneNumberId: PHONE_ID, name: 'Amaka Obi', at: T0 });
    expect(parseWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'x' }, statuses: [{}] } }] }] })).toEqual([]);
  });

  it('checks Meta and Paystack signatures', () => {
    const body = '{"a":1}';
    const meta = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
    expect(verifyMetaSignature(body, meta, 'app-secret')).toBe(true);
    expect(verifyMetaSignature(body + ' ', meta, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, undefined, 'app-secret')).toBe(false);
    const ps = createHmac('sha512', 'sk_test').update(body).digest('hex');
    expect(verifyPaystackSignature(body, ps, 'sk_test')).toBe(true);
    expect(verifyPaystackSignature(body, ps, 'sk_other')).toBe(false);
  });
});

describe('HTTP API', () => {
  it('runs chat → restock → payment over HTTP in dry-run mode', async () => {
    env = await setup();
    const app = createApp(env.ctx, () => T0);
    const post = (path: string, body: unknown) =>
      app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    let r = await post('/webhooks/whatsapp', waPayload(wa(1), 'Do you have the brown claw clip ponytail?'));
    expect(await r.json()).toEqual({ handled: [{ from: wa(1), action: 'offered', replies: ['sent'] }] });
    await post('/webhooks/whatsapp', waPayload(wa(1), 'YES'));

    const wl = await (await app.request(`/api/products/${env.brown}/waitlist`)).json();
    expect(wl).toMatchObject([{ position: 1, name: 'Amaka Obi', consent_quote: 'YES' }]);

    r = await post(`/api/products/${env.brown}/restocks`, { units: 1, mode: 'hold', holdMinutes: 60 });
    expect(r.status).toBe(201);
    const { restockId } = await r.json();
    const detail = await (await app.request(`/api/restocks/${restockId}`)).json();
    const ref = detail.offers[0].payment_url.split('/').pop();

    expect(await (await post(`/dev/pay/${ref}`, {})).json()).toEqual({ outcome: 'paid' });
    expect(await (await post(`/api/products/${env.brown}/restocks`, { units: 0, mode: 'hold' })).json()).toEqual({ error: 'units must be between 1 and 10000' });
  });

  it('answers the Meta verification handshake only with the right token', async () => {
    env = await setup();
    env.ctx.config.whatsapp.verifyToken = 'tok';
    const app = createApp(env.ctx);
    expect(await (await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=42')).text()).toBe('42');
    expect((await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=42')).status).toBe(403);
  });

  it('requires signatures and the admin token when live', async () => {
    env = await setup();
    env.ctx.config = loadConfig({
      DRY_RUN: 'false', WA_TOKEN: 't', WA_APP_SECRET: 'app-secret', WA_VERIFY_TOKEN: 'v', PAYSTACK_SECRET_KEY: 'sk', ADMIN_TOKEN: 'admin',
    });
    const app = createApp(env.ctx);
    const body = JSON.stringify(waPayload(wa(1), 'hi'));
    expect((await app.request('/webhooks/whatsapp', { method: 'POST', body })).status).toBe(401);
    const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
    expect((await app.request('/webhooks/whatsapp', { method: 'POST', body, headers: { 'x-hub-signature-256': sig } })).status).toBe(200);
    expect((await app.request('/api/consents')).status).toBe(401);
    expect((await app.request('/api/consents', { headers: { authorization: 'Bearer admin' } })).status).toBe(200);
    expect((await app.request('/dev/pay/x', { method: 'POST' })).status).toBe(404);
  });

  it('refuses to start live without credentials', () => {
    expect(() => loadConfig({ DRY_RUN: 'false' })).toThrow('WA_TOKEN');
  });
});
