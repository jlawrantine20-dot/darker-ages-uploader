/**
 * WhatsApp Embedded Signup: a seller connects their own WhatsApp Business number from the app.
 *
 * In the browser, Meta's signup window lets the seller log in with Facebook, pick or create a
 * WhatsApp Business account and number, and returns a one-time code plus the ids of what they
 * chose. Here, on the server:
 *  1. the code is exchanged for an access key to that seller's account (never seen by the browser);
 *  2. the number is checked to really belong to the account the key opens;
 *  3. NKAPGUARD subscribes to the account's messages, so customer messages reach the webhook;
 *  4. the number is registered for the Cloud API (a fresh two-step PIN, kept encrypted);
 *  5. the shop's message templates are submitted to the account for Meta's review.
 * The key is stored encrypted on the shop and used for everything sent from its number.
 */
import { randomInt } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Q } from '../db.js';
import type { Ctx } from './context.js';
import { InputError } from './errors.js';
import { submitTemplates, type TemplateStatus } from './templates.js';

export interface SignupResult {
  code: string;
  phoneNumberId: string;
  wabaId: string;
}

/** What the browser needs to open Meta's signup window, or null when it isn't set up. */
export function signupConfig(ctx: Ctx) {
  const { appId, appSecret, graphVersion } = ctx.config.meta;
  const configId = ctx.config.whatsapp.signupConfigId;
  return appId && appSecret && configId ? { appId, configId, graphVersion } : null;
}

async function graph<T>(ctx: Ctx, path: string, token: string | null, init?: { method?: string; body?: unknown }): Promise<T> {
  const url = `https://graph.facebook.com/${ctx.config.meta.graphVersion}/${path}`;
  const res = await (ctx.fetch ?? fetch)(url, {
    method: init?.method ?? 'GET',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string } } & T;
  if (!res.ok || json.error) throw new Error(json.error?.error_user_msg ?? json.error?.message ?? `Meta returned ${res.status}`);
  return json;
}

export interface ConnectedNumber {
  phoneNumberId: string;
  wabaId: string;
  tokenEnc: string;
  pinEnc: string;
  display: string | null;
  verifiedName: string | null;
  /** Steps Meta refused that the seller can retry later, such as registering the number. */
  warnings: string[];
}

/** Steps 1 to 4. Nothing is saved to the shop here; the caller does that. */
export async function connectNumber(ctx: Ctx, s: SignupResult): Promise<ConnectedNumber> {
  const cfg = signupConfig(ctx);
  if (!cfg) throw new InputError('signup_not_set_up');
  const code = String(s.code ?? '').trim();
  const phoneNumberId = String(s.phoneNumberId ?? '').trim();
  const wabaId = String(s.wabaId ?? '').trim();
  if (!code || !/^\d{5,25}$/.test(phoneNumberId) || !/^\d{5,25}$/.test(wabaId)) throw new InputError('signup_incomplete');

  // 1. The one-time code becomes a key for this seller's account.
  let token: string;
  try {
    const q = new URLSearchParams({ client_id: cfg.appId, client_secret: ctx.config.meta.appSecret, code });
    token = (await graph<{ access_token: string }>(ctx, `oauth/access_token?${q}`, null)).access_token;
  } catch (err) {
    throw new InputError('signup_refused', { why: (err as Error).message });
  }

  // 2. The number must be in the account this key opens: a browser can't claim someone else's.
  const numbers = await graph<{ data: { id: string; display_phone_number?: string; verified_name?: string }[] }>(
    ctx, `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, token,
  ).catch((err) => { throw new InputError('signup_refused', { why: (err as Error).message }); });
  const number = numbers.data.find((n) => n.id === phoneNumberId);
  if (!number) throw new InputError('signup_wrong_number');

  const warnings: string[] = [];
  // 3. Customer messages to this number come to NKAPGUARD's webhook.
  await graph(ctx, `${wabaId}/subscribed_apps`, token, { method: 'POST' }).catch((err) => warnings.push(`subscribe: ${(err as Error).message}`));
  // 4. Turn the number on for the Cloud API. Numbers already registered (or kept in the
  // WhatsApp Business app) can refuse; messages may still work, so it's a warning.
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await graph(ctx, `${phoneNumberId}/register`, token, { method: 'POST', body: { messaging_product: 'whatsapp', pin } })
    .catch((err) => warnings.push(`register: ${(err as Error).message}`));

  return {
    phoneNumberId,
    wabaId,
    tokenEnc: encryptSecret(token, ctx.config.appSecret),
    pinEnc: encryptSecret(pin, ctx.config.appSecret),
    display: number.display_phone_number ? number.display_phone_number.replace(/\D/g, '') : null,
    verifiedName: number.verified_name ?? null,
    warnings,
  };
}

/** Save a connected number on a shop. A number can only belong to one shop. */
export async function saveNumber(q: Q, sellerId: string, n: ConnectedNumber) {
  const [taken] = await q.query<{ id: string }>('select id from sellers where wa_phone_number_id = $1 and id <> $2', [n.phoneNumberId, sellerId]);
  if (taken) throw new InputError('wa_number_taken');
  await q.query(
    `update sellers set wa_phone_number_id = $2, waba_id = $3, wa_token_enc = $4, wa_pin_enc = $5, wa_verified_name = $6,
            wa_display_phone = coalesce($7, wa_display_phone), wa_connected_at = now()
      where id = $1`,
    [sellerId, n.phoneNumberId, n.wabaId, n.tokenEnc, n.pinEnc, n.verifiedName, n.display],
  );
}

/** Step 5, after the shop is saved. Meta reviews templates in minutes to a day. */
export async function submitShopTemplates(ctx: Ctx, n: Pick<ConnectedNumber, 'wabaId' | 'tokenEnc'>): Promise<TemplateStatus[]> {
  try {
    return await submitTemplates(ctx, n.wabaId, decryptSecret(n.tokenEnc, ctx.config.appSecret));
  } catch (err) {
    console.error('Template submission failed', err);
    return [];
  }
}

/**
 * The key to send from a number: the shop's own when it connected through signup, otherwise
 * NKAPGUARD's (the platform number, and shops set up by hand). Cached for a few minutes.
 */
export function tokenLookup(db: Q, appSecret: string, ttlMs = 5 * 60_000) {
  const cache = new Map<string, { token: string | null; at: number }>();
  return async (phoneNumberId: string): Promise<string | null> => {
    const hit = cache.get(phoneNumberId);
    if (hit && Date.now() - hit.at < ttlMs) return hit.token;
    const [row] = await db.query<{ wa_token_enc: string | null }>('select wa_token_enc from sellers where wa_phone_number_id = $1', [phoneNumberId]);
    let token: string | null = null;
    try { token = row?.wa_token_enc ? decryptSecret(row.wa_token_enc, appSecret) : null; } catch { token = null; }
    cache.set(phoneNumberId, { token, at: Date.now() });
    return token;
  };
}
