import { afterEach, describe, expect, it } from 'vitest';
import { handleInbound } from '../src/services/inbound.js';
import { dispatch } from '../src/services/outbound.js';
import { handlePayment, startRestock, tick } from '../src/services/restock.js';
import { T0, at, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});

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
    expect(env.channel.sent.at(-1)?.body).toContain("You're #1 on the list");

    const [consent] = await env.db.query<{ quote: string; purpose: string; revoked_at: Date | null }>('select * from consents');
    expect(consent).toMatchObject({ quote: 'Yes please', purpose: 'restock_alert', revoked_at: null });
  });

  it('says in stock with the real count when units are free', async () => {
    env = await setup();
    const r = await handleInbound(env.ctx, inbound(wa(1), 'una get the jet black claw clip?', T0, 'Tunde'));
    expect(r.action).toBe('in_stock');
    expect(env.channel.sent.at(-1)?.body).toBe('Hi Tunde, yes, the jet black 12" Claw Clip Ponytail is available at ₦18,500. We have 6 left.');
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

  it('STOP revokes consent and removes them from every list', async () => {
    env = await setup();
    await fillWaitlist(2);
    const r = await handleInbound(env.ctx, inbound(wa(1), 'STOP', at(0)));
    expect(r.action).toBe('stopped');
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
    // Live numbers only: 3 units, 6 waiting, hold ends 12:00 PM Lagos time.
    expect(alerts[0].template).toMatchObject({ name: 'restock_hold_v1', params: ['Buyer1', 'brown 12" Claw Clip Ponytail', '3', '6', '12:00 PM', '₦18,500', expect.stringMatching(/^https:\/\/oja\.test\/pay\/oja_/)] });

    expect((await handlePayment(env.ctx, { reference: await refFor(wa(1)), amountKobo: 1850000 }, at(18))).outcome).toBe('paid');
    await tick(env.ctx, at(60));
    expect(await offerStatuses()).toMatchObject({ [wa(1)]: 'paid', [wa(2)]: 'held', [wa(3)]: 'held' });

    // Holds for 2 and 3 lapse; the two freed units go to 4 and 5, not 6.
    env.channel.sent.length = 0;
    await tick(env.ctx, at(121));
    expect(await offerStatuses()).toMatchObject({ [wa(2)]: 'expired', [wa(3)]: 'expired', [wa(4)]: 'held', [wa(5)]: 'held' });
    expect(env.channel.sent.map((m) => m.to)).toEqual([wa(4), wa(5)]);

    await handlePayment(env.ctx, { reference: await refFor(wa(4)), amountKobo: 1850000 }, at(130));
    await handlePayment(env.ctx, { reference: await refFor(wa(5)), amountKobo: 1850000 }, at(140));
    expect(await stock(env.brown)).toBe(0);
    const [r] = await env.db.query<{ closed_at: Date | null }>('select closed_at from restocks');
    expect(r.closed_at).not.toBeNull();
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

  it('ignores duplicate and short payments', async () => {
    env = await setup();
    await fillWaitlist(1);
    await startRestock(env.ctx, { productId: env.brown, units: 1, mode: 'hold' }, T0);
    const ref = await refFor(wa(1));
    expect((await handlePayment(env.ctx, { reference: ref, amountKobo: 100000 }, at(5))).outcome).toBe('underpaid');
    expect((await handlePayment(env.ctx, { reference: ref, amountKobo: 1850000 }, at(6))).outcome).toBe('paid');
    expect((await handlePayment(env.ctx, { reference: ref, amountKobo: 1850000 }, at(7))).outcome).toBe('duplicate');
    expect((await handlePayment(env.ctx, { reference: 'oja_nope', amountKobo: 1850000 }, at(8))).outcome).toBe('unknown');
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
    expect(env.channel.sent[0].template?.params).toEqual(['Buyer1', 'brown 12" Claw Clip Ponytail', '2', '4', '₦18,500', expect.any(String)]);

    await handlePayment(env.ctx, { reference: await refFor(wa(3)), amountKobo: 1850000 }, at(10));
    env.channel.sent.length = 0;
    await handlePayment(env.ctx, { reference: await refFor(wa(1)), amountKobo: 1850000 }, at(12));
    expect(env.channel.sent.filter((m) => m.kind === 'template').map((m) => m.to).sort()).toEqual([wa(2), wa(4)]);
    expect(env.channel.sent.find((m) => m.to === wa(2))?.template?.name).toBe('restock_sold_out_v1');

    // Customer 2 pays anyway: no unit left, so it is flagged for refund.
    expect((await handlePayment(env.ctx, { reference: await refFor(wa(2)), amountKobo: 1850000 }, at(13))).outcome).toBe('refund_due');
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
    await handlePayment(env.ctx, { reference: await refFor(wa(1)), amountKobo: 1850000 }, new Date(later.getTime() + 600_000));
    expect(env.channel.sent).toEqual([
      expect.objectContaining({ kind: 'template', template: expect.objectContaining({ name: 'payment_received_v1', params: ['brown 12" Claw Clip Ponytail'] }) }),
    ]);
  });

  it('refuses free-form text outside the 24h window and logs costs for what is sent', async () => {
    env = await setup();
    await fillWaitlist(1);
    const [c] = await env.db.query<{ id: string; seller_id: string; last_inbound_at: Date }>('select * from contacts');
    const base = { sellerId: c.seller_id, from: '1098765432', contactId: c.id, to: wa(1), lastInboundAt: c.last_inbound_at };
    const [late] = await dispatch(env.ctx, [{ ...base, kind: 'text', body: 'Still interested?' }], at(60 * 30));
    expect(late.status).toBe('window_closed');

    await startRestock(env.ctx, { productId: env.brown, units: 1, mode: 'hold' }, at(60 * 30));
    const spend = await env.db.query<{ category: string; cost_kobo: number }>(
      `select category, sum(cost_kobo)::int as cost_kobo from messages where direction = 'out' group by category order by category`,
    );
    expect(spend).toEqual([
      { category: 'marketing', cost_kobo: 8400 },
      { category: 'service', cost_kobo: 0 },
    ]);
  });
});
