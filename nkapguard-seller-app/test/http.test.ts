import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseWebhook, verifyMetaSignature } from '../src/channels/whatsapp.js';
import { loadConfig } from '../src/config.js';
import { decryptSecret, encryptSecret } from '../src/crypto.js';
import { flutterwave, notchpay, paystack, stripe } from '../src/payments/providers.js';
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

const liveConfig = () => loadConfig({
  DRY_RUN: 'false', WA_TOKEN: 't', WA_APP_SECRET: 'app-secret', WA_VERIFY_TOKEN: 'v', ADMIN_TOKEN: 'admin', APP_SECRET: 'k', PLATFORM_WA_PHONE_ID: 'platform', PUBLIC_URL: 'https://nkapguard.test',
});

describe('WhatsApp webhook plumbing', () => {
  it('parses text and button replies, and skips status updates', () => {
    const p = waPayload(wa(1), 'hello');
    (p.entry[0].changes[0].value.messages as unknown[]).push(
      { from: wa(1), id: 'b', timestamp: '1', type: 'button', button: { text: 'OUI' } },
      { from: wa(1), id: 'i', timestamp: '1', type: 'image', image: {} },
    );
    const msgs = parseWebhook(p);
    expect(msgs.map((m) => m.text)).toEqual(['hello', 'OUI']);
    expect(msgs[0]).toMatchObject({ phoneNumberId: PHONE_ID, name: 'Amaka Obi', at: T0 });
    expect(parseWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'x' }, statuses: [{}] } }] }] })).toEqual([]);
  });

  it('checks the Meta signature', () => {
    const body = '{"a":1}';
    const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
    expect(verifyMetaSignature(body, sig, 'app-secret')).toBe(true);
    expect(verifyMetaSignature(body + ' ', sig, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, undefined, 'app-secret')).toBe(false);
  });
});

