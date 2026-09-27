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
}

/** Fill in currency, language and time zone from the country when not given, and check everything. */
export function resolveSellerInput(b: SellerInput, current?: Seller) {
  const country = (b.country ?? current?.country ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new InputError('country must be a two-letter code, like CM or NG');
  const m = country !== current?.country ? marketFor(country) : null;
  const currency = (b.currency ?? m?.currency ?? current?.currency ?? '').toUpperCase();
  const language = b.language ?? m?.language ?? current?.language ?? 'en';
  const timezone = b.timezone ?? m?.timezone ?? current?.timezone ?? '';
  if (!isCurrency(currency)) throw new InputError(`Choose a currency for ${country}, like XAF or USD.`);
  if (!LANGS.includes(language as Lang)) throw new InputError(`language must be one of: ${LANGS.join(', ')}`);
  if (!isTimezone(timezone)) throw new InputError(`Choose a time zone for ${country}, like Africa/Douala.`);
  const name = (b.name ?? current?.name ?? '').trim();
  if (!name) throw new InputError('Give the shop a name.');
  return { name, country, currency, language: language as Lang, timezone };
}

export async function setPaymentProvider(
  ctx: Ctx,
  sellerId: string,
  b: { provider: Provider; secretKey?: string; webhookSecret?: string },
) {
  const info = PROVIDER_INFO[b.provider];
  if (!info) throw new InputError(`Unknown payment provider: ${b.provider}`);
  if (b.provider !== 'test') {
    if (!b.secretKey?.trim()) throw new InputError(`Paste your ${info.label.split(' (')[0]} secret key.`);
    if (info.needsWebhookSecret && !b.webhookSecret?.trim()) throw new InputError(`${info.label.split(' (')[0]} also needs its webhook secret.`);
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
