-- Optional Instagram and Messenger channels. Each shop chooses which ones it uses: a row
-- here means the shop connected that account, and `enabled` lets it pause the channel
-- without disconnecting. WhatsApp stays the shop's own number (sellers.wa_phone_number_id)
-- because it is the only channel that can send restock alerts later.
create table if not exists channel_accounts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  channel text not null check (channel in ('instagram', 'facebook')),
  -- Instagram professional account id, or Facebook Page id: the id webhooks arrive with.
  external_id text not null,
  name text,
  username text,
  token_enc text not null,
  -- Instagram user tokens last 60 days and are refreshed; Page tokens don't expire.
  token_expires_at timestamptz,
  enabled boolean not null default true,
  -- Reply privately, once, to comments that ask about price or stock.
  comment_replies boolean not null default true,
  connected_at timestamptz not null default now(),
  unique (channel, external_id)
);
create index if not exists channel_accounts_seller on channel_accounts (seller_id);

-- A customer is one person on one channel: the same number can't be matched across apps.
-- contacts.wa_id holds the channel's user id: a WhatsApp number, an Instagram-scoped id or a
-- Page-scoped id.
alter table contacts drop constraint if exists contacts_seller_id_wa_id_key;
alter table contacts add constraint contacts_seller_channel_user unique (seller_id, channel, wa_id);
alter table contacts add column if not exists channel_account_id uuid references channel_accounts(id) on delete set null;
alter table contacts add column if not exists username text;

-- One private reply per commenter per post per day, so a busy post can't trigger a flood.
create table if not exists comment_replies (
  account_id uuid not null references channel_accounts(id) on delete cascade,
  commenter_id text not null,
  post_id text not null,
  created_at timestamptz not null
);
create index if not exists comment_replies_lookup on comment_replies (account_id, commenter_id, post_id, created_at);

-- A Facebook sign-in that returned several Pages waits here while the seller picks one.
create table if not exists channel_pending (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  pages_enc text not null,
  expires_at timestamptz not null
);
