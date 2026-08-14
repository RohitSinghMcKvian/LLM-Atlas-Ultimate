-- LLM Atlas — per-message image-output token count (§P13).
--
-- A model that draws bills the tokens the picture is made of at a rate 10–20×
-- its text rate: Gemini 2.5 Flash Image charges $30 per million image-output
-- tokens against $2.50 for text, and one image is about 1290 of them. Providers
-- report that count *inside* `completion_tokens`, so pricing the completion
-- total at the text rate under-reports an image turn by roughly an order of
-- magnitude, and there is no way to recover the split afterwards.
--
-- `cost_usd` is already persisted, so a synced message keeps the right number
-- even without this column. What the column adds is the ability to *recompute*
-- — after a price correction, or when a row was written before its usage event
-- arrived — and to show the breakdown rather than one opaque total.
--
-- Nullable with no default: absent means "not reported", which is a different
-- claim from zero. Every existing row is therefore priced exactly as it was
-- before this migration.
--
-- Reverse with 0014_message_image_tokens_down.sql.

alter table messages add column if not exists image_tokens integer;

alter table messages
  drop constraint if exists messages_image_tokens_nonneg;

-- A negative count would flip the sign of the turn's cost. The upper bound is
-- deliberately not constrained here: `completion_tokens` can legitimately be
-- null on an in-flight row, so "image tokens must not exceed it" is not a check
-- the row can answer on its own. `lib/chat/cost.ts` clamps instead.
alter table messages
  add constraint messages_image_tokens_nonneg
  check (image_tokens is null or image_tokens >= 0);
