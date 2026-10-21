-- WhatsApp Embedded Signup: each shop connects its own WhatsApp Business account. Its access
-- key is kept encrypted and used for everything sent from its number.
alter table sellers add column if not exists waba_id text;
alter table sellers add column if not exists wa_token_enc text;
alter table sellers add column if not exists wa_pin_enc text;
alter table sellers add column if not exists wa_verified_name text;
alter table sellers add column if not exists wa_connected_at timestamptz;
