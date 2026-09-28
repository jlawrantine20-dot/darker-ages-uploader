import { normalizePhone } from '../domain/phone.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Q } from '../db.js';
import { LANGS, type Lang, type Provider, isCurrency, isTimezone, marketFor } from '../domain/markets.js';
import { formatMoney } from '../domain/money.js';
import { parts, type Fmt } from '../domain/copy.js';
import { PROVIDER_INFO, makeProvider, type PaymentProvider } from '../payments/providers.js';
import type { Ctx } from './context.js';
import { InputError } from './errors.js';

export interface Seller {
  id: string;
  name: string;
  wa_phone_number_id: string;
  country: string;
  currency: string;
  language: Lang;
  timezone: string;
  /** The shop page link name, like "hair-plug". */
  slug: string | null;
  /** The number customers message, in international digits, like 237677123456. */
  wa_display_phone: string | null;
  payment_provider: Provider;
  payment_secret_enc: string | null;
  payment_webhook_secret_enc: string | null;
}

/** A seller as the API shows it: never includes secrets. */
export function publicSeller(s: Seller) {
  const { payment_secret_enc, payment_webhook_secret_enc, ...rest } = s;
  return { ...rest, payments_connected: s.payment_provider === 'test' || !!payment_secret_enc };
}

export async function getSeller(q: Q, id: string): Promise<Seller | null> {
  return (await q.query<Seller>('select * from sellers where id = $1', [id]))[0] ?? null;
}

export const money = (s: Pick<Seller, 'currency' | 'language' | 'country'>, minor: number) => formatMoney(minor, s.currency, parts(s.language)[0], s.country);
export const fmt = (s: Seller): Fmt => ({ currency: s.currency, country: s.country, timezone: s.timezone });

export interface SellerInput {
  name?: string;
  waPhoneNumberId?: string;
  country?: string;
  currency?: string;
  language?: string;
  timezone?: string;
  slug?: string;
  waDisplayPhone?: string;
}

/** "Hair Plug Douala!" → "hair-plug-douala". Accents are dropped: "Mèches" → "meches". */
export function slugify(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'shop';
}

/** A free link name for a new shop: "hair-plug", or "hair-plug-2" if that one is taken. */
export async function uniqueSlug(q: Q, name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const [taken] = await q.query('select 1 from sellers where slug = $1', [candidate]);
    if (!taken) return candidate;
  }
}

/** Fill in currency, language and time zone from the country when not given, and check everything. */
export function resolveSellerInput(b: SellerInput, current?: Seller) {
  const country = (b.country ?? current?.country ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new InputError('country_code');
  const m = country !== current?.country ? marketFor(country) : null;
  const currency = (b.currency ?? m?.currency ?? current?.currency ?? '').toUpperCase();
  const language = b.language ?? m?.language ?? current?.language ?? 'en';
  const timezone = b.timezone ?? m?.timezone ?? current?.timezone ?? '';
  if (!isCurrency(currency)) throw new InputError('currency_for', { country });
  if (!LANGS.includes(language as Lang)) throw new InputError('language_invalid');
  if (!isTimezone(timezone)) throw new InputError('timezone_for', { country });
  const name = (b.name ?? current?.name ?? '').trim();
  if (!name) throw new InputError('shop_name');
  const slug = b.slug === undefined ? current?.slug ?? null : b.slug.trim().toLowerCase();
  if (slug !== null && !/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) {
    throw new InputError('slug_invalid');
  }
  let waDisplayPhone = current?.wa_display_phone ?? null;
  if (b.waDisplayPhone !== undefined) {
    waDisplayPhone = b.waDisplayPhone.trim() ? normalizePhone(b.waDisplayPhone, country) : null;
    if (b.waDisplayPhone.trim() && !waDisplayPhone) throw new InputError('wa_display_invalid');
  }
  return { name, country, currency, language: language as Lang, timezone, slug, waDisplayPhone };
}

export async function setPaymentProvider(
  ctx: Ctx,
  sellerId: string,
  b: { provider: Provider; secretKey?: string; webhookSecret?: string },
) {
  const info = PROVIDER_INFO[b.provider];
  if (!info) throw new InputError('provider_unknown', { provider: String(b.provider) });
  if (b.provider !== 'test') {
    if (!b.secretKey?.trim()) throw new InputError('paste_secret', { provider: info.label.split(' (')[0] });
    if (info.needsWebhookSecret && !b.webhookSecret?.trim()) throw new InputError('needs_webhook_secret', { provider: info.label.split(' (')[0] });
  }
  const enc = (v?: string) => (v?.trim() ? encryptSecret(v.trim(), ctx.config.appSecret) : null);
  await ctx.db.query(
    'update sellers set payment_provider = $2, payment_secret_enc = $3, payment_webhook_secret_enc = $4 where id = $1',
    [sellerId, b.provider, enc(b.secretKey), enc(b.webhookSecret)],
  );
}

/** The seller's payment provider. In dry-run mode every seller uses test payments. */
export function providerFor(ctx: Ctx, s: Seller): PaymentProvider {
  const name: Provider = ctx.config.dryRun ? 'test' : s.payment_provider;
  const dec = (v: string | null) => (v ? decryptSecret(v, ctx.config.appSecret) : '');
  return (ctx.providerFactory ?? makeProvider)(name, {
    secretKey: name === 'test' ? '' : dec(s.payment_secret_enc),
    webhookSecret: name === 'test' ? undefined : dec(s.payment_webhook_secret_enc) || undefined,
    publicUrl: ctx.config.publicUrl,
    emailDomain: ctx.config.buyerEmailDomain,
  });
}
