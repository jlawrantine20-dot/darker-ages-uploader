import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module from the web app
import { DICTS } from '../web/i18n.js';
import { createApp } from '../src/app.js';
import { fxRates, refreshFx } from '../src/services/fx.js';
import { setup } from './helpers.js';

const text = (v: unknown) => (typeof v === 'function' ? (v as (p: object) => string)({ n: 2, units: 3, sold: 1, messaged: 4, left: 2, h: 5, app: 'Instagram', name: 'Awa', phone: '+237', code: '123456', item: 'x', pos: 1, quote: 'oui', when: 'lun.', why: 'x', cur: 'XAF', status: 500, to: 'XAF', from: 'USD', rate: '600', before: 'a', after: 'b', len: '2 h', usd: '1 $', at: '14:05', r: 'x', href: '#', url: 'u', provider: 'Notch Pay', what: 'X', country: 'Cameroun', id: '1', ref: 'r' }) : String(v));

describe('Seller app languages', () => {
  it('has every English text in French too', () => {
    expect(Object.keys(DICTS.fr).sort()).toEqual(Object.keys(DICTS.en).sort());
  });

  it('keeps English words out of the French app', () => {
    // Brand and technical names that are the same in French (WhatsApp, webhook, Test key prefixes) are allowed.
    const english = /\b(the|your|you|and|with|please|is|are|to|of|for|shop|sold|waiting|settings|chats?|restock|hold|customer|send|save|add|payment|link)\b/i;
    const offenders = Object.entries(DICTS.fr as Record<string, unknown>)
      .map(([k, v]) => [k, text(v).replace(/<[^>]+>/g, ' ')] as const)
      .filter(([k, v]) => !k.startsWith('pv.') || !/^(Paystack|Stripe)/.test(v))
      .filter(([, v]) => english.test(v.replace(/Claw Clip Ponytail|claw clip ponytail|Douala Hair Plug|Marron \/ Brown|NKAPGUARD Seller App|DRY_RUN=false|WhatsApp › API Setup/g, '')));
    expect(offenders).toEqual([]);
  });

  it('writes one of something in the singular', () => {
    const one = { n: 1, units: 1, len: '2 h', left: 1, sold: 1, to: 'XAF', from: 'USD' };
    for (const lang of ['en', 'fr'] as const) {
      const bad = Object.entries(DICTS[lang] as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'function')
        .map(([k, v]) => [k, String((v as (p: unknown) => string)(one))] as const)
        .filter(([, v]) => /\b(les|the first) 1\b|\b1 (messages|notes|alertes|alerts|premiers)\b/.test(v));
      expect(bad).toEqual([]);
    }
  });
});

describe('Error messages follow the app language', () => {
  it('answers in French when the app is in French', async () => {
    const { ctx } = await setup();
    const app = createApp(ctx);
    const res = await app.request('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lang': 'fr' }, body: JSON.stringify({ phone: '677123456', country: 'CM', code: '000000' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Ce code est incorrect ou a expiré. Demandez-en un nouveau.');
    const en = await app.request('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '677123456', country: 'CM', code: '000000' }) });
    expect((await en.json()).error).toBe('That code is wrong or has expired. Request a new one.');
  });
});

describe('Exchange rates for fees', () => {
  it('uses fallbacks until the feed answers, then refreshes twice a day at most', async () => {
    const { ctx } = await setup();
    expect((await fxRates(ctx)).perUsd.XAF).toBe(600);
    let calls = 0;
    ctx.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ result: 'success', rates: { USD: 1, XAF: 566.2, NGN: 1532.5, JPY: 150 } }));
    }) as typeof fetch;
    const now = new Date('2026-10-01T08:00:00Z');
    expect(await refreshFx(ctx, now)).toBe(true);
    const r = await fxRates(ctx);
    expect(r.perUsd.XAF).toBe(566.2);
    expect(r.perUsd.NGN).toBe(1532.5);
    expect(r.perUsd.JPY).toBeUndefined();
    expect(await refreshFx(ctx, new Date('2026-10-01T15:00:00Z'))).toBe(false);
    expect(await refreshFx(ctx, new Date('2026-10-01T21:00:00Z'))).toBe(true);
    expect(calls).toBe(2);
    const body = await (await createApp(ctx).request('/markets')).json();
    expect(body.fx.perUsd.XAF).toBe(566.2);
  });

  it('keeps the old rates when the feed fails', async () => {
    const { ctx } = await setup();
    ctx.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch;
    expect(await refreshFx(ctx, new Date())).toBe(false);
    expect((await fxRates(ctx)).perUsd.XAF).toBe(600);
  });
});
