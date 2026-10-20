-- How much of its stock a shop tells customers: the exact count, the count only when it is
-- low, or never a number. Whatever is said is the live count; nothing here can overstate scarcity.
alter table sellers add column if not exists stock_display text not null default 'exact' check (stock_display in ('exact', 'low', 'hidden'));
alter table sellers add column if not exists low_stock_at integer not null default 5 check (low_stock_at between 1 and 50);
