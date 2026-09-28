-- Orders placed in the chat for items in stock ("je le prends", "I'll take two").
-- A held order keeps its units aside until expires_at, so nobody else can buy them while
-- the customer pays. Unpaid holds lapse and the units go back on sale.
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity integer not null default 1 check (quantity between 1 and 50),
  amount_minor bigint not null check (amount_minor >= 0),
  -- held | paid | expired | cancelled | refund_due (paid after the units were gone)
  status text not null check (status in ('held', 'paid', 'expired', 'cancelled', 'refund_due')),
  channel text not null,
  payment_ref text not null unique,
  -- online: through the shop's payment provider; manual: the seller marked it paid (cash, transfer).
  paid_via text check (paid_via in ('online', 'manual')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  paid_at timestamptz
);
create index if not exists orders_held on orders (product_id) where status = 'held';
create index if not exists orders_seller on orders (seller_id, created_at desc);
create index if not exists orders_contact on orders (contact_id, created_at desc);

-- Set when we told a customer an item is in stock and "reply YES to order".
alter table contacts add column if not exists awaiting_order_product_id uuid references products(id) on delete set null;
alter table contacts add column if not exists awaiting_order_at timestamptz;
