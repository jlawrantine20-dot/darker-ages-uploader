/**
 * Plays a full restock story against an in-memory database with nothing sent:
 * customers ask about a sold-out clip, opt in, stock arrives, holds expire and pass
 * down the line, people pay. Run with: npm run simulate
 */
import { DryRunChannel, type InboundText } from '../src/channels/whatsapp.js';
import { clockTime, naira } from '../src/domain/copy.js';
import { loadConfig } from '../src/config.js';
import { embeddedDb, migrate } from '../src/db.js';
import { dryRunPayments } from '../src/payments/paystack.js';
import { handleInbound } from '../src/services/inbound.js';
import { handlePayment, startRestock, tick } from '../src/services/restock.js';

const PHONE_ID = '1098765432';
const start = new Date('2026-10-05T09:00:00Z');
let now = new Date('2026-10-01T15:00:00Z');
const config = loadConfig({ DRY_RUN: 'true', PUBLIC_URL: 'https://oja.test' });
const names = new Map<string, string>();
const channel = new DryRunChannel((m) => {
  const who = names.get(m.to) ?? m.to;
  const text = m.body ?? `[template ${m.template?.name}] ${m.template?.params.join(' | ')}`;
  console.log(`   ${clockTime(now, config.timezone).padStart(8)}  Oja → ${who}: ${text}`);
});
const db = await embeddedDb();
await migrate(db);
const ctx = { db, channel, payments: dryRunPayments(config.publicUrl), config };

const [seller] = await db.query<{ id: string }>(`insert into sellers (name, wa_phone_number_id) values ('Lekki Hair Plug', $1) returning id`, [PHONE_ID]);
const [brown] = await db.query<{ id: string }>(
  `insert into products (seller_id, name, variant, price_kobo, stock) values ($1, '12" Claw Clip Ponytail', 'Brown', 1850000, 0) returning id`,
  [seller.id],
);

let n = 0;
async function say(num: string, name: string, text: string) {
  names.set(num, name.split(' ')[0]);
  console.log(`   ${clockTime(now, config.timezone).padStart(8)}  ${name.split(' ')[0]}: ${text}`);
  const msg: InboundText = { phoneNumberId: PHONE_ID, from: num, name, text, providerId: `wamid.${++n}`, at: now };
  await handleInbound(ctx, msg);
}
const step = (title: string) => console.log(`\n── ${title}`);
const minutes = (m: number) => (now = new Date(now.getTime() + m * 60_000));

step('Tuesday: customers ask about a sold-out item');
const buyers = [
  ['2348035552190', 'Amaka Obi', 'Hi! Do you have the 12 inch claw clip ponytail in brown?', 'Yes please'],
  ['2348124407781', 'Halima Musa', 'una get the brown claw clip?', 'yes'],
  ['2347069001234', 'Kemi Ade', 'Is the brown claw clip ponytail available', 'yes but how much?'],
  ['2349032218765', 'Ngozi Eze', 'do you still have brown claw clip ponytail', 'ok'],
  ['2348170045566', 'Tolu Bello', 'brown claw clip ponytail in stock?', 'YES'],
] as const;
for (const [num, name, ask, reply] of buyers) {
  await say(num, name, ask);
  minutes(1);
  await say(num, name, reply);
  minutes(37);
}
console.log('   (Kemi hedged, so she was not added. Nobody is messaged without a clear yes.)');
minutes(20);
await say('2348170045566', 'Tolu Bello', 'STOP');

step('Monday 10:00 AM: 2 brown clips arrive. Hold one each for 2 hours.');
now = start;
const r = await startRestock(ctx, { productId: brown.id, units: 2, mode: 'hold', holdMinutes: 120 }, now);
console.log(`   ${r.offered} alerts sent, ${r.waiting} people waiting.`);

const pay = async (who: string) => {
  const [o] = await db.query<{ payment_ref: string }>(
    `select o.payment_ref from offers o join interests i on i.id = o.interest_id join contacts c on c.id = i.contact_id
      where c.name = $1 order by o.sent_at desc limit 1`,
    [who],
  );
  console.log(`   ${clockTime(now, config.timezone).padStart(8)}  ${who.split(' ')[0]} pays the Paystack link`);
  await handlePayment(ctx, { reference: o.payment_ref, amountKobo: 1850000 }, now);
};

step('Amaka pays after 18 minutes. Halima does not answer.');
minutes(18);
await pay('Amaka Obi');

step('12:01 PM: Halima’s hold lapses and passes to the next person in line');
now = new Date(start.getTime() + 121 * 60_000);
await tick(ctx, now);
minutes(25);
await pay('Ngozi Eze');

step('Result');
const [spend] = await db.query<{ n: number; kobo: number }>(`select count(*)::int as n, sum(cost_kobo)::int as kobo from messages where direction = 'out'`);
const [{ stock }] = await db.query<{ stock: number }>('select stock from products where id = $1', [brown.id]);
console.log(`   2 of 2 sold for ${naira(2 * 1850000)}. ${spend.n} messages, about ${naira(spend.kobo)} in Meta fees (estimate). Stock left: ${stock}.`);
console.log('   Halima keeps her place for the next restock. Tolu opted out and was never messaged.');
await db.close();
