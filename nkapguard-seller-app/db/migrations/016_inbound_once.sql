-- Meta can deliver the same webhook more than once (it retries when a reply is slow). Each
-- incoming message is handled once: its Meta id is unique per shop and channel.
create unique index if not exists messages_inbound_once on messages (seller_id, channel, provider_id)
  where direction = 'in' and provider_id is not null;
-- What a restock buyer actually paid, so later price changes don't rewrite past sales.
alter table offers add column if not exists amount_minor bigint;
