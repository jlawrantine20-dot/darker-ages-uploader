import { whatsappWindowOpen } from '../domain/windows.js';
import type { Ctx, DispatchResult, Outbound } from './context.js';

/**
 * Send messages after the database work has committed, and log each one with its
 * estimated cost. Free-form text outside the 24h window is never sent: it goes out as its
 * approved fallback template if it has one, and is skipped otherwise.
 */
export async function dispatch(ctx: Ctx, outs: Outbound[], now: Date): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  const { templates, templateLanguage } = ctx.config.whatsapp;
  for (const out of outs) {
    let o: Outbound = out;
    if (o.kind === 'text' && !whatsappWindowOpen(o.lastInboundAt, now)) {
      if (!o.fallback) {
        results.push({ to: o.to, status: 'window_closed', body: o.body, costKobo: 0 });
        continue;
      }
      const { kind: _k, body: _b, fallback, ...who } = o;
      o = { ...who, kind: 'template', ...fallback };
    }
    const body = o.kind === 'text' ? o.body : o.preview;
    const category = o.kind === 'text' ? 'service' : o.category;
    const costKobo = ctx.config.rateKobo[category];
    try {
      const sent =
        o.kind === 'text'
          ? await ctx.channel.sendText(o.from, o.to, o.body)
          : await ctx.channel.sendTemplate(o.from, o.to, {
              name: templates[o.template],
              language: templateLanguage,
              params: o.params,
            });
      await ctx.db.query(
        `insert into messages (seller_id, contact_id, direction, kind, template, category, body, cost_kobo, provider_id, created_at)
         values ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9)`,
        [o.sellerId, o.contactId, o.kind, o.kind === 'template' ? templates[o.template] : null, category, body, costKobo, sent.providerId, now],
      );
      results.push({ to: o.to, status: 'sent', body, costKobo });
    } catch (err) {
      results.push({ to: o.to, status: 'failed', body, costKobo: 0, error: (err as Error).message });
    }
  }
  return results;
}
