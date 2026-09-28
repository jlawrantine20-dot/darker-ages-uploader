-- Delivery areas and their fees, set by the seller ("Bonamoussadi: 1 500 FCFA"). A zero fee
-- works for pickup ("Retrait en boutique").
create table if not exists delivery_zones (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  name text not null,
  -- Other ways customers write it: {'bonamou', 'bonamousadi'}.
  aliases text[] not null default '{}',
  fee_minor bigint not null check (fee_minor >= 0),
  created_at timestamptz not null default now()
);
create index if not exists delivery_zones_seller on delivery_zones (seller_id);

alter table orders add column if not exists delivery_zone_id uuid references delivery_zones(id) on delete set null;
alter table orders add column if not exists delivery_zone text;
alter table orders add column if not exists delivery_fee_minor bigint not null default 0;

-- The customer's area, remembered for their next order; and an order waiting for its area.
alter table contacts add column if not exists delivery_zone_id uuid references delivery_zones(id) on delete set null;
alter table contacts add column if not exists awaiting_zone_at timestamptz;
alter table contacts add column if not exists pending_order_product_id uuid references products(id) on delete set null;
alter table contacts add column if not exists pending_order_quantity integer;
