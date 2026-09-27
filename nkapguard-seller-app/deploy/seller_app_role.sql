-- A dedicated database user for the seller-app edge function, capped at 10 connections, so
-- the seller app can never use up the connections the rest of the project needs.
-- The password is set at deploy time (never committed): replace :PASSWORD.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'seller_app_fn') then
    create role seller_app_fn login noinherit connection limit 10 password ':PASSWORD';
  else
    alter role seller_app_fn login noinherit connection limit 10 password ':PASSWORD';
  end if;
end $$;
alter role seller_app_fn set search_path = seller_app;
alter role seller_app_fn set statement_timeout = '15s';
alter role seller_app_fn set idle_in_transaction_session_timeout = '15s';

grant usage on schema seller_app to seller_app_fn;
grant select, insert, update, delete on all tables in schema seller_app to seller_app_fn;
grant usage, select on all sequences in schema seller_app to seller_app_fn;

-- Row-level security stays on for everyone else; this role alone may see every row.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'seller_app' loop
    execute format('drop policy if exists seller_app_fn_all on seller_app.%I', t.tablename);
    execute format('create policy seller_app_fn_all on seller_app.%I for all to seller_app_fn using (true) with check (true)', t.tablename);
  end loop;
end $$;
