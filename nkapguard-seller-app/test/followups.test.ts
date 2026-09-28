import { afterEach, describe, expect, it } from 'vitest';
import { handleInbound } from '../src/services/inbound.js';
import { daytime, runFollowUps } from '../src/services/followups.js';
import { expireOrders } from '../src/services/orders.js';
import { T0, at, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});
const hours = (h: number) => at(h * 60);
const ask = (i: number, when = T0) => handleInbound(env.ctx, inbound(wa(i), 'do you have the jet black claw clip ponytail?', when, 'Paul Eto'));

describe('Follow-ups on quiet chats', () => {
  it('reminds once, three hours after a quiet "in stock" answer, and a YES orders', async () => {
    env = await setup();
    await ask(1);
    expect(await runFollowUps(env.ctx, hours(2.9))).toHaveLength(0);
    const sent = await runFollowUps(env.ctx, hours(3.1));
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBe('Hi Paul, still interested in the jet black 12" Claw Clip Ponytail? We\'ve got 6 left at FCFA 15,000. Just reply YES and it\'s yours.');
    // Never twice for the same item.
    expect(await runFollowUps(env.ctx, hours(6))).toHaveLength(0);
    expect((await handleInbound(env.ctx, inbound(wa(1), 'yes', hours(6.5)))).action).toBe('ordered');
  });

  it('writes in French to a French-speaking customer', async () => {
    env = await setup({ language: 'fr' });
    await handleInbound(env.ctx, inbound(wa(2), 'vous avez le claw clip ponytail noir ?', T0, 'Nadège Mballa'));
    const [r] = await runFollowUps(env.ctx, hours(3.1));
    expect(r.body).toMatch(/^Bonjour Nadège, le modèle 12" Claw Clip Ponytail noir vous intéresse toujours \? Il nous en reste 6, à 15.000.FCFA\. Répondez simplement OUI pour le commander\.$/);
  });

  it('stays quiet when the chat moved on, the seller stepped in, or the customer said STOP', async () => {
    env = await setup();
    await ask(3);
    await handleInbound(env.ctx, inbound(wa(3), 'how much is delivery to Bonamoussadi?', at(30)));
    await ask(4);
    const [c4] = await env.db.query<{ id: string }>('select id from contacts where wa_id = $1', [wa(4)]);
    await env.db.query(`insert into messages (seller_id, contact_id, direction, kind, body, created_at) values ($1, $2, 'out', 'text', 'Hello, I can deliver today', $3)`, [env.sellerId, c4.id, at(20)]);
    await handleInbound(env.ctx, inbound(wa(5), 'do you have the brown claw clip ponytail?', T0));
    await handleInbound(env.ctx, inbound(wa(5), 'yes', at(1)));
    await ask(5, at(2));
    await handleInbound(env.ctx, inbound(wa(5), 'STOP', at(3)));
    expect(await runFollowUps(env.ctx, hours(4))).toHaveLength(0);
  });

  it('never writes at night; waits for the morning while the window is still open', async () => {
    env = await setup();
    // 19:30 in Douala: three hours later is 22:30.
    const evening = new Date('2026-10-05T18:30:00Z');
    await ask(6, evening);
    expect(await runFollowUps(env.ctx, new Date('2026-10-05T21:31:00Z'))).toHaveLength(0);
    expect(await runFollowUps(env.ctx, new Date('2026-10-06T06:59:00Z'))).toHaveLength(0);
    expect(await runFollowUps(env.ctx, new Date('2026-10-06T07:05:00Z'))).toHaveLength(1);
    expect(daytime(new Date('2026-10-05T19:59:00Z'), 'Africa/Douala')).toBe(true);
    expect(daytime(new Date('2026-10-05T20:00:00Z'), 'Africa/Douala')).toBe(false);
  });

  it('respects a shop that turned follow-ups off', async () => {
    env = await setup();
    await env.db.query('update sellers set follow_ups = false');
    await ask(7);
    expect(await runFollowUps(env.ctx, hours(4))).toHaveLength(0);
  });

  it('tells a customer whose order hold ran out that the item is still there', async () => {
    env = await setup();
    await ask(8);
    expect((await handleInbound(env.ctx, inbound(wa(8), 'yes', at(1)))).action).toBe('ordered');
    await expireOrders(env.ctx, at(62));
    const [r] = await runFollowUps(env.ctx, at(63));
    expect(r.body).toBe("Your hold on the jet black 12\" Claw Clip Ponytail has ended, but it's still available at FCFA 15,000. Reply YES if you'd still like it.");
    expect((await handleInbound(env.ctx, inbound(wa(8), 'yes', at(70)))).action).toBe('ordered');
  });
});
