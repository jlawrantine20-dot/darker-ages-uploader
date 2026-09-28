import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { isBargain } from '../src/domain/intent.js';
import { formatMoney } from '../src/domain/money.js';
import { handleInbound } from '../src/services/inbound.js';
import { T0, at, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});
const fcfa = (n: number) => formatMoney(n, 'XAF', 'fr', 'CM');
const last = () => env.channel.sent.at(-1);
const days = (d: number) => at(d * 24 * 60);

async function shop() {
  env = await setup({ language: 'fr' });
  let now = T0;
  const app = createApp(env.ctx, () => now);
  const call = async (method: string, path: string, body?: object) => {
    const r = await app.request(path, { method, headers: { 'Content-Type': 'application/json', 'X-Lang': 'fr' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { call, setNow: (d: Date) => (now = d) };
}
/** A customer asks, bargains and says yes to a price alert. */
async function watcher(i: number, when = T0) {
  await handleInbound(env.ctx, inbound(wa(i), 'vous avez le claw clip ponytail noir ?', when, `Client${i} Test`));
  const r = await handleInbound(env.ctx, inbound(wa(i), "c'est trop cher, dernier prix ?", new Date(when.getTime() + 60_000)));
  expect(r.action).toBe('price_alert_offered');
  expect((await handleInbound(env.ctx, inbound(wa(i), 'oui', new Date(when.getTime() + 120_000)))).action).toBe('price_alert_joined');
}

describe('Bargaining', () => {
  it('recognises bargaining in French, English and Pidgin', () => {
    for (const t of ["c'est trop cher", 'dernier prix ?', 'vous pouvez faire une réduction ?', 'last price?', 'any discount?', 'abeg reduce am', 'too expensive o']) expect(isBargain(t), t).toBe(true);
    for (const t of ['vous avez le noir ?', "c'est combien ?", 'how much?']) expect(isBargain(t), t).toBe(false);
  });

  it('offers a price alert and records the yes as consent', async () => {
    await shop();
    await watcher(1);
    expect(env.channel.sent.at(-2)?.body).toBe(`Bonjour Client1 ! Le prix du modèle 12" Claw Clip Ponytail noir est fixe pour le moment (${fcfa(15000)}). Voulez-vous que nous vous prévenions ici s'il baisse ? Répondez simplement OUI. (Répondez STOP à tout moment pour ne plus recevoir de messages.)`);
    expect(last()?.body).toBe("C'est noté ! Nous vous préviendrons ici si le prix du modèle 12\" Claw Clip Ponytail noir baisse. Pour ne plus recevoir de messages, répondez STOP.");
    const [k] = await env.db.query<{ purpose: string; quote: string }>(`select purpose, quote from consents`);
    expect(k).toMatchObject({ purpose: 'price_alert', quote: 'oui' });
  });
});

describe('Price-drop alerts', () => {
  it('tells watchers when the price drops, with the real old price, and a yes orders at the new price', async () => {
    const { call, setNow } = await shop();
    await watcher(1);
    setNow(at(30));
    const patched = await call('PATCH', `/api/products/${env.black}`, { price: 12000 });
    expect(patched.body.priceDrop).toMatchObject({ fromMinor: 15000, watchers: 1, inStock: true });
    expect((await call('POST', `/api/products/${env.black}/price-drop`)).body).toEqual({ sent: 1 });
    expect(last()).toMatchObject({ kind: 'text', body: `Bonjour Client1, bonne nouvelle : le modèle 12" Claw Clip Ponytail noir passe à ${fcfa(12000)} (au lieu de ${fcfa(15000)}). Répondez OUI pour le commander. (Répondez STOP pour ne plus recevoir de messages.)` });
    // Never twice for the same price.
    expect((await call('POST', `/api/products/${env.black}/price-drop`)).body).toEqual({ sent: 0 });
    expect((await handleInbound(env.ctx, inbound(wa(1), 'oui', at(40)))).action).toBe('ordered');
    const [o] = await env.db.query<{ amount_minor: string }>('select amount_minor from orders');
    expect(Number(o.amount_minor)).toBe(12000);
  });

  it('uses the approved template after the 24-hour window', async () => {
    const { call, setNow } = await shop();
    await watcher(2);
    setNow(days(3));
    await call('PATCH', `/api/products/${env.black}`, { price: 13000 });
    expect((await call('POST', `/api/products/${env.black}/price-drop`)).body).toEqual({ sent: 1 });
    expect(last()).toMatchObject({ kind: 'template', template: { name: 'price_drop_v1', language: 'fr', params: ['Client2', '12" Claw Clip Ponytail noir', fcfa(13000), fcfa(15000)] } });
  });

  it('skips people who bought it or said STOP', async () => {
    const { call, setNow } = await shop();
    await watcher(3);
    await watcher(4);
    await handleInbound(env.ctx, inbound(wa(4), 'STOP', at(10)));
    // Customer 3 buys at the full price.
    await handleInbound(env.ctx, inbound(wa(3), 'je le prends', at(11)));
    const [o] = await env.db.query<{ payment_ref: string }>('select payment_ref from orders');
    await createApp(env.ctx, () => at(12)).request(`/dev/pay/${o.payment_ref}`, { method: 'POST' });
    setNow(at(30));
    const patched = await call('PATCH', `/api/products/${env.black}`, { price: 12000 });
    expect(patched.body.priceDrop).toBeUndefined();
    expect((await call('POST', `/api/products/${env.black}/price-drop`)).body).toEqual({ sent: 0 });
  });

  it('refuses to announce a cut that did not happen, or on a sold-out item', async () => {
    const { call } = await shop();
    await watcher(5);
    expect((await call('POST', `/api/products/${env.black}/price-drop`)).body.error).toBe("Le nouveau prix doit être inférieur à l'ancien.");
    await call('PATCH', `/api/products/${env.black}`, { price: 12000, stock: 0 });
    expect((await call('POST', `/api/products/${env.black}/price-drop`)).body.error).toContain('en rupture');
    // Raising the price again cancels the cut.
    await call('PATCH', `/api/products/${env.black}`, { price: 16000, stock: 6 });
    expect((await call('POST', `/api/products/${env.black}/price-drop`)).status).toBe(400);
  });
});
