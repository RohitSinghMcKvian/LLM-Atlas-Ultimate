-- LLM Atlas — persisted news corpus snapshots for the hourly feed sync.
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--
-- Persistence is OPTIONAL. Without it the app still syncs hourly and serves the
-- result, but each server instance keeps its own copy in process memory and a
-- cold start begins from the empty baseline until the first sweep completes.
-- With it, every instance shares one corpus and the sync survives restarts.
--
-- SECURITY NOTE: same permissive-RLS posture as 0001/0002/0003 — single-tenant
-- default. These two tables hold no user data (public article metadata and sync
-- telemetry only), but HARDEN alongside the rest before any multi-user deploy.

-- ── Snapshots ───────────────────────────────────────────────────────────────
-- One row per distinct corpus version. `version` is a content hash over article
-- identity only — deliberately NOT over scores or timestamps, which are
-- recency-derived and would otherwise change every hour. So an hour in which no
-- publisher shipped anything upserts onto the existing row instead of storing
-- another ~500 KB of jsonb. See `hashArticles` in lib/news/sync/merge.ts.
create table if not exists news_snapshots (
  id            uuid primary key default gen_random_uuid(),
  version       text not null unique,
  synced_at     timestamptz not null default now(),
  -- 'synced' once a sweep has produced articles, else 'baseline'.
  origin        text not null default 'synced',
  article_count int not null,
  -- The full NewsSnapshotRecord, including the server-only bookkeeping
  -- (validators / firstSeen / signatures / retired / per-source results) that
  -- never reaches a client.
  payload       jsonb not null,
  created_at    timestamptz not null default now()
);

create index if not exists news_snapshots_synced_idx
  on news_snapshots (synced_at desc);

-- ── Sync run log ────────────────────────────────────────────────────────────
-- Kept even when a run is rejected by the sanity gates, so a corpus that has
-- silently stopped updating — or a feed that has quietly rotted — is
-- diagnosable without server logs.
create table if not exists news_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  ok             boolean not null default false,
  -- { [feedId]: { status, items, fresh, ms?, httpStatus?, error? } }
  source_results jsonb not null default '{}',
  warnings       jsonb not null default '[]',
  article_count  int,
  cluster_count  int
);

create index if not exists news_sync_runs_started_idx
  on news_sync_runs (started_at desc);

-- ── RLS (permissive default — HARDEN before multi-user) ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['news_snapshots','news_sync_runs']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I_all on %I;', t, t);
    execute format(
      'create policy %I_all on %I for all using (true) with check (true);', t, t);
  end loop;
end $$;
