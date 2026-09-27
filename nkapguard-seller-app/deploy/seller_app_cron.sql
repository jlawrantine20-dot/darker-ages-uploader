-- NKAPGUARD Seller App: pass expired holds down the waitlist every minute.
-- Edge functions have no timer of their own, so pg_cron calls the function's /cron/tick
-- endpoint through pg_net. The secret lives in Supabase Vault, not in the job text.
-- Replace :CRON_SECRET with the same value the function has as CRON_SECRET.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(':CRON_SECRET', 'seller_app_cron_secret', 'NKAPGUARD Seller App: x-cron-secret for /cron/tick')
where not exists (select 1 from vault.secrets where name = 'seller_app_cron_secret');

select cron.schedule(
  'seller-app-tick',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://psalpplvvygliobywsda.supabase.co/functions/v1/seller-app/cron/tick',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'seller_app_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);
