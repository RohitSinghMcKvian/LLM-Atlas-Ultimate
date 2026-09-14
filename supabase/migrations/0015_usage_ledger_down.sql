-- Reverses 0015_usage_ledger.sql.
--
-- Dropping the table discards every spend counter. Nothing else depends on
-- them: lib/quota/ledger.ts falls back to its in-process tier the moment the
-- table is gone, so the app keeps serving — it simply forgets what the
-- operator's key has already spent this window, and may over-serve a free tier
-- once before the provider's own headers correct it.

drop function if exists sweep_usage_counters(int);
drop function if exists raise_usage(text, text, jsonb);
drop function if exists bump_usage(text, text, int, bigint, jsonb);
drop table if exists usage_counters;
