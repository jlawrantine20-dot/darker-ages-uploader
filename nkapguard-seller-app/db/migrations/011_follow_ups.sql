-- One polite reminder to customers who went quiet after an "in stock" answer, or whose order
-- hold ran out unpaid. A shop can turn them off.
alter table sellers add column if not exists follow_ups boolean not null default true;
create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  -- quiet: no reply after "in stock"; order_expired: an order's hold ran out unpaid.
  kind text not null check (kind in ('quiet', 'order_expired')),
  sent_at timestamptz not null
);
create index if not exists follow_ups_contact on follow_ups (contact_id, product_id, sent_at);
