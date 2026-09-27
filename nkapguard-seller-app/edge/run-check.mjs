// Runs the exact deploy bundle under Node (npm imports mapped back) against local Postgres.
globalThis.Deno = { env: { toObject: () => ({ SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_DB_URL: 'postgres://postgres:pw@localhost:5432/nkg', SUPABASE_SERVICE_ROLE_KEY: 'svc' }) }, serve: (h) => { globalThis.__h = h; } };
await import('./dist-check.mjs');
let token;
const call = async (method, path, body) => {
  const r = await globalThis.__h(new Request('https://proj.supabase.co/seller-app' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) }));
  return { status: r.status, body: await r.json().catch(() => null) };
};
const s = await call('POST', '/auth/start', { phone: '+237 6 77 12 34 57', country: 'CM' });
token = (await call('POST', '/auth/verify', { phone: '677123457', country: 'CM', code: s.body.devCode })).body.token;
const shop = await call('POST', '/api/sellers', { name: 'Check Shop', waPhoneNumberId: 'check-' + Date.now(), country: 'CM' });
const p = await call('POST', '/api/products', { sellerId: shop.body.id, name: 'Claw Clip', variant: 'Noir / Black', price: 15000 });
await call('POST', '/dev/inbound', { sellerId: shop.body.id, from: '699000009', name: 'Paul', text: 'claw clip noir dispo ?' });
const j = await call('POST', '/dev/inbound', { sellerId: shop.body.id, from: '699000009', text: 'ok' });
const r = await call('POST', `/api/products/${p.body.id}/restocks`, { units: 1, mode: 'race' });
console.log('shop', shop.status, 'product', p.status, 'joined', j.body.action, 'restock', r.status, r.body.offered, 'sent');
process.exit(0);
