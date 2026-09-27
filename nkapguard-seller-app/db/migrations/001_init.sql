-- NKAPGUARD schema. Prices are stored in the currency's smallest unit (e.g. kobo for NGN,
-- cents for USD, whole francs for XAF, which has no subunit). Meta message costs are
-- estimates in millionths of a US dollar, because Meta bills WhatsApp in USD.

create table if not exists sellers (
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

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  name text not null,
  variant text not null default '',
  -- Extra words customers use for this item, e.g. {'ponytail extension', 'mèche'}.
  aliases text[] not null default '{}',
  price_minor bigint not null check (price_minor >= 0),
  stock integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'instagram', 'facebook', 'tiktok')),
  -- WhatsApp id: international digits without '+', e.g. 237677123456.
  wa_id text not null,
  name text,
  -- Opens WhatsApp's 24-hour customer service window.
  last_inbound_at timestamptz,
  -- When the seller last opened the chat; newer inbound messages count as unread.
  seller_read_at timestamptz,
  -- Set when we have asked "want an alert when it's back?" and await a yes.
  awaiting_consent_product_id uuid references products(id) on delete set null,
  awaiting_consent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (seller_id, wa_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  -- Arrival order; timestamps can tie when a reply is logged in the same instant.
  seq bigint generated always as identity,
  seller_id uuid not null references sellers(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
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
create index if not exists messages_contact on messages (contact_id, created_at, seq);

-- Consent record: who agreed, to what, in their own words, and when.
create table if not exists consents (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel text not null,
  purpose text not null,
  product_id uuid references products(id) on delete set null,
  quote text not null,
  granted_at timestamptz not null,
  revoked_at timestamptz
);

-- The waitlist. Order is (created_at, seq); position is computed, never stored.
create table if not exists interests (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  seller_id uuid not null references sellers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  consent_id uuid not null references consents(id),
  status text not null default 'waiting' check (status in ('waiting', 'bought', 'removed')),
  created_at timestamptz not null
);
create unique index if not exists interests_one_waiting
  on interests (product_id, contact_id) where status = 'waiting';
create index if not exists interests_queue on interests (product_id, status, created_at, seq);

create table if not exists restocks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  units integer not null check (units > 0),
  -- hold: one message per unit, each with a timed hold that passes down the line.
  -- race: per_unit messages per unit at once, first to pay wins.
  mode text not null check (mode in ('hold', 'race')),
  hold_minutes integer not null default 120 check (hold_minutes > 0),
  per_unit integer not null default 5 check (per_unit > 0),
  created_at timestamptz not null,
  closed_at timestamptz
);

create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  restock_id uuid not null references restocks(id) on delete cascade,
  interest_id uuid not null references interests(id) on delete cascade,
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
