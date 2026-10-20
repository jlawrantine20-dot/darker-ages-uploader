import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseWebhook } from '../src/channels/whatsapp.js';
import { formatMoney } from '../src/domain/money.js';
import { cleanMethods, confirmOffer, isPaymentClaim, payMode, rejectClaim, setPayMethods, shortRef } from '../src/services/directpay.js';
import { handleInbound } from '../src/services/inbound.js';
import { expireOrders, markOrderPaid } from '../src/services/orders.js';
import { startRestock } from '../src/services/restock.js';
import { getSeller } from '../src/services/sellers.js';
import { PHONE_ID, T0, at, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});

const last = () => env.channel.sent.at(-1)?.body ?? '';
const orders = () => env.db.query<{ id: string; payment_ref: string; status: string; claimed_at: Date | null; claim_note: string | null; expires_at: Date }>('select * from orders order by created_at');
const MOMO = { label: 'MTN MoMo', account: '6 77 12 34 56', holder: 'Nadège Mballa' };
const OM = { label: 'Orange Money', account: '6 99 88 77 66' };
const photo = (from: string, when: Date, caption?: string) => ({ ...inbound(from, caption ?? '', when), image: true });

describe('Reading "I have paid"', () => {
  it('knows a payment claim, and leaves other messages alone', () => {
    for (const t of ["j'ai payé", "C'est envoyé", 'Paiement effectué', 'PAYÉ', 'payé', "I've paid", 'paid', 'Money sent', 'Transaction ID: MP241005.1234.A56789', 'jai deja paye']) {
      expect(isPaymentClaim(t), t).toBe(true);
    }
    for (const t of ['oui', "c'est combien ?", 'vous avez le noir ?', 'je le prends', 'I will pay tomorrow', 'ok']) expect(isPaymentClaim(t), t).toBe(false);
  });
});

describe('Payment details', () => {
  it('are checked and tidied before they are saved', async () => {
    expect(cleanMethods([{ label: '  MTN  MoMo ', account: ' 677 12 34 56 ', holder: '' }])).toEqual([{ label: 'MTN MoMo', account: '677 12 34 56' }]);
    expect(() => cleanMethods([{ label: 'MTN MoMo' }])).toThrow();
    expect(() => cleanMethods(Array(6).fill(MOMO))).toThrow();
    expect(() => cleanMethods('nope')).toThrow();
  });

  it('switch a shop to direct payment, unless a gateway is connected', async () => {
    env = await setup();
    const live = { ...env.ctx, config: { ...env.ctx.config, dryRun: false } };
    expect(payMode(live, (await getSeller(env.db, env.sellerId))!)).toBe('manual');
    await setPayMethods(env.db, env.sellerId, [MOMO]);
    expect(payMode(live, (await getSeller(env.db, env.sellerId))!)).toBe('direct');
    await env.db.query(`update sellers set payment_provider = 'notchpay', payment_secret_enc = 'x' where id = $1`, [env.sellerId]);
    expect(payMode(live, (await getSeller(env.db, env.sellerId))!)).toBe('online');
  });
});

