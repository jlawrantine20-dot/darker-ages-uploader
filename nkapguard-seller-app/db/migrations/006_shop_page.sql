-- Public shop page: a short name for its link (seller.nkapguard.com/shop.html?s=hair-plug)
-- and the WhatsApp number customers write to, in international digits (237677123456).
alter table sellers add column if not exists slug text unique;
alter table sellers add column if not exists wa_display_phone text;
update sellers
   set slug = trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || left(id::text, 4)
 where slug is null;
