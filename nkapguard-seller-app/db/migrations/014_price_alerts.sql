-- Price-drop alerts. A customer who bargains is offered one; a yes is recorded in consents
-- (purpose 'price_alert'). When the seller lowers the price, those customers are told once
-- per price.
alter table contacts add column if not exists awaiting_price_alert_product_id uuid references products(id) on delete set null;
alter table contacts add column if not exists awaiting_price_alert_at timestamptz;
create table if not exists price_alert_sends (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  old_price_minor bigint not null,
  new_price_minor bigint not null,
  sent_at timestamptz not null
);
create index if not exists price_alert_sends_lookup on price_alert_sends (product_id, contact_id);
-- The real price before the last cut, kept by the server, so a "was" price can't be made up.
alter table products add column if not exists previous_price_minor bigint;
alter table products add column if not exists price_lowered_at timestamptz;
