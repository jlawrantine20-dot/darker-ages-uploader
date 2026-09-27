-- NKAPGUARD Seller App on Supabase: everything lives in its own schema, walled off from
-- the rest of the project. Every name is schema-qualified, so nothing can land in public.
-- Only the seller-app edge function (connecting as the database owner) reads or writes it;
-- the public API roles get no access.
create schema if not exists seller_app;
revoke all on schema seller_app from public, anon, authenticated;

-- NKAPGUARD schema. Prices are stored in the currency's smallest unit (e.g. kobo for NGN,
-- cents for USD, whole francs for XAF, which has no subunit). Meta message costs are
-- estimates in millionths of a US dollar, because Meta bills WhatsApp in USD.

create table if not exists seller_app.sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- WhatsApp Cloud API phone number id; routes inbound webhooks to a seller.
  wa_phone_number_id text unique,
  country text not null,                -- ISO 3166-1 alpha-2, e.g. CM, NG, KE, US
  currency text not null,               -- ISO 4217, e.g. XAF, NGN, KES, USD
  language text not null default 'en',  -- language customers are messaged in: en, fr
  timezone text not null,               -- IANA, e.g. Africa/Douala
  -- test | paystack | flutterwave | stripe | notchpay. Money goes to the seller's own account.
  payment_provider text not null default 'test',
  payment_secret_enc text,              -- encrypted API secret key
  payment_webhook_secret_enc text,      -- encrypted webhook signing secret, where the provider uses one
  created_at timestamptz not null default now()
);
-- Public shop page: its link name, and the WhatsApp number customers write to.
alter table seller_app.sellers add column if not exists slug text unique;
alter table seller_app.sellers add column if not exists wa_display_phone text;

create table if not exists seller_app.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references seller_app.sellers(id) on delete cascade,
  name text not null,
  variant text not null default '',
  -- Extra words customers use for this item, e.g. {'ponytail extension', 'mèche'}.
  aliases text[] not null default '{}',
  price_minor bigint not null check (price_minor >= 0),
  stock integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now()
);

create table if not exists seller_app.contacts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references seller_app.sellers(id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'instagram', 'facebook', 'tiktok')),
  -- WhatsApp id: international digits without '+', e.g. 237677123456.
  wa_id text not null,
  name text,
  -- Opens WhatsApp's 24-hour customer service window.
  last_inbound_at timestamptz,
  -- When the seller last opened the chat; newer inbound messages count as unread.
  seller_read_at timestamptz,
  -- Set when we have asked "want an alert when it's back?" and await a yes.
  awaiting_consent_product_id uuid references seller_app.products(id) on delete set null,
  awaiting_consent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (seller_id, wa_id)
);
-- The language the customer writes in (en or fr), learned from their messages.
alter table seller_app.contacts add column if not exists language text check (language in ('en', 'fr'));
-- Set after asking "which colour?", so a short answer can be read against that product.
alter table seller_app.contacts add column if not exists awaiting_choice_name text;
alter table seller_app.contacts add column if not exists awaiting_choice_at timestamptz;

create table if not exists seller_app.messages (
  id uuid primary key default gen_random_uuid(),
  -- Arrival order; timestamps can tie when a reply is logged in the same instant.
  seq bigint generated always as identity,
  seller_id uuid not null references seller_app.sellers(id) on delete cascade,
  contact_id uuid not null references seller_app.contacts(id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'instagram', 'facebook', 'tiktok')),
  direction text not null check (direction in ('in', 'out')),
  kind text not null check (kind in ('text', 'template')),
  template text,
  category text check (category in ('service', 'utility', 'marketing')),
  body text not null,
  cost_usd_micros bigint not null default 0,
  provider_id text,
  created_at timestamptz not null default now()
);
create index if not exists messages_contact on seller_app.messages (contact_id, created_at, seq);
-- Why an outgoing message was not delivered (for example an expired WhatsApp token).
alter table seller_app.messages add column if not exists error text;

-- Consent record: who agreed, to what, in their own words, and when.
create table if not exists seller_app.consents (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references seller_app.sellers(id) on delete cascade,
  contact_id uuid not null references seller_app.contacts(id) on delete cascade,
  channel text not null,
  purpose text not null,
  product_id uuid references seller_app.products(id) on delete set null,
  quote text not null,
  granted_at timestamptz not null,
  revoked_at timestamptz
);

