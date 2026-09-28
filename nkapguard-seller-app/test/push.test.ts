import { afterEach, describe, expect, it } from 'vitest';
import { b64url, encryptPayload, generateVapidKeys, unb64url, vapidHeader } from '../src/channels/webpush.js';
import { createApp } from '../src/app.js';
import { handleInbound } from '../src/services/inbound.js';
import { saveSubscription } from '../src/services/push.js';
import { T0, at, inbound, setup, wa } from './helpers.js';

const subtle = globalThis.crypto.subtle;
type Bytes = Uint8Array<ArrayBuffer>;

/** A browser's side of a subscription: its key pair and auth secret. */
async function browser() {
  const pair = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey)) as Bytes;
  const auth = crypto.getRandomValues(new Uint8Array(16)) as Bytes;
  return { pair, keys: { p256dh: b64url(pub), auth: b64url(auth) }, pub, auth };
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8)) as Bytes;
}

/** Decrypt as the browser would (RFC 8291), to prove the encryption is right. */
async function decrypt(b: Awaited<ReturnType<typeof browser>>, body: Bytes): Promise<string> {
  const enc = new TextEncoder();
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, b.pair.privateKey, 256)) as Bytes;
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...b.pub, ...asPublic]) as Bytes;
  const ikm = await hkdf(b.auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0') as Bytes, 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0') as Bytes, 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain.at(-1)).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('Web Push', () => {
  it('encrypts so only the browser can read it', async () => {
    const b = await browser();
    const body = await encryptPayload({ endpoint: 'https://push.example/x', ...b.keys }, new TextEncoder().encode('Nouvelle commande') as Bytes);
    expect(await decrypt(b, body)).toBe('Nouvelle commande');
  });

  it('signs a VAPID token the push service can check', async () => {
    const vapid = { ...(await generateVapidKeys()), subject: 'mailto:support@nkapguard.com' };
    const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', vapid, Date.UTC(2026, 9, 1));
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(vapid.publicKey);
    const [h, p, sig] = token.split('.');
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:support@nkapguard.com' });
    const pub = await subtle.importKey('raw', unb64url(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64url(sig), new TextEncoder().encode(`${h}.${p}`))).toBe(true);
  });
});

describe('Seller notifications', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  afterEach(async () => env?.db.close());

  it('tells the shop about new messages and orders, in each phone’s language, and forgets dead phones', async () => {
    env = await setup();
    env.ctx.config = { ...env.ctx.config, push: { ...(await generateVapidKeys()), subject: 'mailto:support@nkapguard.com' } };
    const [user] = await env.db.query<{ id: string }>(`insert into users (wa_id) values ('237699000001') returning id`);
    await env.db.query(`insert into shop_members (seller_id, user_id, role) values ($1, $2, 'owner')`, [env.sellerId, user.id]);
    const fr = await browser();
    const gone = await browser();
    await saveSubscription(env.ctx, user.id, { endpoint: 'https://push.example/fr', ...fr.keys }, 'fr');
    await saveSubscription(env.ctx, user.id, { endpoint: 'https://push.example/gone', ...gone.keys }, 'en');
    const pushed: { url: string; body: Bytes }[] = [];
    env.ctx.fetch = (async (url: string, init: RequestInit) => {
      pushed.push({ url, body: init.body as Bytes });
      return new Response(null, { status: url.endsWith('/gone') ? 410 : 201 });
    }) as typeof fetch;

    await handleInbound(env.ctx, inbound(wa(1), 'do you have the jet black claw clip ponytail?', T0, 'Paul Eto'));
    const toFr = pushed.find((p) => p.url.endsWith('/fr'))!;
    expect(JSON.parse(await decrypt(fr, toFr.body))).toMatchObject({ title: 'Paul Eto', body: 'do you have the jet black claw clip ponytail?' });
    // The dead phone was dropped.
    expect((await env.db.query('select endpoint from push_subscriptions')).length).toBe(1);

    pushed.length = 0;
    await handleInbound(env.ctx, inbound(wa(1), 'yes', at(1)));
    const n = JSON.parse(await decrypt(fr, pushed[0].body));
    expect(n).toMatchObject({ title: 'Nouvelle commande', url: '#/orders' });
    expect(n.body).toMatch(/^Paul Eto · 12" Claw Clip Ponytail jet black · 15 000 FCFA$/);
  });

  it('lets a signed-in seller turn notifications on and off for a phone', async () => {
    env = await setup();
    env.ctx.config = { ...env.ctx.config, push: { ...(await generateVapidKeys()), subject: 'mailto:x@y.z' } };
    const app = createApp(env.ctx, () => T0);
    const res = await app.request('/api/push');
    expect(await res.json()).toMatchObject({ available: true, subscribed: false });
  });
});
