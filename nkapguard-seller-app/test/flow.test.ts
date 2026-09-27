import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney } from '../src/domain/money.js';
import { handleInbound } from '../src/services/inbound.js';
import { dispatch } from '../src/services/outbound.js';
import { handlePayment, startRestock, tick } from '../src/services/restock.js';
import { T0, at, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});

const pay = (ref: string, when: Date, amountMinor = env.clipPrice) => handlePayment(env.ctx, { reference: ref, amountMinor }, when);

/** Put customers 1..n on the brown clip waitlist, in order. */
async function fillWaitlist(n: number) {
  for (let i = 1; i <= n; i++) {
    await handleInbound(env.ctx, inbound(wa(i), 'do you have the brown claw clip ponytail?', at(-600 + i * 2), `Buyer${i} Test`));
    const r = await handleInbound(env.ctx, inbound(wa(i), 'yes', at(-599 + i * 2)));
    expect(r.action).toBe('joined');
  }
  env.channel.sent.length = 0;
}

const refFor = async (waId: string) =>
  (await env.db.query<{ payment_ref: string }>(
    `select o.payment_ref from offers o join interests i on i.id = o.interest_id join contacts c on c.id = i.contact_id
      where c.wa_id = $1 order by o.sent_at desc limit 1`,
    [waId],
  ))[0].payment_ref;

const offerStatuses = async () =>
  Object.fromEntries(
    (await env.db.query<{ wa_id: string; status: string }>(
      `select c.wa_id, o.status from offers o join interests i on i.id = o.interest_id join contacts c on c.id = i.contact_id`,
    )).map((r) => [r.wa_id, r.status]),
  );

const stock = async (id: string) => (await env.db.query<{ stock: number }>('select stock from products where id = $1', [id]))[0].stock;

