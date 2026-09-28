/**
 * Web Push, the browser standard for notifications (RFC 8291 message encryption, RFC 8292
 * VAPID). Built on WebCrypto so it runs the same in Node and on the Supabase edge, with no
 * third-party push service: the notification goes straight to the phone's browser vendor.
 */
import { Buffer } from 'node:buffer';

const subtle = () => globalThis.crypto.subtle;
/** Bytes backed by a plain ArrayBuffer, as WebCrypto wants. */
type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();

export const b64url = (b: Bytes) => Buffer.from(b).toString('base64url');
export const unb64url = (s: string): Bytes => new Uint8Array(Buffer.from(s, 'base64url'));

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's public key, base64url, 65 bytes uncompressed. */
  p256dh: string;
  /** The browser's auth secret, base64url, 16 bytes. */
  auth: string;
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 public key; this is also what the browser subscribes with. */
  publicKey: string;
  /** base64url, 32-byte P-256 private scalar. */
  privateKey: string;
  subject: string;
}

/** Encrypt a payload for one browser (aes128gcm content coding, a single record). */
export async function encryptPayload(sub: PushSubscriptionKeys, payload: Bytes, salt: Bytes = crypto.getRandomValues(new Uint8Array(16))): Promise<Bytes> {
  const uaPublic = unb64url(sub.p256dh);
  const authSecret = unb64url(sub.auth);
  const local = (await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await subtle().exportKey('raw', local.publicKey));
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (only) record.
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** The VAPID Authorization header: a short-lived ES256 token for the push service's origin. */
export async function vapidHeader(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const pub = unb64url(vapid.publicKey);
  const key = await subtle().importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const part = (o: object) => b64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })}`;
  const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${vapid.publicKey}`;
}

/** Send one notification. Returns the push service's status: 201 sent, 404/410 the subscription is gone. */
export async function sendWebPush(sub: PushSubscriptionKeys, data: object, vapid: VapidKeys, fetchFn: typeof fetch = fetch): Promise<number> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(data)));
  const res = await fetchFn(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 3600),
      Urgency: 'high',
    },
    body,
  });
  return res.status;
}

/** A fresh VAPID key pair, for setup (see scripts/vapid-keys.ts). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await subtle().exportKey('jwk', pair.privateKey);
  return { publicKey: b64url(new Uint8Array(await subtle().exportKey('raw', pair.publicKey))), privateKey: jwk.d! };
}
