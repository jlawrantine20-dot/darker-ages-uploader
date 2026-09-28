-- Exchange rates against the US dollar. Meta bills WhatsApp messages in USD; the app shows
-- those fees in each shop's own currency. Refreshed daily by the scheduler.
create table if not exists fx_rates (
  currency text primary key,
  per_usd numeric not null check (per_usd > 0),
  updated_at timestamptz not null default now()
);
