/**
 * Flutterwave end to end, against a fake of its v3 API: checkout creation, the customer
 * paying, the webhook, and NKAPGUARD confirming the payment with the verify endpoint.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { encryptSecret } from '../src/crypto.js';
import { makeProvider } from '../src/payments/providers.js';
import { T0, setup, wa } from './helpers.js';

const SECRET = 'FLWSECK_TEST-abc';
const HASH = 'my-secret-hash';

/** Just enough of Flutterwave's v3 API to exercise NKAPGUARD, with the same shapes. */
function fakeFlutterwave() {
  const tx = new Map<number, { id: number; tx_ref: string; amount: number; currency: string; status: string }>();
  const created: any[] = [];
  let nextId = 5_000_000;
  let failCreate: string | null = null;
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if ((init?.headers as Record<string, string>)?.Authorization !== `Bearer ${SECRET}`) return reply(401, { status: 'error', message: 'Invalid authorization key' });
    if (url.pathname === '/v3/payments' && init?.method === 'POST') {
      if (failCreate) return reply(400, { status: 'error', message: failCreate });
      const b = JSON.parse(String(init.body));
      created.push(b);
      return reply(200, { status: 'success', message: 'Hosted Link', data: { link: `https://checkout.flutterwave.com/v3/hosted/pay/${b.tx_ref}` } });
    }
    const m = url.pathname.match(/^\/v3\/transactions\/(\d+)\/verify$/);
    if (m) {
      const t = tx.get(Number(m[1]));
      return t ? reply(200, { status: 'success', message: 'Transaction fetched successfully', data: t }) : reply(400, { status: 'error', message: 'No transaction was found for this id' });
    }
    return reply(404, { status: 'error', message: 'Not found' });
  }) as typeof fetch;

  /** The customer completes checkout; returns the webhook Flutterwave would send. */
  const pay = (txRef: string, opts: { status?: string; amount?: number; currency?: string; webhookAmount?: number; fee?: number } = {}) => {
    const req = created.find((c) => c.tx_ref === txRef);
    const t = { id: nextId++, tx_ref: txRef, amount: opts.amount ?? req.amount, currency: opts.currency ?? req.currency, status: opts.status ?? 'successful' };
    tx.set(t.id, t);
    return JSON.stringify({
      event: 'charge.completed',
      data: { ...t, amount: opts.webhookAmount ?? t.amount, charged_amount: t.amount + (opts.fee ?? 0), flw_ref: 'FLW-MOCK-' + t.id, customer: { phone_number: req.customer.phonenumber } },
    });
  };
  return { fetchFn, created, pay, failWith: (m: string | null) => (failCreate = m) };
}

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});

/** A live-mode shop using Flutterwave, with two people waiting for the brown clip and one unit held. */
async function liveShop(opts: { country?: string; clipPrice?: number } = {}) {
  env = await setup(opts);
  const fw = fakeFlutterwave();
  env.ctx.config = loadConfig({
    DRY_RUN: 'false', WA_TOKEN: 't', WA_APP_SECRET: 'a', WA_VERIFY_TOKEN: 'v', ADMIN_TOKEN: 'admin', APP_SECRET: 'k', PLATFORM_WA_PHONE_ID: 'platform', PUBLIC_URL: 'https://nkapguard.test',
  });
  env.ctx.providerFactory = (name, o) => makeProvider(name, { ...o, fetchFn: fw.fetchFn });
  await env.db.query(`update sellers set payment_provider = 'flutterwave', payment_secret_enc = $1, payment_webhook_secret_enc = $2`, [
    encryptSecret(SECRET, 'k'), encryptSecret(HASH, 'k'),
  ]);
  const app = createApp(env.ctx, () => T0);
  const auth = { authorization: 'Bearer admin', 'content-type': 'application/json' };
  const phoneId = (await env.db.query<{ wa_phone_number_id: string }>('select wa_phone_number_id from sellers'))[0].wa_phone_number_id;
  const { handleInbound } = await import('../src/services/inbound.js');
  for (const i of [1, 2]) {
    const m = (text: string) => ({ phoneNumberId: phoneId, from: wa(i), name: `Buyer${i}`, text, providerId: `w${i}${text}`, at: new Date(T0.getTime() - 3_600_000) });
    await handleInbound(env.ctx, m('una get the brown claw clip ponytail?'));
    await handleInbound(env.ctx, m('yes'));
  }
  const { restockId } = await (await app.request(`/api/products/${env.brown}/restocks`, { method: 'POST', headers: auth, body: JSON.stringify({ units: 1, mode: 'hold', holdMinutes: 120 }) })).json();
  const offers = (await (await app.request(`/api/restocks/${restockId}`, { headers: auth })).json()).offers;
  const tap = async (ref: string) => app.request(`/pay/${ref}`);
  const webhook = (body: string, hash = HASH) =>
    app.request(`/webhooks/payments/${env.sellerId}`, { method: 'POST', body, headers: { 'verif-hash': hash, 'content-type': 'application/json' } });
  const status = async () => (await (await app.request(`/api/restocks/${restockId}`, { headers: auth })).json()).offers.map((o: { status: string }) => o.status);
  const stock = async () => (await env.db.query<{ stock: number }>('select stock from products where id = $1', [env.brown]))[0].stock;
  return { fw, app, offers, tap, webhook, status, stock };
}

