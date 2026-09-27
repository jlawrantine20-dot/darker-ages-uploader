// Dev check: runs dist/remote.js the way Supabase does (libraries injected) against a local
// Postgres, fires 20 requests at once, and reports which database user served them and how
// many connections were open during and after. FN_PW is the seller_app_fn password.
import postgres from 'postgres';
import * as hono from 'hono';
import * as honoCors from 'hono/cors';
import * as phone from 'libphonenumber-js';
import * as nodeBuffer from 'node:buffer';
import * as nodeCrypto from 'node:crypto';
const DB = process.env.DB ?? 'postgres://postgres:pw@localhost:5432/nkg';
globalThis.Deno = { env: { toObject: () => ({ SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_DB_URL: DB, SUPABASE_SERVICE_ROLE_KEY: 'svc' }) }, serve: (h) => { globalThis.__h = h; } };
globalThis.__nkg = { deps: { 'npm:postgres@3.4.9': postgres, hono: { ...hono }, 'hono/cors': { ...honoCors }, 'libphonenumber-js': { ...phone }, 'node:buffer': { ...nodeBuffer }, 'node:crypto': { ...nodeCrypto } }, defaults: { APP_URL: 'https://app.example/web', DB_USER: 'seller_app_fn', DB_PASSWORD: process.env.FN_PW } };
await import('./dist/remote.js');
const admin = postgres(DB, { max: 1 });
const conns = async (u) => (await admin`select count(*)::int as n from pg_stat_activity where usename = ${u}`)[0].n;
let token;
const call = async (method, path, body) => {
  const r = await globalThis.__h(new Request('https://proj.supabase.co/seller-app' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) }));
  return { status: r.status, body: await r.json().catch(() => null) };
};
const number = '6743734' + String(10 + Math.floor(Math.random() * 90));
const s = await call('POST', '/auth/start', { phone: number, country: 'CM' });
token = (await call('POST', '/auth/verify', { phone: number, country: 'CM', code: s.body.devCode })).body.token;
const shop = await call('POST', '/api/sellers', { name: 'Conn Check', waPhoneNumberId: 'cc-' + Date.now(), country: 'CM' });
const burst = await Promise.all(Array.from({ length: 20 }, () => call('GET', '/api/chats?sellerId=' + shop.body.id)));
const during = { capped: await conns('seller_app_fn'), other: await conns('postgres') - 1 };
await new Promise((r) => setTimeout(r, 3500));
console.log(JSON.stringify({ burstOk: burst.every((b) => b.status === 200), during, cappedAfter3s: await conns('seller_app_fn') }));
process.exit(0);
