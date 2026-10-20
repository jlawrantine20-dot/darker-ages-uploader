import { afterEach, describe, expect, it } from 'vitest';
import { stockShown } from '../src/domain/copy.js';
import { handleInbound } from '../src/services/inbound.js';
import { T0, at, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});
const last = () => env.channel.sent.at(-1)?.body ?? '';
const show = (mode: 'exact' | 'low' | 'hidden', at = 5) => env.db.query('update sellers set stock_display = $2, low_stock_at = $3 where id = $1', [env.sellerId, mode, at]);
const setStock = (n: number) => env.db.query('update products set stock = $2 where id = $1', [env.black, n]);

describe('How much stock customers are told', () => {
  it('never says a number other than the real one', () => {
    for (const free of [1, 2, 5, 6, 400]) {
      for (const d of [undefined, { stock_display: 'exact' as const, low_stock_at: 5 }, { stock_display: 'low' as const, low_stock_at: 5 }, { stock_display: 'hidden' as const, low_stock_at: 5 }]) {
        const note = stockShown(d, free);
        if (d?.stock_display === 'hidden') expect(note).toBe('none');
        if (d?.stock_display === 'low' && free > 5) expect(note).toBe('none');
      }
    }
  });

  it('gives the exact count by default', async () => {
    env = await setup({ language: 'fr' });
    await setStock(400);
    await handleInbound(env.ctx, inbound(wa(1), 'vous avez le claw clip ponytail noir ?', T0));
    expect(last()).toContain('Il nous en reste 400. Pour le commander');
  });

  it('only mentions stock once it is low, with the real number', async () => {
    env = await setup({ language: 'fr' });
    await show('low', 5);
    await setStock(400);
    await handleInbound(env.ctx, inbound(wa(2), 'vous avez le claw clip ponytail noir ?', T0));
    expect(last()).toMatch(/est disponible au prix de .+\. Pour le commander, répondez simplement OUI\.$/);
    expect(last()).not.toContain('400');
    await setStock(3);
    await handleInbound(env.ctx, inbound(wa(3), 'vous avez le claw clip ponytail noir ?', at(1)));
    expect(last()).toContain('Plus que 3 en stock ! Pour le commander');
    await show('low', 5);
    await setStock(1);
    env.channel.sent.length = 0;
    await handleInbound(env.ctx, inbound(wa(4), 'do you have the claw clip ponytail noir?', at(2)));
    expect(last()).toMatch(/C'est le dernier !|It's the last one!/);
  });

  it('can keep the count private entirely', async () => {
    env = await setup();
    await show('hidden');
    await setStock(2);
    await handleInbound(env.ctx, inbound(wa(5), 'do you have the jet black claw clip ponytail?', T0));
    expect(last()).toMatch(/in stock at .+\. To order, just reply YES\.$/);
    await handleInbound(env.ctx, inbound(wa(6), 'do you have the claw clip ponytail?', at(1)));
    expect(last()).toContain('jet black (in stock)');
    expect(last()).not.toMatch(/\d in stock/);
  });
});
