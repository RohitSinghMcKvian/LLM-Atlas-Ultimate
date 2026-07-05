-- LLM Atlas — Depth Spec v2 additions: eval lab (D.1/D.2), prompt versioning
-- (D.7), and trace persistence for Code sessions (Part E / B.5 groundwork).
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--
-- SECURITY NOTE: same permissive-RLS posture as 0001 — single-tenant default.
-- HARDEN every policy to `user_id = auth.uid()` before any multi-user deploy.

-- ── Eval lab (D.1) ──────────────────────────────────────────────────────────
create table if not exists eval_datasets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  name        text not null,
  -- [{ id, input, vars?, expected? }]
  rows        jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists eval_suites (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid,
  name            text not null,
  dataset_id      uuid not null references eval_datasets(id) on delete cascade,
  prompt_template text not null default '',
  -- GraderDef: exact/contains/regex/json/json-schema/wordcount/llm-judge
  grader          jsonb not null,
  n_samples       int not null default 1,
  seed            int,
  -- Bumped whenever prompt/grader/dataset changes (D.2 regression tracking).
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists eval_suites_dataset_idx on eval_suites(dataset_id);

create table if not exists eval_runs (
  id            uuid primary key default gen_random_uuid(),
  suite_id      uuid not null references eval_suites(id) on delete cascade,
  -- Pinned at run time so deltas compare like with like.
  suite_version int not null,
  model_ids     jsonb not null default '[]',
  -- [{ modelId, rowId, samples: [{ output, pass, score?, latencyMs, costUsd }] }]
  cells         jsonb not null default '[]',
  -- [{ modelId, mean, stddev, ci95 }]
  aggregate     jsonb not null default '[]',
  cost_usd      numeric,
  created_at    timestamptz not null default now()
);
create index if not exists eval_runs_suite_idx on eval_runs(suite_id, created_at desc);

-- ── Prompt registry versioning (D.7) ────────────────────────────────────────
-- prompt_id is the client-side prompt id (nanoid text, not uuid).
create table if not exists prompt_versions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  prompt_id   text not null,
  version     int not null,
  body        text not null,
  tags        jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  unique (prompt_id, version)
);
create index if not exists prompt_versions_prompt_idx on prompt_versions(prompt_id, version desc);

-- ── Trace persistence (Part E: event-sourced trace; B.5 session model) ──────
-- The compacted TraceEvent[] for a session; `state` keeps the legacy
-- events/history projection for backward compatibility.
alter table code_sessions add column if not exists trace jsonb;

-- Keep updated_at fresh on the new mutable tables.
do $$
declare t text;
begin
  foreach t in array array['eval_datasets','eval_suites']
  loop
    execute format(
      'drop trigger if exists %I_touch on %I; create trigger %I_touch before update on %I for each row execute function touch_updated_at();',
      t, t, t, t);
  end loop;
end $$;

-- ── RLS (permissive default — HARDEN before multi-user) ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['eval_datasets','eval_suites','eval_runs','prompt_versions']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I_all on %I;', t, t);
    execute format(
      'create policy %I_all on %I for all using (true) with check (true);', t, t);
  end loop;
end $$;
