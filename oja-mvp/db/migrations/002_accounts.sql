-- Seller accounts: people sign in with their WhatsApp number and a one-time code, and
-- see only the shops they belong to.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  -- WhatsApp id: international digits without '+'.
  wa_id text not null unique,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists shop_members (
  seller_id uuid not null references sellers(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- owner: everything. staff: chats, stock and restocks; not payments or the team.
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (seller_id, user_id)
);

create table if not exists login_codes (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null,
  code_hash text not null,
  attempts integer not null default 0,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists login_codes_phone on login_codes (wa_id, created_at);

create table if not exists sessions (
  -- Only a hash of the token is stored, so a database leak does not leak sessions.
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