-- The waitlist. Order is (created_at, seq); position is computed, never stored.
create table if not exists seller_app.interests (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  seller_id uuid not null references seller_app.sellers(id) on delete cascade,
  product_id uuid not null references seller_app.products(id) on delete cascade,
  contact_id uuid not null references seller_app.contacts(id) on delete cascade,
  consent_id uuid not null references seller_app.consents(id),
  status text not null default 'waiting' check (status in ('waiting', 'bought', 'removed')),
  created_at timestamptz not null
);
create unique index if not exists interests_one_waiting
  on seller_app.interests (product_id, contact_id) where status = 'waiting';
create index if not exists interests_queue on seller_app.interests (product_id, status, created_at, seq);

create table if not exists seller_app.restocks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references seller_app.products(id) on delete cascade,
  units integer not null check (units > 0),
  -- hold: one message per unit, each with a timed hold that passes down the line.
  -- race: per_unit messages per unit at once, first to pay wins.
  mode text not null check (mode in ('hold', 'race')),
  hold_minutes integer not null default 120 check (hold_minutes > 0),
  per_unit integer not null default 5 check (per_unit > 0),
  created_at timestamptz not null,
  closed_at timestamptz
);

create table if not exists seller_app.offers (
  id uuid primary key default gen_random_uuid(),
  restock_id uuid not null references seller_app.restocks(id) on delete cascade,
  interest_id uuid not null references seller_app.interests(id) on delete cascade,
  status text not null check (status in ('held', 'notified', 'paid', 'expired', 'missed')),
  sent_at timestamptz not null,
  expires_at timestamptz,
  paid_at timestamptz,
  -- Set when a payment arrives after the units are gone; the seller must refund.
  refund_due boolean not null default false,
  payment_ref text not null unique,
  payment_url text,
  unique (restock_id, interest_id)
);

-- Seller accounts: people sign in with their WhatsApp number and a one-time code, and
-- see only the shops they belong to.

create table if not exists seller_app.users (
  id uuid primary key default gen_random_uuid(),
  -- WhatsApp id: international digits without '+'.
  wa_id text not null unique,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists seller_app.shop_members (
  seller_id uuid not null references seller_app.sellers(id) on delete cascade,
  user_id uuid not null references seller_app.users(id) on delete cascade,
  -- owner: everything. staff: chats, stock and restocks; not payments or the team.
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (seller_id, user_id)
);

create table if not exists seller_app.login_codes (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null,
  code_hash text not null,
  attempts integer not null default 0,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists login_codes_phone on seller_app.login_codes (wa_id, created_at);

create table if not exists seller_app.sessions (
  -- Only a hash of the token is stored, so a database leak does not leak sessions.
  token_hash text primary key,
  user_id uuid not null references seller_app.users(id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

-- Optional Instagram and Messenger channels, connected per shop (see db/migrations/007).
create table if not exists seller_app.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references seller_app.sellers(id) on delete cascade,
  channel text not null check (channel in ('instagram', 'facebook')),
  external_id text not null,
  name text,
  username text,
  token_enc text not null,
  token_expires_at timestamptz,
  enabled boolean not null default true,
  comment_replies boolean not null default true,
  connected_at timestamptz not null default now(),
  unique (channel, external_id)
);
create index if not exists channel_accounts_seller on seller_app.channel_accounts (seller_id);
alter table seller_app.contacts drop constraint if exists contacts_seller_id_wa_id_key;
alter table seller_app.contacts drop constraint if exists contacts_seller_channel_user;
alter table seller_app.contacts add constraint contacts_seller_channel_user unique (seller_id, channel, wa_id);
alter table seller_app.contacts add column if not exists channel_account_id uuid references seller_app.channel_accounts(id) on delete set null;
alter table seller_app.contacts add column if not exists username text;
create table if not exists seller_app.comment_replies (
  account_id uuid not null references seller_app.channel_accounts(id) on delete cascade,
  commenter_id text not null,
  post_id text not null,
  created_at timestamptz not null
);
create index if not exists comment_replies_lookup on seller_app.comment_replies (account_id, commenter_id, post_id, created_at);
create table if not exists seller_app.channel_pending (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references seller_app.sellers(id) on delete cascade,
  pages_enc text not null,
  expires_at timestamptz not null
);

-- Defence in depth: row-level security on, with no policies, so even if the schema were
-- exposed later, the anon and authenticated roles would see nothing.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'seller_app' loop
    execute format('alter table seller_app.%I enable row level security', t.tablename);
    execute format('revoke all on seller_app.%I from public, anon, authenticated', t.tablename);
  end loop;
end $$;
