-- A finished Instagram or Facebook sign-in is held here until the person who pressed Connect
-- confirms it from their signed-in Seller App. A sign-in link started by someone else can
-- then never attach a seller's account to another shop.
alter table channel_pending add column if not exists kind text not null default 'facebook' check (kind in ('instagram', 'facebook'));
alter table channel_pending add column if not exists started_by uuid references users(id) on delete cascade;
