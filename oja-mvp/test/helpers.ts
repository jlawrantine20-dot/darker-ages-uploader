import { DryRunChannel, type InboundText } from '../src/channels/whatsapp.js';
import { loadConfig } from '../src/config.js';
import { embeddedDb, migrate } from '../src/db.js';
import { marketFor } from '../src/domain/markets.js';
import { toMinor } from '../src/domain/money.js';
import type { Ctx } from '../src/services/context.js';

export const PHONE_ID = '1098765432';
export const T0 = new Date('2026-10-05T09:00:00Z'); // 10:00 in Douala and Lagos

export const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** A shop with three products. Defaults to Cameroon, in English, pricing in FCFA. */
export async function setup(opts: { country?: string; language?: 'en' | 'fr' | 'fr+en'; clipPrice?: number } = {}) {
  const country = opts.country ?? 'CM';
  const m = marketFor(country)!;
  const language = opts.language ?? 'en';
  const db = await embeddedDb();
  await migrate(db);
  const channel = new DryRunChannel();
  const config = loadConfig({ DRY_RUN: 'true', PUBLIC_URL: 'https://oja.test' });
  const ctx: Ctx = { db, channel, config };
  const [seller] = await db.query<{ id: string }>(
    `insert into sellers (name, wa_phone_number_id, country, currency, language, timezone)
     values ('Douala Hair Plug', $1, $2, $3, $4, $5) returning id`,
    [PHONE_ID, country, m.currency, language, m.timezone],
  );
  const clipPrice = toMinor(opts.clipPrice ?? 15000, m.currency);
  const product = async (name: string, variant: string, priceMinor: number, stock = 0, aliases: string[] = []) =>
    (await db.query<{ id: string }>(
      'insert into products (seller_id, name, variant, price_minor, stock, aliases) values ($1, $2, $3, $4, $5, $6) returning id',
      [seller.id, name, variant, priceMinor, stock, aliases],
    ))[0].id;
  const fr = language === 'fr';
  const brown = await product('12" Claw Clip Ponytail', fr ? 'Marron' : 'Brown', clipPrice);
  const black = await product('12" Claw Clip Ponytail', fr ? 'Noir' : 'Jet black', clipPrice, 6);
  const bonnet = await product('Satin Bonnet', 'Wine', toMinor(5000, m.currency), 0, ['bonnet satin']);
  return { db, ctx, channel, sellerId: seller.id, brown, black, bonnet, clipPrice, currency: m.currency };
}

let n = 0;
export const inbound = (from: string, text: string, when: Date, name?: string): InboundText => ({
  phoneNumberId: PHONE_ID,
  from,
  name,
  text,
  providerId: `wamid.${++n}`,
  at: when,
});

/** Customer number i, as a Cameroonian WhatsApp id. */
export const wa = (i: number) => `2376770000${String(i).padStart(2, '0')}`;
