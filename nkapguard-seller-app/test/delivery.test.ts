import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { detectZone } from '../src/domain/intent.js';
import { formatMoney } from '../src/domain/money.js';
import { handleInbound } from '../src/services/inbound.js';
import { T0, at, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});
const last = () => env.channel.sent.at(-1)?.body ?? '';
const fcfa = (n: number, l: 'fr' | 'en' = 'fr') => formatMoney(n, 'XAF', l, 'CM');

async function withZones(language: 'fr' | 'en' = 'fr') {
  env = await setup({ language });
  const app = createApp(env.ctx, () => T0);
  const add = async (name: string, fee: number, aliases: string[] = []) =>
    (await app.request('/api/delivery-zones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sellerId: env.sellerId, name, fee, aliases }) })).json();
  await add('Akwa', 1000);
  await add('Bonamoussadi', 1500, ['bonamou']);
  await add('Retrait en boutique', 0, ['retrait', 'je passe']);
  return app;
}

describe('Delivery areas', () => {
  it('reads an area by its name or another spelling', () => {
    const zones = [{ id: '1', name: 'Akwa', aliases: [] }, { id: '2', name: 'Bonamoussadi', aliases: ['bonamou'] }, { id: '3', name: 'Akwa Nord', aliases: [] }];
    expect(detectZone('je suis à Bonamou', zones)?.id).toBe('2');
    expect(detectZone('Akwa nord svp', zones)?.id).toBe('3');
    expect(detectZone('à Akwa', zones)?.id).toBe('1');
    expect(detectZone('Douala', zones)).toBeNull();
  });

  it('answers what delivery costs, or lists the areas and waits for the answer', async () => {
    await withZones();
    expect((await handleInbound(env.ctx, inbound(wa(1), "La livraison à Bonamoussadi c'est combien ?", T0))).action).toBe('delivery_fee');
    expect(last()).toBe(`La livraison à Bonamoussadi coûte ${fcfa(1500)}.`);
    await handleInbound(env.ctx, inbound(wa(2), 'vous livrez ?', T0));
    expect(last()).toBe(`Nos options de livraison : Retrait en boutique (gratuit), Akwa (${fcfa(1000)}) et Bonamoussadi (${fcfa(1500)}). Laquelle vous convient ?`);
    await handleInbound(env.ctx, inbound(wa(2), 'je passe récupérer', at(1)));
    expect(last()).toBe("Retrait en boutique : c'est gratuit.");
  });

  it('asks the area during an order, then adds the fee to the payment link', async () => {
    await withZones();
    await handleInbound(env.ctx, inbound(wa(3), 'vous avez le claw clip ponytail noir ?', T0, 'Paul Eto'));
    expect((await handleInbound(env.ctx, inbound(wa(3), 'oui', at(1)))).action).toBe('asked_zone');
    expect(last()).toBe(`Parfait ! Où faut-il vous livrer ? Retrait en boutique (gratuit), Akwa (${fcfa(1000)}) ou Bonamoussadi (${fcfa(1500)}).`);
    expect((await handleInbound(env.ctx, inbound(wa(3), 'Bonamou', at(2)))).action).toBe('ordered');
    const [o] = await env.db.query<{ amount_minor: string; delivery_zone: string; delivery_fee_minor: string }>('select * from orders');
    expect(Number(o.amount_minor)).toBe(env.clipPrice + 1500);
    expect(o.delivery_zone).toBe('Bonamoussadi');
    expect(last()).toContain(`Réglez ${fcfa(16500)} (livraison à Bonamoussadi comprise) ici pour confirmer votre commande`);
    // Next time the area is remembered: no question.
    await handleInbound(env.ctx, inbound(wa(3), 'je prends aussi le bonnet satin wine', at(10)));
    expect(env.channel.sent.at(-1)?.body).not.toContain('Où faut-il');
  });

  it('answers a product question and the delivery fee in one reply', async () => {
    await withZones('en');
    await handleInbound(env.ctx, inbound(wa(4), 'Do you have the jet black claw clip ponytail? And delivery to Akwa?', T0));
    expect(last()).toBe(`Hi there, yes, we have the jet black 12" Claw Clip Ponytail in stock at ${fcfa(15000, 'en')}. We've got 6 left. To order, just reply YES. Delivery to Akwa is ${fcfa(1000, 'en')}.`);
    // The area named in the question is used for the order.
    expect((await handleInbound(env.ctx, inbound(wa(4), 'yes', at(1)))).action).toBe('ordered');
  });

  it('works for any country: Lagos areas in naira, with Nigerian wording', async () => {
    env = await setup({ country: 'NG' });
    const app = createApp(env.ctx, () => T0);
    const add = (name: string, fee: number) => app.request('/api/delivery-zones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sellerId: env.sellerId, name, fee }) });
    await add('Lekki', 2500);
    await add('Outside Lagos (waybill)', 6000);
    await handleInbound(env.ctx, inbound(wa(6), 'how much is dispatch to Lekki?', T0));
    expect(last()).toBe(`Delivery to Lekki is ${formatMoney(250000, 'NGN', 'en', 'NG')}.`);
  });

  it('orders straight away in a shop without delivery areas', async () => {
    env = await setup();
    await handleInbound(env.ctx, inbound(wa(5), 'do you have the jet black claw clip ponytail?', T0));
    expect((await handleInbound(env.ctx, inbound(wa(5), 'yes', at(1)))).action).toBe('ordered');
  });
});
