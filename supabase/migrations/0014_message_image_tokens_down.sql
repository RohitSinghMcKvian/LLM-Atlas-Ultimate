-- Reverses 0014_message_image_tokens.sql.
--
-- Dropping the column discards the image/text split on every message that had
-- one. `cost_usd` is unaffected, so no turn loses its recorded price — only the
-- ability to re-derive it.

alter table messages drop constraint if exists messages_image_tokens_nonneg;
alter table messages drop column if exists image_tokens;