describe('Flutterwave', () => {
  it('opens a Flutterwave checkout in FCFA with MTN and Orange Money when the customer taps the link', async () => {
    const s = await liveShop();
    const res = await s.tap(s.offers[0].payment_ref);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^https:\/\/checkout\.flutterwave\.com\/v3\/hosted\/pay\/nkg_/);
    expect(s.fw.created[0]).toMatchObject({
      tx_ref: expect.stringMatching(new RegExp(`^${s.offers[0].payment_ref}\\.[a-z0-9]+$`)),
      amount: 15000,
      currency: 'XAF',
      payment_options: 'mobilemoneyfranco,card',
      redirect_url: expect.stringMatching(/^https:\/\/nkapguard\.test\/paid\?lang=/),
      customer: { phonenumber: wa(1), email: `${wa(1)}@buyers.example.com`, name: 'Buyer1' },
    });
  });

  it('sends Naira amounts in naira, not kobo, for a Nigerian shop', async () => {
    const s = await liveShop({ country: 'NG', clipPrice: 18500 });
    await s.tap(s.offers[0].payment_ref);
    expect(s.fw.created[0]).toMatchObject({ amount: 18500, currency: 'NGN', payment_options: 'card,banktransfer,ussd' });
  });

  it('marks the offer paid only after Flutterwave confirms the transaction', async () => {
    const s = await liveShop();
    await s.tap(s.offers[0].payment_ref);
    const res = await s.webhook(s.fw.pay(s.fw.created[0].tx_ref));
    expect(await res.json()).toEqual({ outcome: 'paid' });
    expect(await s.status()).toEqual(['paid']);
    expect(await s.stock()).toBe(0);
    expect(env.channel.sent.at(-1)).toMatchObject({ to: wa(1), kind: 'text', body: expect.stringContaining('Payment received') });
  });

  it('accepts a payment where the customer also paid the Flutterwave fee', async () => {
    const s = await liveShop();
    await s.tap(s.offers[0].payment_ref);
    expect(await (await s.webhook(s.fw.pay(s.fw.created[0].tx_ref, { fee: 300 }))).json()).toEqual({ outcome: 'paid' });
  });

  it('counts a retried webhook once', async () => {
    const s = await liveShop();
    await s.tap(s.offers[0].payment_ref);
    const body = s.fw.pay(s.fw.created[0].tx_ref);
    expect(await (await s.webhook(body)).json()).toEqual({ outcome: 'paid' });
    expect(await (await s.webhook(body)).json()).toEqual({ outcome: 'duplicate' });
    expect(await s.stock()).toBe(0);
  });

  it('rejects a webhook without the secret hash', async () => {
    const s = await liveShop();
    await s.tap(s.offers[0].payment_ref);
    expect((await s.webhook(s.fw.pay(s.fw.created[0].tx_ref), 'guess')).status).toBe(401);
    expect(await s.status()).toEqual(['held']);
  });

  it('ignores failed payments', async () => {
    const s = await liveShop();
    await s.tap(s.offers[0].payment_ref);
    expect(await (await s.webhook(s.fw.pay(s.fw.created[0].tx_ref, { status: 'failed' }))).json()).toEqual({ ignored: true });
    expect(await s.status()).toEqual(['held']);
  });

  it('trusts Flutterwave’s verified amount over a webhook that claims more', async () => {
    const s = await liveShop();
    await s.tap(s.offers[0].payment_ref);
    // Someone replays a webhook claiming 15,000 for a transaction that really paid 100.
    const res = await s.webhook(s.fw.pay(s.fw.created[0].tx_ref, { amount: 100, webhookAmount: 15000 }));
    expect(await res.json()).toEqual({ outcome: 'underpaid' });
    expect(await s.status()).toEqual(['held']);
  });

  it('ignores a webhook for a transaction Flutterwave has never heard of', async () => {
    const s = await liveShop();
    await s.tap(s.offers[0].payment_ref);
    const forged = JSON.stringify({ event: 'charge.completed', data: { id: 1, status: 'successful', tx_ref: s.fw.created[0].tx_ref, amount: 15000, currency: 'XAF' } });
    expect(await (await s.webhook(forged)).json()).toMatchObject({ ignored: true });
    expect(await s.status()).toEqual(['held']);
  });

  it('rejects payment in the wrong currency', async () => {
    const s = await liveShop();
    await s.tap(s.offers[0].payment_ref);
    expect(await (await s.webhook(s.fw.pay(s.fw.created[0].tx_ref, { currency: 'USD' }))).json()).toEqual({ outcome: 'underpaid' });
  });

  it('shows a clear page when Flutterwave refuses to create a checkout', async () => {
    const s = await liveShop();
    s.fw.failWith('Invalid currency for merchant');
    const res = await s.tap(s.offers[0].payment_ref);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('Payment is unavailable right now');
  });

  it('flags a refund when someone pays after the unit went to the next person', async () => {
    const s = await liveShop();
    await s.tap(s.offers[0].payment_ref); // customer 1 opens checkout but is slow
    const { tick } = await import('../src/services/restock.js');
    await tick(env.ctx, new Date(T0.getTime() + 121 * 60_000)); // hold lapses, unit goes to customer 2
    await s.tap((await env.db.query<{ payment_ref: string }>(`select payment_ref from offers where status = 'held'`))[0].payment_ref);
    expect(await (await s.webhook(s.fw.pay(s.fw.created[1].tx_ref))).json()).toEqual({ outcome: 'paid' });
    expect(await (await s.webhook(s.fw.pay(s.fw.created[0].tx_ref))).json()).toEqual({ outcome: 'refund_due' });
    expect(await s.stock()).toBe(0);
  });
});
