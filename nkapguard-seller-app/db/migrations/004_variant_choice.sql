-- Set when we have asked "which colour?" for a product that comes in several variants, so a
-- short answer ("jet black", "le noir") can be read against that product.
alter table contacts add column if not exists awaiting_choice_name text;
alter table contacts add column if not exists awaiting_choice_at timestamptz;
