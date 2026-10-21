-- Selling in batches: a shop with lots of stock puts only part of it on sale. batch_left is
-- what's left of the current batch (null: no batches, everything in stock is on sale).
-- Customers can only buy from the batch, so "only 3 left in this batch" is always true.
alter table products add column if not exists batch_left integer check (batch_left >= 0);
