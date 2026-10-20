-- Direct payment: a shop with no payment gateway lists where customers can send money
-- (a mobile money number, a bank account). Customers say when they have paid; the seller
-- checks and confirms.
alter table sellers add column if not exists pay_methods jsonb not null default '[]';
alter table orders add column if not exists claimed_at timestamptz;
alter table orders add column if not exists claim_note text;
alter table offers add column if not exists claimed_at timestamptz;
alter table offers add column if not exists claim_note text;
