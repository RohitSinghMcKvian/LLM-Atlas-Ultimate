-- LLM Atlas — persisted model-catalog snapshots for the daily provider sync.
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--
-- Persistence is OPTIONAL. Without it the app serves the bundled catalog and
-- re-syncs in-process on a cold start; with it, every server instance shares one
-- snapshot and the sync survives restarts. Nothing here is required for the app
-- to run.
--
-- SECURITY NOTE: same permissive-RLS posture as 0001/0002 — single-tenant
-- default. These two tables hold no user data (public model metadata and sync
-- telemetry only), but HARDEN alongside the rest before any multi-user deploy.

-- ── Snapshots ───────────────────────────────────────────────────────────────
-- One row per distinct catalog version. `version` is a content hash, so a sync
-- that changed nothing upstream collides with the row already stored and is
-- skipped rather than duplicating ~400 KB of jsonb every day.
create table if not exists catalog_snapshots (
  id           uuid primary key default gen_random_uuid(),
  -- FNV-1a hash of the model list. See lib/catalog/sync/normalize.ts.
  version      text not null unique,
  synced_at    timestamptz not null default now(),
  -- 'synced' when at least one provider list was fetched, else 'baseline'.
  origin       text not null default 'synced',
  model_count  int not null,
  -- The full CatalogSnapshotRecord, including the server-only bookkeeping
  -- (firstSeen / missCount / tombstones / sources) that never reaches a client.
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists catalog_snapshots_synced_idx
  on catalog_snapshots (synced_at desc);

-- ── Sync run log ────────────────────────────────────────────────────────────
-- Kept even when a run is rejected by the sanity gates, so a catalog that has
-- silently stopped updating is diagnosable without server logs.
create table if not exists catalog_sync_runs (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  ok               boolean not null default false,
  -- { [providerId]: { status, count, ms?, error? } }
  provider_results jsonb not null default '{}',
  warnings         jsonb not null default '[]',
  model_count      int,
  diff_count       int
);

create index if not exists catalog_sync_runs_started_idx
  on catalog_sync_runs (started_at desc);

-- ── RLS (permissive default — HARDEN before multi-user) ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['catalog_snapshots','catalog_sync_runs']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I_all on %I;', t, t);
    execute format(
      'create policy %I_all on %I for all using (true) with check (true);', t, t);
  end loop;
end $$;
