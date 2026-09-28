-- Phones and computers where a seller turned on notifications. One row per browser; every
-- member of a shop gets that shop's notifications, in the language their app was set to.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  lang text not null default 'en' check (lang in ('en', 'fr')),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on push_subscriptions (user_id);
