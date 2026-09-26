import { DryRunChannel, type InboundText } from '../src/channels/whatsapp.js';
import { loadConfig } from '../src/config.js';
import { embeddedDb, migrate } from '../src/db.js';
import { dryRunPayments } from '../src/payments/paystack.js';
import type { Ctx } from '../src/services/context.js';

export const PHONE_ID = '1098765432';
export const T0 = new Date('2026-10-05T09:00:00Z'); // 10:00 AM in Lagos

export const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

export async function setup() {
  const db = await embeddedDb();
  await migrate(db);
  const channel = new DryRunChannel();
  const config = loadConfig({ DRY_RUN: 'true', PUBLIC_URL: 'https://oja.test' });
  const ctx: Ctx = { db, channel, payments: dryRunPayments(config.publicUrl), config };
  const [seller] = await db.query<{ id: string }>(
    `insert into sellers (name, wa_phone_number_id) values ('Lekki Hair Plug', $1) returning id`,
    [PHONE_ID],
  );
  const product = async (name: string, variant: string, priceNaira: number, stock = 0) =>
    (await db.query<{ id: string }>(
      'insert into products (seller_id, name, variant, price_kobo, stock) values ($1, $2, $3, $4, $5) returning id',
      [seller.id, name, variant, priceNaira * 100, stock],
    ))[0].id;
  const brown = await product('12" Claw Clip Ponytail', 'Brown', 18500);
  const black = await product('12" Claw Clip Ponytail', 'Jet black', 18500, 6);
  const bonnet = await product('Satin Bonnet', 'Wine', 6500);
  return { db, ctx, channel, sellerId: seller.id, brown, black, bonnet };
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

/** Customer number n, as a WhatsApp id. */
export const wa = (i: number) => `23480300000${String(i).padStart(2, '0')}`;
