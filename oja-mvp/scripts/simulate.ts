/**
 * Plays a full restock story against an in-memory database with nothing sent:
 * customers ask about a sold-out item, opt in, stock arrives, holds expire and pass
 * down the line, people pay. Run with: npm run simulate [-- --country NG --lang en]
 */
import { DryRunChannel, type InboundText } from '../src/channels/whatsapp.js';
import { clockTime } from '../src/domain/copy.js';
import { loadConfig } from '../src/config.js';
import { embeddedDb, migrate } from '../src/db.js';
import { marketFor } from '../src/domain/markets.js';
import { formatMoney, formatUsdMicros, toMinor } from '../src/domain/money.js';
import { handleInbound } from '../src/services/inbound.js';
import { handlePayment, startRestock, tick } from '../src/services/restock.js';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const country = arg('country', 'CM').toUpperCase();
const m = marketFor(country);
if (!m) throw new Error(`No defaults for ${country}. Try CM, NG, KE, GH, US, FR.`);
const lang = arg('lang', m.language) as 'en' | 'fr' | 'fr+en';
const fr = lang !== 'en';

const PHONE_ID = '1098765432';
const start = new Date('2026-10-05T09:00:00Z');
let now = new Date('2026-10-01T15:00:00Z');
const config = loadConfig({ DRY_RUN: 'true', PUBLIC_URL: 'https://oja.test' });
const names = new Map<string, string>();
const at = () => clockTime(now, m.timezone, lang).padStart(8);
const channel = new DryRunChannel((msg) => {
  const who = names.get(msg.to) ?? msg.to;
  const text = msg.body ?? `[template ${msg.template?.name} · ${msg.template?.language}] ${msg.template?.params.join(' | ')}`;
  console.log(`   ${at()}  Oja → ${who}: ${text}`);
});
const db = await embeddedDb();
await migrate(db);
const ctx = { db, channel, config };

const price = toMinor(country === 'CM' ? 15000 : country === 'NG' ? 18500 : 25, m.currency);
const [seller] = await db.query<{ id: string }>(
  `insert into sellers (name, wa_phone_number_id, country, currency, language, timezone) values ('Hair Plug', $1, $2, $3, $4, $5) returning id`,
  [PHONE_ID, country, m.currency, lang, m.timezone],
);
const [brown] = await db.query<{ id: string }>(
  `insert into products (seller_id, name, variant, price_minor, stock) values ($1, 'Claw Clip Ponytail', $2, $3, 0) returning id`,
  [seller.id, lang === 'fr+en' ? 'Marron / Brown' : fr ? 'Marron' : 'Brown', price],
);
const money = (minor: number) => formatMoney(minor, m.currency, lang, country);
console.log(`Shop in ${m.name}, messaging customers in ${{ en: 'English', fr: 'French', 'fr+en': 'French and English' }[lang]}, prices in ${m.currency}.`);

const cc = { CM: '2376770000', NG: '2348030000', KE: '2547120000', GH: '2332440000', US: '1415555', FR: '336120000' }[country] ?? '2376770000';
let n = 0;
async function say(num: string, name: string, text: string) {
  names.set(num, name.split(' ')[0]);
  console.log(`   ${at()}  ${name.split(' ')[0]}: ${text}`);
  const msg: InboundText = { phoneNumberId: PHONE_ID, from: num, name, text, providerId: `wamid.${++n}`, at: now };
  await handleInbound(ctx, msg);
}
const step = (title: string) => console.log(`\n── ${title}`);
const minutes = (x: number) => (now = new Date(now.getTime() + x * 60_000));

step('Customers ask about a sold-out item');
const buyers = fr
  ? [
      ['Nadège Mballa', 'Bonsoir, vous avez encore la claw clip ponytail marron ?', "Oui d'accord"],
      ['Brice Nkotto', 'la claw clip ponytail marron est dispo ?', 'oui'],
      ['Carine Fouda', 'Il en reste, la claw clip ponytail marron ?', "oui mais c'est combien ?"],
      ['Aïcha Bello', 'y a encore la claw clip ponytail marron?', 'ok'],
      ['Junior Tchoupo', 'claw clip ponytail marron disponible ?', 'OUI'],
    ]
  : [
      ['Amaka Obi', 'Hi! Do you have the claw clip ponytail in brown?', 'Yes please'],
      ['Halima Musa', 'una get the brown claw clip ponytail?', 'yes'],
      ['Kemi Ade', 'Is the brown claw clip ponytail available', 'yes but how much?'],
      ['Ngozi Eze', 'do you still have brown claw clip ponytail', 'ok'],
      ['Tolu Bello', 'brown claw clip ponytail in stock?', 'YES'],
    ];
const nums = buyers.map((_, i) => `${cc}${String(i + 11).padStart(2, '0')}`);
for (const [i, [name, ask, reply]] of buyers.entries()) {
  await say(nums[i], name, ask);
  minutes(1);
  await say(nums[i], name, reply);
  minutes(37);
}
console.log(`   (${buyers[2][0].split(' ')[0]} hedged, so they were not added. Nobody is messaged without a clear yes.)`);
minutes(20);
await say(nums[4], buyers[4][0], 'STOP');

step('Monday 10:00: 2 units arrive. Hold one each for 2 hours.');
now = start;
const r = await startRestock(ctx, { productId: brown.id, units: 2, mode: 'hold', holdMinutes: 120 }, now);
console.log(`   ${r.offered} alerts sent, ${r.waiting} people waiting.`);

const pay = async (idx: number) => {
  const [o] = await db.query<{ payment_ref: string }>(
    `select o.payment_ref from offers o join interests i on i.id = o.interest_id join contacts c on c.id = i.contact_id
      where c.wa_id = $1 order by o.sent_at desc limit 1`,
    [nums[idx]],
  );
  console.log(`   ${at()}  ${buyers[idx][0].split(' ')[0]} pays ${money(price)} through the payment link`);
  await handlePayment(ctx, { reference: o.payment_ref, amountMinor: price }, now);
};

step(`${buyers[0][0].split(' ')[0]} pays after 18 minutes. ${buyers[1][0].split(' ')[0]} does not answer.`);
minutes(18);
await pay(0);

step(`12:01: ${buyers[1][0].split(' ')[0]}'s hold lapses and passes to the next person in line`);
now = new Date(start.getTime() + 121 * 60_000);
await tick(ctx, now);
minutes(25);
await pay(3);

step('Result');
const [spend] = await db.query<{ n: number; micros: number }>(`select count(*)::int as n, sum(cost_usd_micros)::int as micros from messages where direction = 'out'`);
const [{ stock }] = await db.query<{ stock: number }>('select stock from products where id = $1', [brown.id]);
console.log(`   2 of 2 sold for ${money(2 * price)}. ${spend.n} messages, about ${formatUsdMicros(spend.micros)} in Meta fees (estimate). Stock left: ${stock}.`);
await db.close();
