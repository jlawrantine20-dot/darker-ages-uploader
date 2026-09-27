// Mimics the deployed entry under Node: inject the same libraries, then load remote.js.
import postgres from 'postgres';
import * as hono from 'hono';
import * as honoCors from 'hono/cors';
import * as phone from 'libphonenumber-js';
import * as nodeBuffer from 'node:buffer';
import * as nodeCrypto from 'node:crypto';
const esm = (ns) => ({ ...ns });
globalThis.Deno = { env: { toObject: () => ({ SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_DB_URL: 'postgres://postgres:pw@localhost:5432/nkg', SUPABASE_SERVICE_ROLE_KEY: 'svc' }) }, serve: (h) => { globalThis.__h = h; } };
globalThis.__nkg = { deps: { 'npm:postgres@3.4.9': postgres, hono: esm(hono), 'hono/cors': esm(honoCors), 'libphonenumber-js': esm(phone), 'node:buffer': esm(nodeBuffer), 'node:crypto': esm(nodeCrypto) }, defaults: { APP_URL: 'https://app.example/web' } };
await import('./dist/remote.js');
let token;
const call = async (method, path, body) => {
  const r = await globalThis.__h(new Request('https://proj.supabase.co/seller-app' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) }));
  return { status: r.status, location: r.headers.get('location'), body: await r.json().catch(() => null) };
};
const s = await call('POST', '/auth/start', { phone: '6 77 12 34 58', country: 'CM' });
token = (await call('POST', '/auth/verify', { phone: '677123458', country: 'CM', code: s.body.devCode })).body.token;
const shop = await call('POST', '/api/sellers', { name: 'Remote Check', waPhoneNumberId: 'rc-' + Date.now(), country: 'CM' });
const p = await call('POST', '/api/products', { sellerId: shop.body.id, name: 'Claw Clip', variant: 'Noir / Black', price: 15000 });
await call('POST', '/dev/inbound', { sellerId: shop.body.id, from: '699000010', name: 'Paul', text: 'claw clip noir dispo ?' });
const j = await call('POST', '/dev/inbound', { sellerId: shop.body.id, from: '699000010', text: "d'accord" });
const r = await call('POST', `/api/products/${p.body.id}/restocks`, { units: 1, mode: 'hold', holdMinutes: 5 });
const det = await call('GET', `/api/restocks/${r.body.restockId}`);
const tap = await call('GET', `/pay/${det.body.offers[0].payment_ref}`);
const missing = await call('GET', '/pay/nkg_missing');
console.log(JSON.stringify({ shop: shop.status, joined: j.body.action, restock: r.status, offered: r.body.offered, tap: tap.location, ended: missing.status + ' ' + (missing.location ?? '').slice(0, 60) }));
process.exit(0);
