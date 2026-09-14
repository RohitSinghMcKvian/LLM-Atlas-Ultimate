-- LLM Atlas — the quota ledger.
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--
-- Persistence is OPTIONAL, exactly like 0003. Without it the app counts in
-- process: correct for a single instance, under-counting across several, and
-- forgotten on recycle. With it, every instance sharing one operator key agrees
-- about how much of that key's free tier is already spent. Nothing here is
-- required for the app to run — see lib/quota/ledger.ts, which falls back
-- silently and never fails a request because this table is absent.
--
-- SECURITY NOTE: same permissive-RLS posture as 0001/0002/0003 — single-tenant
-- default. Rows here are spend counters, not user data, but HARDEN alongside
-- the rest before any multi-user deploy.

-- ── Counters ────────────────────────────────────────────────────────────────
-- One row per (subject, lane, window). Windows are TUMBLING: `window_start` is
-- the floor of the containing minute/day/month, computed by the application
-- (lib/quota/windows.ts) and passed in, NOT derived here with date_trunc.
--
-- That is deliberate. date_trunc respects the session TimeZone, so a Postgres
-- session on anything but UTC would put the month boundary in a different place
-- than the app does, and every month would silently split into two counters.
-- One definition, in tested TypeScript, is worth more than a clever default.
--
-- Old rows are never read — a window that has rolled over simply has no row for
-- the new one — so cleanup is housekeeping, not correctness. See the sweep at
-- the bottom.
create table if not exists usage_counters (
  -- 'operator' for the shared operator key. A provider's free tier applies to
  -- the KEY, so everyone served by it spends from one pool and must count
  -- against one subject. Reserved for future per-caller shares.
  subject      text        not null,
  -- ProviderId, e.g. 'groq'.
  lane         text        not null,
  -- 'minute' | 'day' | 'month'
  window_kind  text        not null,
  window_start timestamptz not null,
  requests     int         not null default 0,
  tokens       bigint      not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (subject, lane, window_kind, window_start)
);

-- Serves the read path (subject + lane + recent windows) directly.
create index if not exists usage_counters_window_idx
  on usage_counters (subject, window_start desc);

-- ── bump_usage ──────────────────────────────────────────────────────────────
-- Record one request, and optionally its tokens, against every window at once.
--
-- A single statement with ON CONFLICT rather than a read-then-write: two
-- instances incrementing the same counter concurrently must not lose one of the
-- increments, and `requests + 1` evaluated inside the UPDATE is atomic where a
-- round trip through the application is not.
--
-- Requests and tokens are counted by SEPARATE calls, which is why p_requests is
-- a parameter rather than a hardcoded 1. A request is known the instant a route
-- commits; its token count is not known until the stream reports usage, and
-- waiting for that before counting the request would leave a caller who
-- disconnects mid-stream entirely uncounted. So: requests bumped at commit,
-- tokens bumped (with p_requests = 0) when the usage frame arrives.
--
-- p_windows is [{"kind":"minute","start":"2026-09-10T13:47:00.000Z"}, ...] so
-- the application owns the window arithmetic (see the note above).
create or replace function bump_usage(
  p_subject  text,
  p_lane     text,
  p_requests int,
  p_tokens   bigint,
  p_windows  jsonb
) returns void
language sql
as $$
  insert into usage_counters (subject, lane, window_kind, window_start, requests, tokens)
  select
    p_subject,
    p_lane,
    w->>'kind',
    (w->>'start')::timestamptz,
    greatest(coalesce(p_requests, 0), 0),
    greatest(coalesce(p_tokens, 0), 0)
  from jsonb_array_elements(p_windows) as w
  on conflict (subject, lane, window_kind, window_start) do update
    set requests   = usage_counters.requests + greatest(coalesce(p_requests, 0), 0),
        tokens     = usage_counters.tokens + greatest(coalesce(p_tokens, 0), 0),
        updated_at = now();
$$;

-- ── raise_usage ─────────────────────────────────────────────────────────────
-- Reconcile a counter upward to the provider's own figure.
--
-- MONOTONE ON PURPOSE. The provider's headers are authoritative about spend
-- Atlas never saw (another deployment sharing the key, a request counted but
-- never completed), so they may only ever RAISE a counter — `greatest`, not
-- assignment. Lowering would discard requests this instance has just made and
-- the provider has not yet reflected, handing back allowance that is already
-- gone, and two instances reconciling against slightly different snapshots
-- would otherwise flap the counter up and down.
--
-- p_windows is [{"kind":"day","start":"…","requests":90,"tokens":0}, …].
create or replace function raise_usage(
  p_subject text,
  p_lane    text,
  p_windows jsonb
) returns void
language sql
as $$
  insert into usage_counters (subject, lane, window_kind, window_start, requests, tokens)
  select
    p_subject,
    p_lane,
    w->>'kind',
    (w->>'start')::timestamptz,
    greatest(coalesce((w->>'requests')::int, 0), 0),
    greatest(coalesce((w->>'tokens')::bigint, 0), 0)
  from jsonb_array_elements(p_windows) as w
  on conflict (subject, lane, window_kind, window_start) do update
    set requests   = greatest(usage_counters.requests, excluded.requests),
        tokens     = greatest(usage_counters.tokens, excluded.tokens),
        updated_at = now();
$$;

-- ── sweep_usage_counters ────────────────────────────────────────────────────
-- Housekeeping only. Minute rows are the bulk of the table and become unread
-- the moment their window closes; without a sweep the table grows forever.
-- Safe to call from a cron job, or never.
create or replace function sweep_usage_counters(p_keep_days int default 40)
returns bigint
language plpgsql
as $$
declare
  removed bigint;
begin
  delete from usage_counters
  where window_start < now() - make_interval(days => greatest(p_keep_days, 1))
     -- Minute windows are dead within the hour; do not keep them for weeks.
     or (window_kind = 'minute' and window_start < now() - interval '1 day');
  get diagnostics removed = row_count;
  return removed;
end $$;

-- ── RLS (permissive default — HARDEN before multi-user) ─────────────────────
alter table usage_counters enable row level security;
drop policy if exists usage_counters_all on usage_counters;
create policy usage_counters_all on usage_counters for all using (true) with check (true);
