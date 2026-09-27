-- Why an outgoing message was not delivered (for example an expired WhatsApp token), so the
-- seller sees the failure in the chat instead of silence. Null for delivered messages.
alter table messages add column if not exists error text;
