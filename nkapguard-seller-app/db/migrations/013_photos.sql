-- One photo per product (each colour is its own product row). Kept in the database, resized
-- by the seller app before upload (about 100 KB), and served from /photos/<product id>.
create table if not exists product_photos (
  product_id uuid primary key references products(id) on delete cascade,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null,
  updated_at timestamptz not null default now()
);
-- Changes whenever the photo does, so links can be cached for good.
alter table products add column if not exists photo_version bigint;
-- The photo a message carried, to show it in the seller's chat view.
alter table messages add column if not exists image_url text;
