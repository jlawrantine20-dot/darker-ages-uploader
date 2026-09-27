-- The language each customer writes in (en or fr), learned from their messages. Replies,
-- alerts and confirmations use it; when unknown, the shop's language is used.
alter table contacts add column if not exists language text check (language in ('en', 'fr'));
