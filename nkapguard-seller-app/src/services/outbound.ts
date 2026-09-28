import { ratesFor, usdMicros } from '../domain/markets.js';
import { whatsappWindowOpen } from '../domain/windows.js';
import { templateFor } from '../domain/copy.js';
import { DryRunSocial, metaGraph, type SocialAccount, type SocialSender } from '../channels/meta.js';
import { decryptSecret } from '../crypto.js';
import type { Ctx, DispatchResult, Outbound } from './context.js';

const testModeSocial = new DryRunSocial((m) => console.log(`[test mode] ${m.channel} to ${'commentId' in m.to ? `comment ${m.to.commentId}` : m.to.userId}: ${m.text}`));

/** The Instagram/Messenger sender: the one set on ctx, Meta's Graph API, or a recorder in test mode. */
export function socialFor(ctx: Ctx): SocialSender {
  return ctx.social ?? (ctx.config.dryRun ? testModeSocial : metaGraph({ version: ctx.config.meta.graphVersion }));
}

/** A connected Instagram or Messenger account with its token decrypted, or null if it's gone or paused. */
export async function socialAccount(ctx: Ctx, accountRowId: string): Promise<(SocialAccount & { id: string; seller_id: string }) | null> {
  const [a] = await ctx.db.query<{ id: string; seller_id: string; channel: 'instagram' | 'facebook'; external_id: string; token_enc: string; enabled: boolean }>(
    'select * from channel_accounts where id = $1',
    [accountRowId],
  );
  if (!a || !a.enabled) return null;
  return { id: a.id, seller_id: a.seller_id, channel: a.channel, externalId: a.external_id, token: decryptSecret(a.token_enc, ctx.config.appSecret) };
}

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
    // Instagram and Messenger: free replies within 24 hours (or one private reply to a
    // comment), no templates. Anything else is skipped.
    if (out.channel && out.channel !== 'whatsapp') {
      const body = out.kind === 'text' ? out.body : out.preview;
      if (out.kind !== 'text' || (!out.commentId && !whatsappWindowOpen(out.lastInboundAt, now))) {
        results.push({ to: out.to, status: 'window_closed', body, costUsdMicros: 0 });
        continue;
      }
      let providerId: string | null = null;
      let error: string | null = null;
      try {
        const account = await socialAccount(ctx, out.from);
        if (!account) throw new Error('This channel is paused or disconnected in Settings.');
        // The photo first, then the words, so they read in order in the chat.
        if (out.imageUrl && !out.commentId) {
          await socialFor(ctx).sendImage(account, { userId: out.to }, out.imageUrl).catch((err) => console.error(`Photo to ${out.channel} user ${out.to} not sent: ${(err as Error).message}`));
        }
        providerId = (await socialFor(ctx).send(account, out.commentId ? { commentId: out.commentId } : { userId: out.to }, out.body)).providerId;
      } catch (err) {
        error = (err as Error).message;
        console.error(`Message to ${out.channel} user ${out.to} not sent: ${error}`);
      }
      await ctx.db.query(
        `insert into messages (seller_id, contact_id, channel, direction, kind, category, body, cost_usd_micros, provider_id, error, created_at, image_url)
         values ($1, $2, $3, 'out', 'text', 'service', $4, 0, $5, $6, $7, $8)`,
        [out.sellerId, out.contactId, out.channel, body, providerId, error, now, out.kind === 'text' && !out.commentId ? out.imageUrl ?? null : null],
      );
      results.push(error ? { to: out.to, status: 'failed', body, costUsdMicros: 0, error } : { to: out.to, status: 'sent', body, costUsdMicros: 0 });
      continue;
    }
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
    const image = o.kind === 'text' ? o.imageUrl ?? null : null;
    try {
      // A photo carries the text as its caption; if the photo can't go, the text still does.
      const sent =
        o.kind === 'text' && image
          ? await ctx.channel.sendImage(o.from, o.to, image, o.body).catch(() => ctx.channel.sendText(o.from, o.to, (o as { body: string }).body))
          : o.kind === 'text'
          ? await ctx.channel.sendText(o.from, o.to, o.body)
          : await ctx.channel.sendTemplate(o.from, o.to, { ...templateFor(templates[o.template], o.language), params: o.params });
      await ctx.db.query(
        `insert into messages (seller_id, contact_id, direction, kind, template, category, body, cost_usd_micros, provider_id, created_at, image_url)
         values ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [o.sellerId, o.contactId, o.kind, o.kind === 'template' ? templateFor(templates[o.template], o.language).name : null, category, body, cost, sent.providerId, now, image],
      );
      results.push({ to: o.to, status: 'sent', body, costUsdMicros: cost });
    } catch (err) {
      const error = (err as Error).message;
      // Keep the failed message, with the reason, so the seller sees it in the chat.
      console.error(`Message to ${o.to} not sent: ${error}`);
      await ctx.db.query(
        `insert into messages (seller_id, contact_id, direction, kind, template, category, body, cost_usd_micros, error, created_at)
         values ($1, $2, 'out', $3, $4, $5, $6, 0, $7, $8)`,
        [o.sellerId, o.contactId, o.kind, o.kind === 'template' ? templateFor(templates[o.template], o.language).name : null, category, body, error, now],
      );
      results.push({ to: o.to, status: 'failed', body, costUsdMicros: 0, error });
    }
  }
  return results;
}
