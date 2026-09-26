import { ratesFor, usdMicros } from '../domain/markets.js';
import { whatsappWindowOpen } from '../domain/windows.js';
import type { Ctx, DispatchResult, Outbound } from './context.js';

/** Estimated Meta charge for one message, in millionths of a USD. Meta prices by the customer's country; we use the shop's. */
export function messageCost(ctx: Ctx, country: string, category: 'service' | 'utility' | 'marketing'): number {
  return usdMicros(category === 'service' ? ctx.config.serviceRateUsd : ratesFor(country)[category]);
}

/**
 * Send messages after the database work has committed, and log each one with its
 * estimated cost. Free-form text outside the 24h window is never sent: it goes out as its
 * approved fallback template if it has one, and is skipped otherwise.
 */
export async function dispatch(ctx: Ctx, outs: Outbound[], now: Date): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  const { templates } = ctx.config.whatsapp;
  for (const out of outs) {
    let o: Outbound = out;
    if (o.kind === 'text' && !whatsappWindowOpen(o.lastInboundAt, now)) {
      if (!o.fallback) {
        results.push({ to: o.to, status: 'window_closed', body: o.body, costUsdMicros: 0 });
        continue;
      }
      const { kind: _k, body: _b, fallback, ...who } = o;
      o = { ...who, kind: 'template', ...fallback };
    }
    const body = o.kind === 'text' ? o.body : o.preview;
    const category = o.kind === 'text' ? 'service' : o.category;
    const cost = messageCost(ctx, o.country, category);
    try {
      const sent =
        o.kind === 'text'
          ? await ctx.channel.sendText(o.from, o.to, o.body)
          : await ctx.channel.sendTemplate(o.from, o.to, { name: templates[o.template], language: o.language, params: o.params });
      await ctx.db.query(
        `insert into messages (seller_id, contact_id, direction, kind, template, category, body, cost_usd_micros, provider_id, created_at)
         values ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9)`,
        [o.sellerId, o.contactId, o.kind, o.kind === 'template' ? templates[o.template] : null, category, body, cost, sent.providerId, now],
      );
      results.push({ to: o.to, status: 'sent', body, costUsdMicros: cost });
    } catch (err) {
      results.push({ to: o.to, status: 'failed', body, costUsdMicros: 0, error: (err as Error).message });
    }
  }
  return results;
}