describe('Ordering with direct payment', () => {
  it('tells the customer where to pay, takes "payé", and the seller confirms', async () => {
    env = await setup({ language: 'fr' });
    await setPayMethods(env.db, env.sellerId, [MOMO, OM]);
    await handleInbound(env.ctx, inbound(wa(1), 'vous avez le claw clip ponytail noir ?', T0, 'Paul Eto'));
    const r = await handleInbound(env.ctx, inbound(wa(1), 'oui', at(1)));
    expect(r.action).toBe('ordered_direct');
    const [o] = await orders();
    const price = formatMoney(env.clipPrice, 'XAF', 'fr', 'CM');
    expect(last()).toBe(
      `Parfait, le modèle 12" Claw Clip Ponytail noir est à vous ! Nous vous le réservons jusqu'à 11:01. Pour confirmer, envoyez ${price} à :\n` +
      `• MTN MoMo : 6 77 12 34 56 (Nadège Mballa)\n• Orange Money : 6 99 88 77 66\n` +
      `Référence : ${shortRef(o.payment_ref)}. Répondez ensuite PAYÉ ici (une capture d'écran convient aussi) : nous vérifions et confirmons très vite. Tous les détails : https://nkapguard.test/pay/${o.payment_ref}`,
    );

    const claim = await handleInbound(env.ctx, inbound(wa(1), "C'est fait, j'ai payé", at(20)));
    expect(claim.action).toBe('payment_claimed');
    expect(last()).toBe('Merci ! Douala Hair Plug vérifie le paiement et vous confirme ici très vite.');
    const [claimed] = await orders();
    expect(claimed.claimed_at).not.toBeNull();
    // The hold stays while the seller checks: the usual hour passing doesn't release it.
    await expireOrders(env.ctx, at(120));
    expect((await orders())[0].status).toBe('held');

    const paid = await markOrderPaid(env.ctx, o.id, at(130));
    expect(paid.outcome).toBe('paid');
    expect(last()).toContain('Paiement bien reçu, merci !');
  });

  it('counts a screenshot or a pasted receipt as a claim, with the reference kept', async () => {
    env = await setup();
    await setPayMethods(env.db, env.sellerId, [MOMO]);
    await handleInbound(env.ctx, inbound(wa(2), 'do you have the jet black claw clip ponytail?', T0, 'Amaka Obi'));
    await handleInbound(env.ctx, inbound(wa(2), 'yes', at(1)));
    const shot = await handleInbound(env.ctx, photo(wa(2), at(10)));
    expect(shot.action).toBe('payment_claimed');
    expect((await orders())[0].claim_note).toBe('photo');
    await handleInbound(env.ctx, inbound(wa(2), 'Transaction ID: MP241005.1234.A56789', at(11)));
    expect((await orders())[0].claim_note).toBe('MP241005.1234.A56789');
    // The chat shows the photo as a photo.
    const [m] = await env.db.query<{ body: string }>(`select body from messages where direction = 'in' and body like '📷%'`);
    expect(m.body).toBe('📷');
  });

  it('asks the customer to check when the money has not arrived', async () => {
    env = await setup();
    await setPayMethods(env.db, env.sellerId, [MOMO]);
    await handleInbound(env.ctx, inbound(wa(3), 'do you have the jet black claw clip ponytail?', T0, 'Amaka Obi'));
    await handleInbound(env.ctx, inbound(wa(3), 'yes', at(1)));
    await handleInbound(env.ctx, inbound(wa(3), 'paid', at(5)));
    const [o] = await orders();
    await rejectClaim(env.ctx, 'order', o.id, at(30));
    expect(last()).toBe(`Hi Amaka, we haven't received your payment of ${formatMoney(env.clipPrice, 'XAF', 'en', 'CM')} for the jet black 12" Claw Clip Ponytail yet. Could you check that it went through and send us the transaction ID?`);
    expect((await orders())[0].claimed_at).toBeNull();
  });

  it('leaves a photo alone when nothing is waiting for payment', async () => {
    env = await setup();
    await setPayMethods(env.db, env.sellerId, [MOMO]);
    const sentBefore = env.channel.sent.length;
    const r = await handleInbound(env.ctx, photo(wa(4), T0));
    expect(r.action).toBe('unhandled');
    expect(env.channel.sent.length).toBe(sentBefore);
  });

  it('reads photos from the WhatsApp webhook', () => {
    const [m] = parseWebhook({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: PHONE_ID },
      messages: [{ from: wa(5), id: 'wamid.p', timestamp: String(T0.getTime() / 1000), type: 'image', image: { id: 'media1', caption: 'voilà' } }],
    } }] }] });
    expect(m).toMatchObject({ text: 'voilà', image: true });
  });
});

describe('The payment page for direct payment', () => {
  it('shows where to send the money and takes "I have paid"', async () => {
    env = await setup({ language: 'fr' });
    await setPayMethods(env.db, env.sellerId, [MOMO]);
    await handleInbound(env.ctx, inbound(wa(6), 'vous avez le claw clip ponytail noir ?', T0, 'Paul Eto'));
    await handleInbound(env.ctx, inbound(wa(6), 'oui', at(1)));
    const [o] = await orders();
    const app = createApp(env.ctx, () => at(5));
    const page = await app.request(`/pay/${o.payment_ref}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('6 77 12 34 56');
    expect(html).toContain(shortRef(o.payment_ref));
    expect(html).toContain('J&#39;ai payé');

    const res = await app.request(`/pay/${o.payment_ref}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ note: 'MP1234567890' }) });
    expect(await res.json()).toMatchObject({ outcome: 'claimed', title: 'Merci !' });
    expect((await orders())[0]).toMatchObject({ claim_note: 'MP1234567890' });
    // Once claimed, the page says it's being checked instead of asking again.
    expect(await (await app.request(`/pay/${o.payment_ref}`)).text()).toContain('le vérifie');
  });

  it('works for restock alerts too, and the seller confirms from the restock', async () => {
    env = await setup();
    await setPayMethods(env.db, env.sellerId, [MOMO]);
    await handleInbound(env.ctx, inbound(wa(7), 'do you have the brown claw clip ponytail?', T0, 'Amaka Obi'));
    await handleInbound(env.ctx, inbound(wa(7), 'yes', at(1)));
    await startRestock(env.ctx, { productId: env.brown, units: 1, mode: 'hold', holdMinutes: 60 }, at(10));
    const [offer] = await env.db.query<{ id: string; payment_ref: string }>('select id, payment_ref from offers');
    const app = createApp(env.ctx, () => at(15));
    expect(await (await app.request(`/pay/${offer.payment_ref}`)).text()).toContain('6 77 12 34 56');
    await app.request(`/pay/${offer.payment_ref}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect((await env.db.query<{ claimed_at: Date | null }>('select claimed_at from offers'))[0].claimed_at).not.toBeNull();
    const r = await confirmOffer(env.ctx, offer.id, at(40));
    expect(r.outcome).toBe('paid');
    expect(last()).toContain('Payment received, thank you!');
  });
});
