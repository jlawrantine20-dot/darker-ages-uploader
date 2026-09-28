/**
 * How many units of each currency make one US dollar. Meta bills WhatsApp fees in USD, but a
 * seller in Douala thinks in FCFA and one in Lagos in naira, so the app converts fees before
 * showing them. Rates come from a free daily feed; the fallbacks below keep the app working
 * (approximately) until the first refresh or if the feed is down.
 */
import type { Ctx } from './context.js';

export const FALLBACK_PER_USD: Record<string, number> = {
  USD: 1, XAF: 600, XOF: 600, NGN: 1500, GHS: 12, KES: 129, ZAR: 17.5, RWF: 1450, UGX: 3650,
  TZS: 2600, EGP: 48.5, CAD: 1.38, GBP: 0.75, EUR: 0.86, INR: 88, BRL: 5.4,
};

const FEED = 'https://open.er-api.com/v6/latest/USD';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface FxRates {
  perUsd: Record<string, number>;
  /** When the live rates were last fetched; null while only fallbacks are known. */
  asOf: string | null;
}

export async function fxRates(ctx: Ctx): Promise<FxRates> {
  const rows = await ctx.db.query<{ currency: string; per_usd: string; updated_at: Date }>('select currency, per_usd, updated_at from fx_rates');
  const perUsd = { ...FALLBACK_PER_USD };
  let asOf: Date | null = null;
  for (const r of rows) {
    perUsd[r.currency] = Number(r.per_usd);
    if (!asOf || r.updated_at > asOf) asOf = r.updated_at;
  }
  return { perUsd, asOf: asOf ? new Date(asOf).toISOString() : null };
}

/** Fetch fresh rates when the stored ones are over 12 hours old. Returns true if it updated. */
export async function refreshFx(ctx: Ctx, now: Date): Promise<boolean> {
  // Test mode stays offline unless a test supplies its own fetch.
  if (ctx.config.dryRun && !ctx.fetch) return false;
  const [latest] = await ctx.db.query<{ at: Date | null }>('select max(updated_at) as at from fx_rates');
  if (latest?.at && now.getTime() - new Date(latest.at).getTime() < MAX_AGE_MS) return false;
  try {
    const res = await (ctx.fetch ?? fetch)(FEED);
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (!res.ok || json.result !== 'success' || !json.rates) return false;
    // Only currencies shops use or might pick, not all 160.
    const [{ list }] = await ctx.db.query<{ list: string[] | null }>('select array_agg(distinct currency) as list from sellers');
    const wanted = new Set([...Object.keys(FALLBACK_PER_USD), ...(list ?? [])]);
    for (const cur of wanted) {
      const v = json.rates[cur];
      if (!(v > 0)) continue;
      await ctx.db.query(
        `insert into fx_rates (currency, per_usd, updated_at) values ($1, $2, $3)
         on conflict (currency) do update set per_usd = excluded.per_usd, updated_at = excluded.updated_at`,
        [cur, v, now],
      );
    }
    return true;
  } catch (err) {
    console.error('Exchange rate refresh failed', err);
    return false;
  }
}
