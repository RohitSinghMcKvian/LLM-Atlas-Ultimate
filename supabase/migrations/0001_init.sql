-- LLM Atlas — persistence & memory schema (§3.4)
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--
-- SECURITY NOTE: RLS is enabled with permissive policies so the app works
-- out of the box for a single-tenant / local / single-operator deploy. Before
-- any multi-user deploy, HARDEN every policy to scope rows by
-- `user_id = auth.uid()` and wire an auth layer.

create extension if not exists "pgcrypto";
create extension if not exists vector;

-- ── Projects (Chat §4.5) ────────────────────────────────────────────────────
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  name        text not null,
  instructions text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists project_files (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  mime        text,
  content     text,
  size_bytes  int,
  created_at  timestamptz not null default now()
);
create index if not exists project_files_project_idx on project_files(project_id);

-- ── Conversations & messages (Chat) ─────────────────────────────────────────
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  project_id  uuid references projects(id) on delete set null,
  title       text not null default 'New chat',
  model_id    text,
  pinned      boolean not null default false,
  style       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists conversations_project_idx on conversations(project_id);
create index if not exists conversations_updated_idx on conversations(updated_at desc);

-- A branch is a line through the message DAG (Chat §4.2 edit-fork + siblings).
create table if not exists branches (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references conversations(id) on delete cascade,
  parent_message_id uuid,
  created_at        timestamptz not null default now()
);
create index if not exists branches_conversation_idx on branches(conversation_id);

create table if not exists messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  branch_id        uuid references branches(id) on delete cascade,
  parent_id        uuid references messages(id) on delete cascade,
  role             text not null check (role in ('system','user','assistant','tool')),
  content          text not null default '',
  reasoning        text,
  model_id         text,
  tool_calls       jsonb,
  attachments      jsonb,
  artifacts        jsonb,
  prompt_tokens    int,
  completion_tokens int,
  cost_usd         numeric,
  created_at       timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages(conversation_id);
create index if not exists messages_branch_idx on messages(branch_id);
create index if not exists messages_parent_idx on messages(parent_id);

-- ── Playground (§5.7) ───────────────────────────────────────────────────────
create table if not exists playground_experiments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  name        text not null,
  config      jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists playground_runs (
  id            uuid primary key default gen_random_uuid(),
  experiment_id uuid references playground_experiments(id) on delete cascade,
  model_id      text not null,
  input         jsonb,
  output        text,
  metrics       jsonb,
  starred       boolean not null default false,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists playground_runs_experiment_idx on playground_runs(experiment_id);

-- ── Code sessions (§6.12) ───────────────────────────────────────────────────
create table if not exists code_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  name        text not null default 'Session',
  model_id    text,
  mode        text not null default 'ask',
  state       jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Semantic memory embeddings (§3.4 / §4.7) ────────────────────────────────
-- 1536 dims = OpenAI text-embedding-3-small (default). Change to match your
-- embedding model, then rebuild the index.
create table if not exists embeddings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  scope       text not null,
  ref_id      uuid,
  content     text not null,
  embedding   vector(1536),
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists embeddings_embedding_idx
  on embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists embeddings_scope_idx on embeddings(scope);

-- Cosine-similarity recall over the memory store (§4.7).
create or replace function match_embeddings(
  query_embedding vector(1536),
  match_scope     text default null,
  match_user      uuid default null,
  match_count     int  default 6
) returns table (
  id uuid, ref_id uuid, content text, metadata jsonb, similarity float
) language sql stable as $$
  select e.id, e.ref_id, e.content, e.metadata,
         1 - (e.embedding <=> query_embedding) as similarity
  from embeddings e
  where (match_scope is null or e.scope = match_scope)
    and (match_user is null or e.user_id = match_user)
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- Keep updated_at fresh.
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['projects','conversations','playground_experiments','code_sessions']
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
  foreach t in array array[
    'projects','project_files','conversations','branches','messages',
    'playground_experiments','playground_runs','code_sessions','embeddings'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I_all on %I;', t, t);
    execute format(
      'create policy %I_all on %I for all using (true) with check (true);', t, t);
  end loop;
end $$;