describe('chat to waitlist', () => {
  it('offers an alert for a sold-out item, then records consent on YES', async () => {
    env = await setup();
    const a = await handleInbound(env.ctx, inbound(wa(1), 'Hi! Do you have the 12 inch claw clip ponytail in brown?', T0, 'Amaka Obi'));
    expect(a.action).toBe('offered');
    expect(env.channel.sent.at(-1)?.body).toContain('Hi Amaka, the brown 12" Claw Clip Ponytail is sold out');

    const b = await handleInbound(env.ctx, inbound(wa(1), 'Yes please', at(1)));
    expect(b.action).toBe('joined');
    expect(env.channel.sent.at(-1)?.body).toContain("You're on the list! You're #1 for the brown");

    const [consent] = await env.db.query<{ quote: string; purpose: string; revoked_at: Date | null }>('select * from consents');
    expect(consent).toMatchObject({ quote: 'Yes please', purpose: 'restock_alert', revoked_at: null });
  });

  it('talks to customers in French for a French-language shop', async () => {
    env = await setup({ language: 'fr' });
    const a = await handleInbound(env.ctx, inbound(wa(1), 'Bonsoir, vous avez encore la claw clip ponytail marron ?', T0, 'Nadège Mballa'));
    expect(a.action).toBe('offered');
    expect(env.channel.sent.at(-1)?.body).toBe(
      'Bonjour Nadège ! Le modèle 12" Claw Clip Ponytail marron est momentanément en rupture de stock. Souhaitez-vous que nous vous prévenions ici dès son retour ? Répondez simplement OUI. (Répondez STOP à tout moment pour ne plus recevoir de messages.)',
    );
    expect((await handleInbound(env.ctx, inbound(wa(1), "Oui d'accord", at(1)))).action).toBe('joined');
    expect(env.channel.sent.at(-1)?.body).toContain("Vous êtes n°1 sur la liste d'attente");

    await handleInbound(env.ctx, inbound(wa(2), 'la claw clip ponytail noir est dispo ?', at(2), 'Paul'));
    expect(env.channel.sent.at(-1)?.body).toBe(`Bonjour Paul ! Oui, le modèle 12" Claw Clip Ponytail noir est disponible au prix de ${formatMoney(15000, 'XAF', 'fr', 'CM')}. Il nous en reste 6.`);
  });

  it('answers each customer in the language they write in', async () => {
    env = await setup({ language: 'fr+en' });
    // French in, French only out.
    await handleInbound(env.ctx, inbound(wa(1), 'vous avez la claw clip ponytail brown ?', T0, 'Nadège'));
    expect(env.channel.sent.at(-1)!.body).toMatch(/^Bonjour Nadège ! Le modèle 12" Claw Clip Ponytail brown est momentanément en rupture de stock/);
    expect(env.channel.sent.at(-1)!.body).not.toContain('Hi Nadège');
    expect((await handleInbound(env.ctx, inbound(wa(1), 'oui', at(1)))).action).toBe('joined');
    expect(env.channel.sent.at(-1)?.body).toMatch(/^C'est noté ! Vous êtes n°1 /);
    expect(env.channel.sent.at(-1)?.body).not.toContain('Done.');

    // English (or Pidgin) in, English only out, even though the shop is set to both.
    await handleInbound(env.ctx, inbound(wa(2), 'una get the brown claw clip ponytail?', at(2), 'Paul'));
    expect(env.channel.sent.at(-1)?.body).toMatch(/^Hi Paul, the brown 12" Claw Clip Ponytail is sold out/);
    expect((await handleInbound(env.ctx, inbound(wa(2), 'yes', at(3)))).action).toBe('joined');
    expect(env.channel.sent.at(-1)?.body).toMatch(/^You're on the list! You're #2 /);

    // No clear language: the shop's setting (French then English) is used.
    await handleInbound(env.ctx, inbound(wa(3), 'claw clip ponytail brown?', at(4), 'Ali'));
    const [french, english] = env.channel.sent.at(-1)!.body!.split('\n\n');
    expect(french).toContain('Bonjour Ali');
    expect(english).toContain('Hi Ali');
  });

  it('remembers a customer language across short replies', async () => {
    env = await setup({ language: 'en' });
    await handleInbound(env.ctx, inbound(wa(1), 'Bonjour, vous avez le claw clip ponytail brown ?', T0, 'Nadège'));
    expect(env.channel.sent.at(-1)!.body).toMatch(/^Bonjour Nadège/);
    // "ok" says nothing about language; the reply stays in French.
    expect((await handleInbound(env.ctx, inbound(wa(1), 'ok', at(1)))).action).toBe('joined');
    expect(env.channel.sent.at(-1)?.body).toMatch(/^C'est noté/);
  });

  it('asks which colour when a product has several, then reads the short answer', async () => {
    env = await setup({ language: 'fr' });
    const a = await handleInbound(env.ctx, inbound(wa(1), 'Bonjour, vous avez le claw clip ponytail ?', T0, 'Nadège'));
    expect(a.action).toBe('asked_variant');
    expect(env.channel.sent.at(-1)?.body).toBe('Bonjour Nadège ! Le modèle 12" Claw Clip Ponytail existe en marron (en rupture) ou noir (6 en stock). Lequel souhaitez-vous ?');
    expect((await handleInbound(env.ctx, inbound(wa(1), 'le noir', at(1)))).action).toBe('in_stock');
    expect(env.channel.sent.at(-1)?.body).toMatch(/^Bonjour Nadège ! Oui, le modèle 12" Claw Clip Ponytail noir est disponible/);

    // English, picking the sold-out one, then joining the list.
    await handleInbound(env.ctx, inbound(wa(2), 'do you have the claw clip ponytail?', at(2), 'Tunde'));
    expect(env.channel.sent.at(-1)?.body).toBe('Hi Tunde, the 12" Claw Clip Ponytail comes in marron (sold out) or noir (6 in stock). Which one would you like?');
    expect((await handleInbound(env.ctx, inbound(wa(2), 'marron', at(3)))).action).toBe('offered');
    expect((await handleInbound(env.ctx, inbound(wa(2), 'yes', at(4)))).action).toBe('joined');

    // A colour on its own, with no question before it, is left for the seller.
    expect((await handleInbound(env.ctx, inbound(wa(3), 'noir', at(5)))).action).toBe('unhandled');
  });

  it('says in stock with the real count and the shop currency', async () => {
    env = await setup();
    const r = await handleInbound(env.ctx, inbound(wa(1), 'una get the jet black claw clip?', T0, 'Tunde'));
    expect(r.action).toBe('in_stock');
    expect(env.channel.sent.at(-1)?.body).toBe('Hi Tunde, yes, we have the jet black 12" Claw Clip Ponytail in stock at FCFA\u00a015,000. We\'ve got 6 left.');
  });

  it('uses the right currency for a shop in another country', async () => {
    env = await setup({ country: 'NG', clipPrice: 18500 });
    await handleInbound(env.ctx, inbound('2348035552190', 'una get the jet black claw clip?', T0, 'Tunde'));
    expect(env.channel.sent.at(-1)?.body).toContain('in stock at ₦18,500');
  });

  it('does not treat a hedged reply as consent, or a yes after the prompt has lapsed', async () => {
    env = await setup();
    await handleInbound(env.ctx, inbound(wa(1), 'is the wine satin bonnet available?', T0));
    expect((await handleInbound(env.ctx, inbound(wa(1), 'yes but how much?', at(1)))).action).toBe('unhandled');
    expect((await handleInbound(env.ctx, inbound(wa(1), 'yes', at(60 * 25)))).action).toBe('unhandled');
    expect(await env.db.query('select * from consents')).toHaveLength(0);
  });

  it('does not add someone twice', async () => {
    env = await setup();
    await fillWaitlist(1);
    await handleInbound(env.ctx, inbound(wa(1), 'do you have the brown claw clip ponytail?', at(5)));
    const r = await handleInbound(env.ctx, inbound(wa(1), 'yes', at(6)));
    expect(r.action).toBe('already_waiting');
    expect(env.channel.sent.at(-1)?.body).toContain('already on the list');
  });

  it('keeps people who join in the same second in arrival order', async () => {
    env = await setup();
    for (let i = 1; i <= 5; i++) {
      await handleInbound(env.ctx, inbound(wa(i), 'una get the brown claw clip?', T0, `P${i}`));
      await handleInbound(env.ctx, inbound(wa(i), 'yes', T0));
      expect(env.channel.sent.at(-1)?.body).toContain(`You're #${i} for the`);
    }
  });

  it('STOP revokes consent and removes them from every list', async () => {
    env = await setup();
    await fillWaitlist(2);
    expect((await handleInbound(env.ctx, inbound(wa(1), 'STOP', at(0)))).action).toBe('stopped');
    const s = await startRestock(env.ctx, { productId: env.brown, units: 1, mode: 'hold' }, at(10));
    expect(env.channel.sent.filter((m) => m.kind === 'template').map((m) => m.to)).toEqual([wa(2)]);
    expect(s.waiting).toBe(1);
  });

  it('ignores messages for numbers that belong to no seller', async () => {
    env = await setup();
    const r = await handleInbound(env.ctx, { ...inbound(wa(1), 'hello', T0), phoneNumberId: 'nope' });
    expect(r.action).toBe('unknown_seller');
  });
});

describe('restock in hold mode', () => {
  it('holds one unit per person and passes expired holds down the line', async () => {
    env = await setup();
    await fillWaitlist(6);
    const s = await startRestock(env.ctx, { productId: env.brown, units: 3, mode: 'hold', holdMinutes: 120 }, T0);
    expect(s.offered).toBe(3);
    const alerts = env.channel.sent.filter((m) => m.kind === 'template');
    expect(alerts.map((m) => m.to)).toEqual([wa(1), wa(2), wa(3)]);
    // Live numbers only: 3 units, 6 waiting, hold ends 12:00 PM in Douala.
    expect(alerts[0].template).toMatchObject({
      name: 'restock_hold_v1',
      language: 'en',
      params: ['Buyer1', 'brown 12" Claw Clip Ponytail', '3', '6', '12:00 PM', 'FCFA\u00a015,000', expect.stringMatching(/^https:\/\/nkapguard\.test\/pay\/nkg_/)],
    });

    expect((await pay(await refFor(wa(1)), at(18))).outcome).toBe('paid');
    await tick(env.ctx, at(60));
    expect(await offerStatuses()).toMatchObject({ [wa(1)]: 'paid', [wa(2)]: 'held', [wa(3)]: 'held' });

    // Holds for 2 and 3 lapse; the two freed units go to 4 and 5, not 6.
    env.channel.sent.length = 0;
    await tick(env.ctx, at(121));
    expect(await offerStatuses()).toMatchObject({ [wa(2)]: 'expired', [wa(3)]: 'expired', [wa(4)]: 'held', [wa(5)]: 'held' });
    expect(env.channel.sent.map((m) => m.to)).toEqual([wa(4), wa(5)]);

    await pay(await refFor(wa(4)), at(130));
    await pay(await refFor(wa(5)), at(140));
    expect(await stock(env.brown)).toBe(0);
    const [r] = await env.db.query<{ closed_at: Date | null }>('select closed_at from restocks');
    expect(r.closed_at).not.toBeNull();
  });

  it('sends French templates for a French-language shop', async () => {
    env = await setup({ language: 'fr' });
    await handleInbound(env.ctx, inbound(wa(1), 'vous avez la claw clip ponytail marron ?', at(-10), 'Nadège'));
    await handleInbound(env.ctx, inbound(wa(1), 'oui', at(-9)));
    env.channel.sent.length = 0;
    await startRestock(env.ctx, { productId: env.brown, units: 2, mode: 'hold', holdMinutes: 90 }, T0);
    expect(env.channel.sent[0].template).toMatchObject({
      language: 'fr',
      params: ['Nadège', '12" Claw Clip Ponytail marron', '2', '1', '11:30', formatMoney(15000, 'XAF', 'fr', 'CM'), expect.any(String)],
    });
  });

  it('sends restock alerts in each customer own language', async () => {
    env = await setup({ language: 'fr+en' });
    await handleInbound(env.ctx, inbound(wa(1), 'vous avez la claw clip ponytail brown ?', at(-10), 'Nadège'));
    await handleInbound(env.ctx, inbound(wa(1), 'oui', at(-9)));
    await handleInbound(env.ctx, inbound(wa(2), 'una get the brown claw clip ponytail?', at(-8), 'Paul'));
    await handleInbound(env.ctx, inbound(wa(2), 'yes', at(-7)));
    env.channel.sent.length = 0;
    await startRestock(env.ctx, { productId: env.brown, units: 2, mode: 'hold', holdMinutes: 90 }, T0);
    const [toNadege, toPaul] = env.channel.sent.map((m) => m.template!);
    expect(toNadege).toMatchObject({ name: 'restock_hold_v1', language: 'fr' });
    expect(toNadege.params[5]).toBe(formatMoney(15000, 'XAF', 'fr', 'CM'));
    expect(toPaul).toMatchObject({ name: 'restock_hold_v1', language: 'en' });
    expect(toPaul.params[5]).toBe('FCFA\u00a015,000');
  });

  it('sends bilingual templates with French then English slot values', async () => {
    env = await setup({ language: 'fr+en' });
    // No clear language in either message, so the shop's bilingual setting applies.
    await handleInbound(env.ctx, inbound(wa(1), 'claw clip ponytail brown?', at(-10), 'Nadège'));
    await handleInbound(env.ctx, inbound(wa(1), 'ok', at(-9)));
    env.channel.sent.length = 0;
    await startRestock(env.ctx, { productId: env.brown, units: 2, mode: 'hold', holdMinutes: 90 }, T0);
    const t = env.channel.sent[0].template!;
    expect(t).toMatchObject({ name: 'restock_hold_v1_bilingual', language: 'fr' });
    expect(t.params.slice(0, 7)).toEqual(['Nadège', '12" Claw Clip Ponytail brown', '2', '1', '11:30', formatMoney(15000, 'XAF', 'fr', 'CM'), expect.any(String)]);
    expect(t.params.slice(7)).toEqual(['Nadège', 'brown 12" Claw Clip Ponytail', '2', '1', '11:30 AM', 'FCFA\u00a015,000', t.params[6]]);
    const [log] = await env.db.query<{ template: string; body: string }>(`select template, body from messages where kind = 'template'`);
    expect(log.template).toBe('restock_hold_v1_bilingual');
    expect(log.body).toContain('Arrivage : 2.');
    expect(log.body).toContain('Units in: 2.');
  });

  it('keeps unclaimed units as free stock once the line runs out', async () => {
    env = await setup();
    await fillWaitlist(1);
    await startRestock(env.ctx, { productId: env.brown, units: 3, mode: 'hold' }, T0);
    await tick(env.ctx, at(200));
    expect(await stock(env.brown)).toBe(3);
    const [r] = await env.db.query<{ closed_at: Date | null }>('select closed_at from restocks');
    expect(r.closed_at).not.toBeNull();
  });

  it('ignores duplicate, short and wrong-currency payments', async () => {
    env = await setup();
    await fillWaitlist(1);
    await startRestock(env.ctx, { productId: env.brown, units: 1, mode: 'hold' }, T0);
    const ref = await refFor(wa(1));
    expect((await pay(ref, at(5), 1000)).outcome).toBe('underpaid');
    expect((await handlePayment(env.ctx, { reference: ref, amountMinor: env.clipPrice, currency: 'USD' }, at(5))).outcome).toBe('underpaid');
    expect((await pay(ref, at(6))).outcome).toBe('paid');
    expect((await pay(ref, at(7))).outcome).toBe('duplicate');
    expect((await pay('nkg_nope', at(8))).outcome).toBe('unknown');
    expect(await stock(env.brown)).toBe(0);
  });

  it('refuses a restock with bad input', async () => {
    env = await setup();
    await expect(startRestock(env.ctx, { productId: env.brown, units: 0, mode: 'hold' }, T0)).rejects.toThrow('units');
    await expect(startRestock(env.ctx, { productId: env.brown, units: 2, mode: 'lottery' as 'hold' }, T0)).rejects.toThrow('mode');
  });
});

describe('restock in race mode', () => {
  it('first payers win, the rest get a sold-out note and keep their place, late payers are flagged for refund', async () => {
    env = await setup();
    await fillWaitlist(6);
    const s = await startRestock(env.ctx, { productId: env.brown, units: 2, mode: 'race', perUnit: 2 }, T0);
    expect(s.offered).toBe(4);
    expect(env.channel.sent[0].template?.params).toEqual(['Buyer1', 'brown 12" Claw Clip Ponytail', '2', '4', 'FCFA\u00a015,000', expect.any(String)]);

    await pay(await refFor(wa(3)), at(10));
    env.channel.sent.length = 0;
    await pay(await refFor(wa(1)), at(12));
    expect(env.channel.sent.filter((m) => m.kind === 'template').map((m) => m.to).sort()).toEqual([wa(2), wa(4)]);
    expect(env.channel.sent.find((m) => m.to === wa(2))?.template?.name).toBe('restock_sold_out_v1');

    expect((await pay(await refFor(wa(2)), at(13))).outcome).toBe('refund_due');
    const [{ n }] = await env.db.query<{ n: number }>(`select count(*)::int as n from offers where refund_due`);
    expect(n).toBe(1);
    expect(await stock(env.brown)).toBe(0);

    const [{ waiting }] = await env.db.query<{ waiting: number }>(`select count(*)::int as waiting from interests where status = 'waiting'`);
    expect(waiting).toBe(4);
  });
});

describe('sending rules', () => {
  it('confirms a payment with a template when the chat went quiet days ago', async () => {
    env = await setup();
    await fillWaitlist(1);
    const later = at(60 * 24 * 4);
    await startRestock(env.ctx, { productId: env.brown, units: 1, mode: 'hold' }, later);
    env.channel.sent.length = 0;
    await pay(await refFor(wa(1)), new Date(later.getTime() + 600_000));
    expect(env.channel.sent).toEqual([
      expect.objectContaining({ kind: 'template', template: expect.objectContaining({ name: 'payment_received_v1', params: ['brown 12" Claw Clip Ponytail'] }) }),
    ]);
  });

  it('refuses free-form text outside the 24h window and logs estimated USD fees for the shop country', async () => {
    env = await setup();
    await fillWaitlist(1);
    const [c] = await env.db.query<{ id: string; seller_id: string; last_inbound_at: Date }>('select * from contacts');
    const base = { sellerId: c.seller_id, from: '1098765432', contactId: c.id, to: wa(1), lastInboundAt: c.last_inbound_at, country: 'CM', language: 'en' };
    const [late] = await dispatch(env.ctx, [{ ...base, kind: 'text', body: 'Still interested?' }], at(60 * 30));
    expect(late.status).toBe('window_closed');

    await startRestock(env.ctx, { productId: env.brown, units: 1, mode: 'hold' }, at(60 * 30));
    const spend = await env.db.query<{ category: string; cost: string }>(
      `select category, sum(cost_usd_micros)::text as cost from messages where direction = 'out' group by category order by category`,
    );
    expect(spend).toEqual([
      { category: 'marketing', cost: '22500' },
      { category: 'service', cost: '0' },
    ]);
  });
});
