-- LLM Atlas — Web Push subscriptions for the daily AI news brief.
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--
-- Persistence is OPTIONAL, but it is much more load-bearing here than it is for
-- the news corpus. Without it, subscriptions live in the process that took them
-- and a serverless cold start loses every one — so the hourly digest cron, which
-- runs in a different invocation entirely, would find an empty table and send
-- nothing at all. A single-instance or long-lived deployment works fine on the
-- in-memory tier; a serverless one needs this table for the feature to function.
--
-- SECURITY NOTE: unlike 0004, THIS TABLE HOLDS USER DATA. A push endpoint is a
-- bearer credential — anyone holding it can send that device a notification —
-- and the row also carries a delivery-hour preference, which is a coarse
-- location signal. The permissive-RLS posture inherited from 0001–0004 is
-- therefore *more* dangerous here, and the anon key must never be allowed to
-- read this table. The policy below is service-role only, breaking with the
-- pattern deliberately. Harden the rest of the schema to match.

-- ── Subscriptions ───────────────────────────────────────────────────────────
create table if not exists news_push_subscriptions (
  -- SHA-256 of the endpoint, base64url. Deriving the key means re-subscribing
  -- the same device upserts onto its existing row instead of accumulating a new
  -- one on every visit, and it keeps the raw endpoint out of every log line,
  -- index name and foreign key that a primary key would otherwise leak into.
  id            text primary key,
  -- { endpoint, expirationTime, keys: { p256dh, auth } }
  subscription  jsonb not null,
  -- { cadence, hour, utcOffsetMinutes, topics, verifiedOnly, maxStories }
  preferences   jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Last digest actually delivered. The dispatcher reads this to stay idempotent
  -- across the hourly cron: a subscriber whose local hour is 08:00 must receive
  -- one brief that morning even if the job runs twice.
  last_sent_at  timestamptz,
  -- Consecutive ambiguous failures (5xx, timeouts). A 404/410 deletes the row
  -- outright; this is for the endpoint that might simply be a phone that is off.
  failures      int not null default 0
);

-- The dispatcher's access pattern: every subscriber whose local hour matches
-- this run, ordered so a bounded batch is deterministic.
create index if not exists news_push_subscriptions_updated_idx
  on news_push_subscriptions (updated_at desc);

create index if not exists news_push_subscriptions_last_sent_idx
  on news_push_subscriptions (last_sent_at nulls first);

-- ── Delivery log ────────────────────────────────────────────────────────────
-- One row per digest run, not per message: a per-message log of a few thousand
-- sends an hour would dwarf the news corpus itself within a week, and the useful
-- question ("is the brief going out, and to how many people") is answered fine
-- at run granularity.
create table if not exists news_push_runs (
  id           uuid primary key default gen_random_uuid(),
  ran_at       timestamptz not null default now(),
  -- The UTC hour this run dispatched for.
  utc_hour     int not null,
  candidates   int not null default 0,
  sent         int not null default 0,
  failed       int not null default 0,
  -- Subscriptions deleted this run because the push service reported them gone.
  pruned       int not null default 0,
  -- The lead story's id, so a run can be traced back to what it announced.
  lead_article text,
  error        text
);

create index if not exists news_push_runs_ran_idx
  on news_push_runs (ran_at desc);

-- ── RLS: service role only ──────────────────────────────────────────────────
-- Deliberately NOT the permissive `using (true)` policy the earlier migrations
-- use. `using (true)` grants the anon key full read access, and the anon key
-- ships in the browser bundle — which would put every subscriber's push
-- credential one fetch away from any visitor. RLS is enabled with no policy at
-- all, so PostgREST denies anon and authenticated outright, while the
-- service-role key used by `getSupabaseServer()` bypasses RLS as it always has.
alter table news_push_subscriptions enable row level security;
alter table news_push_runs enable row level security;

drop policy if exists news_push_subscriptions_all on news_push_subscriptions;
drop policy if exists news_push_runs_all on news_push_runs;

revoke all on news_push_subscriptions from anon, authenticated;
revoke all on news_push_runs from anon, authenticated;