describe('payment providers', () => {
  const opts = { publicUrl: 'https://nkapguard.test', emailDomain: 'b.test' };
  const hdr = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()];

  it('Paystack: HMAC-SHA512 of the body with the secret key', () => {
    const p = paystack({ ...opts, secretKey: 'sk_test' });
    const body = JSON.stringify({ event: 'charge.success', data: { status: 'success', reference: 'nkg_1', amount: 1850000, currency: 'NGN' } });
    const sig = createHmac('sha512', 'sk_test').update(body).digest('hex');
    expect(p.parseWebhook(body, hdr({ 'x-paystack-signature': sig }))).toEqual({ ok: true, event: { reference: 'nkg_1', amountMinor: 1850000, currency: 'NGN' } });
    expect(p.parseWebhook(body, hdr({ 'x-paystack-signature': '00' }))).toEqual({ ok: false });
  });

  it('Flutterwave: verif-hash header, amounts in major units converted to minor', () => {
    const p = flutterwave({ ...opts, secretKey: 'FLWSECK', webhookSecret: 'my-hash' });
    const body = JSON.stringify({ event: 'charge.completed', data: { status: 'successful', tx_ref: 'nkg_2', amount: 15000, currency: 'XAF' } });
    expect(p.parseWebhook(body, hdr({ 'verif-hash': 'my-hash' }))).toEqual({ ok: true, event: { reference: 'nkg_2', amountMinor: 15000, currency: 'XAF' } });
    expect(p.parseWebhook(body, hdr({ 'verif-hash': 'wrong' }))).toEqual({ ok: false });
    const failed = JSON.stringify({ event: 'charge.completed', data: { status: 'failed', tx_ref: 'nkg_2' } });
    expect(p.parseWebhook(failed, hdr({ 'verif-hash': 'my-hash' }))).toEqual({ ok: true, event: null });
  });

  it('Stripe: timestamped HMAC-SHA256 signature, stale ones refused', () => {
    const p = stripe({ ...opts, secretKey: 'sk', webhookSecret: 'whsec_x' });
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', client_reference_id: 'nkg_3', amount_total: 1999, currency: 'usd' } } });
    const sign = (t: number) => `t=${t},v1=${createHmac('sha256', 'whsec_x').update(`${t}.${body}`).digest('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    expect(p.parseWebhook(body, hdr({ 'stripe-signature': sign(now) }))).toEqual({ ok: true, event: { reference: 'nkg_3', amountMinor: 1999, currency: 'USD' } });
    expect(p.parseWebhook(body, hdr({ 'stripe-signature': sign(now - 3600) }))).toEqual({ ok: false });
  });

  it('Notch Pay: HMAC-SHA256 with the webhook hash, whole-franc amounts', () => {
    const p = notchpay({ ...opts, secretKey: 'pk.test', webhookSecret: 'hash' });
    const body = JSON.stringify({ event: 'payment.complete', data: { status: 'complete', reference: 'nkg_5.abc', amount: 15000, currency: 'XAF' } });
    const sig = createHmac('sha256', 'hash').update(body).digest('hex');
    expect(p.parseWebhook(body, hdr({ 'x-notch-signature': sig }))).toEqual({ ok: true, event: { reference: 'nkg_5.abc', amountMinor: 15000, currency: 'XAF' } });
    expect(p.parseWebhook(body, hdr({ 'x-notch-signature': 'ab' }))).toEqual({ ok: false });
  });

  it('creates Flutterwave links with major-unit amounts and the shop currency', async () => {
    let sent: any;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ status: 'success', message: 'ok', data: { link: 'https://checkout.flutterwave.com/x' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = flutterwave({ ...opts, secretKey: 'FLWSECK', webhookSecret: 'h', fetchFn });
    const r = await p.createLink({ reference: 'nkg_4', amountMinor: 15000, currency: 'XAF', description: 'Shop: clip', waId: '237677123456', metadata: {} });
    expect(r.url).toBe('https://checkout.flutterwave.com/x');
    expect(sent).toMatchObject({ tx_ref: 'nkg_4', amount: 15000, currency: 'XAF', customer: { phonenumber: '237677123456' } });
  });

  it('encrypts stored keys', () => {
    const enc = encryptSecret('sk_live_123', 'app');
    expect(enc).not.toContain('sk_live');
    expect(decryptSecret(enc, 'app')).toBe('sk_live_123');
    expect(() => decryptSecret(enc, 'other')).toThrow();
  });
});

describe('HTTP API', () => {
  it('runs chat → restock → payment over HTTP in test mode', async () => {
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
    expect(await (await post(`/dev/pay/${detail.offers[0].payment_ref}`, {})).json()).toEqual({ outcome: 'paid' });
    expect(await (await post(`/api/products/${env.brown}/restocks`, { units: 0, mode: 'hold' })).json()).toEqual({ error: 'Enter between 1 and 10,000 units.' });
  });

  it('turns a tapped link into a checkout only while the hold stands', async () => {
    env = await setup();
    let now = T0;
    const app = createApp(env.ctx, () => now);
    const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (const i of [1, 2]) {
      await post('/dev/inbound', { sellerId: env.sellerId, from: wa(i), name: `B${i}`, text: 'una get the brown claw clip ponytail?' });
      await post('/dev/inbound', { sellerId: env.sellerId, from: wa(i), text: 'yes' });
    }
    const { restockId } = await (await post(`/api/products/${env.brown}/restocks`, { units: 1, mode: 'hold', holdMinutes: 60 })).json();
    const [first] = (await (await app.request(`/api/restocks/${restockId}`)).json()).offers;
    expect(first.payment_url).toBe(`https://nkapguard.test/pay/${first.payment_ref}`);

    const tap = await app.request(`/pay/${first.payment_ref}`);
    expect(tap.status).toBe(302);
    expect(tap.headers.get('location')).toMatch(new RegExp(`^https://nkapguard\\.test/pay/${first.payment_ref}\\.[a-z0-9]+/test$`));
    expect(await (await app.request(tap.headers.get('location')!.replace('https://nkapguard.test', ''))).text()).toContain('FCFA\u00a015,000');

    now = new Date(T0.getTime() + 61 * 60_000);
    const late = await app.request(`/pay/${first.payment_ref}`);
    expect(late.status).toBe(410);
    expect(await late.text()).toContain('The hold on this item ran out');

    await post('/api/tick', {});
    const second = (await (await app.request(`/api/restocks/${restockId}`)).json()).offers.find((o: { status: string }) => o.status === 'held');
    const paid = await app.request(`/pay/${second.payment_ref}.x1/test`, { method: 'POST' });
    expect(await paid.text()).toContain('Test payment received');
    expect((await app.request(`/pay/${second.payment_ref}`)).status).toBe(410);
    expect((await app.request('/pay/nkg_nothing')).status).toBe(404);

    // A customer who wrote in English sees the page in English only, even in a bilingual shop.
    await env.db.query(`update sellers set language = 'fr+en'`);
    const english = await (await app.request(`/pay/${first.payment_ref}`)).text();
    expect(english).toContain('This offer has ended');
    expect(english).not.toContain('Cette offre');

    // With no known language, a bilingual shop explains it in both.
    await env.db.query(`update contacts set language = null`);
    const both = await (await app.request(`/pay/${first.payment_ref}`)).text();
    expect(both).toContain('Cette offre est terminée<br>This offer has ended');
    expect(both).toContain("<p>La réservation a expiré et l&#39;article est passé à la personne suivante. Vous gardez votre place sur la liste pour le prochain arrivage.</p><p>The hold on this item ran out");
  });

  it('creates shops with defaults from the country, for any country', async () => {
    env = await setup();
    const app = createApp(env.ctx);
    const post = (body: unknown) => app.request('/api/sellers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(await (await post({ name: 'Yaoundé Wigs', waPhoneNumberId: 'a', country: 'CM' })).json()).toMatchObject({ currency: 'XAF', language: 'fr+en', timezone: 'Africa/Douala' });
    expect(await (await post({ name: 'Brooklyn Braids', waPhoneNumberId: 'b', country: 'us', timezone: 'America/Chicago' })).json()).toMatchObject({ country: 'US', currency: 'USD', timezone: 'America/Chicago' });
    // A country without defaults works once currency and time zone are given.
    expect((await post({ name: 'Manila Shop', waPhoneNumberId: 'c', country: 'PH' })).status).toBe(400);
    expect(await (await post({ name: 'Manila Shop', waPhoneNumberId: 'c', country: 'PH', currency: 'PHP', timezone: 'Asia/Manila' })).json()).toMatchObject({ currency: 'PHP', language: 'en' });
    expect((await post({ name: 'X', waPhoneNumberId: 'd', country: 'CM', language: 'de' })).status).toBe(400);
    const markets = await (await app.request('/api/markets')).json();
    expect(markets.countries.find((c: { code: string }) => c.code === 'CM')).toMatchObject({ currency: 'XAF', providers: ['notchpay', 'flutterwave'] });
  });

  it('stores payment keys encrypted and never returns them', async () => {
    env = await setup();
    const app = createApp(env.ctx);
    const put = (body: unknown) => app.request(`/api/sellers/${env.sellerId}/payments`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await put({ provider: 'flutterwave', secretKey: 'FLWSECK-live' })).status).toBe(400); // missing webhook hash
    const ok = await (await put({ provider: 'flutterwave', secretKey: 'FLWSECK-live', webhookSecret: 'hash' })).json();
    expect(ok).toMatchObject({ payment_provider: 'flutterwave', payments_connected: true, webhookUrl: `https://nkapguard.test/webhooks/payments/${env.sellerId}` });
    expect(JSON.stringify(ok)).not.toContain('FLWSECK');
    const [row] = await env.db.query<{ payment_secret_enc: string }>('select payment_secret_enc from sellers');
    expect(row.payment_secret_enc).not.toContain('FLWSECK');
    expect(JSON.stringify(await (await app.request('/api/sellers')).json())).not.toContain('_enc');
  });

  it('matches live payments through the seller’s own webhook URL', async () => {
    env = await setup();
    env.ctx.config = liveConfig();
    await env.db.query(`update sellers set payment_provider = 'flutterwave', payment_secret_enc = $1, payment_webhook_secret_enc = $2`, [
      encryptSecret('FLWSECK', 'k'), encryptSecret('my-hash', 'k'),
    ]);
    const app = createApp(env.ctx);
    const body = JSON.stringify({ event: 'charge.completed', data: { status: 'successful', tx_ref: 'nkg_unknown', amount: 15000, currency: 'XAF' } });
    const hook = (h: Record<string, string>) => app.request(`/webhooks/payments/${env.sellerId}`, { method: 'POST', body, headers: h });
    expect((await hook({ 'verif-hash': 'nope' })).status).toBe(401);
    // Correct hash but no transaction Flutterwave can confirm: ignored, nothing marked paid.
    expect(await (await hook({ 'verif-hash': 'my-hash' })).json()).toMatchObject({ ignored: true });
  });

  it('answers the Meta verification handshake only with the right token', async () => {
    env = await setup();
    env.ctx.config.whatsapp.verifyToken = 'tok';
    const app = createApp(env.ctx);
    expect(await (await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=42')).text()).toBe('42');
    expect((await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=42')).status).toBe(403);
  });

  it('checks WhatsApp signatures in test mode too once the app secret is set', async () => {
    env = await setup();
    env.ctx.config.whatsapp.appSecret = 'app-secret';
    const app = createApp(env.ctx);
    const body = JSON.stringify(waPayload(wa(1), 'hi'));
    expect((await app.request('/webhooks/whatsapp', { method: 'POST', body })).status).toBe(401);
    const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
    expect((await app.request('/webhooks/whatsapp', { method: 'POST', body, headers: { 'x-hub-signature-256': sig } })).status).toBe(200);
  });

  it('requires signatures and the admin token when live', async () => {
    env = await setup();
    env.ctx.config = liveConfig();
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
