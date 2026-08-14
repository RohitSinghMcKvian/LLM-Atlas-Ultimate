-- LLM Atlas — memory files and memory metadata (spec §4.7).
--
-- Mirrors the IndexedDB stores added in lib/chat/idb.ts at DB_VERSION 4, so the
-- local-first driver and a future synced driver hold the same shape. As in P3,
-- nothing writes to these tables yet: memory is browser-local until the RLS
-- posture from 0005 has been verified against a live database. The schema lands
-- now so the sync path is a driver, not a migration plus a driver.
--
-- Note on what is deliberately NOT here: the past-chat search index
-- (`chat_chunks` in IndexedDB). Chunk vectors belong in the existing
-- `embeddings` table under `scope = 'chat:<conversation_id>'`, reusing
-- `match_embeddings`, rather than in a third parallel vector table. That write
-- path is deferred alongside the project one for the same reason.
--
-- Reverse with 0008_memory_down.sql.

-- The `/memories` filesystem the model edits with the six-command memory tool.
-- Keyed by (user_id, path): paths are already unique per user and are how the
-- tool addresses files, so there is no surrogate key to keep in sync.
create table if not exists memory_files (
  user_id    uuid not null default auth.uid(),
  -- Always absolute and under '/memories'. Confinement is enforced in
  -- lib/chat/memory-fs.ts before any storage call; the check below is a second
  -- line so a future writer cannot bypass it.
  path       text not null check (path like '/memories/%'),
  content    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

-- User-owned memory metadata: the editable summary, and the categorised facts
-- that back keyword recall. One row per user; the facts are jsonb because they
-- are read and written as a whole list, never queried field-by-field.
create table if not exists memory_profile (
  user_id    uuid primary key default auth.uid(),
  -- The user's own prose. Never regenerated server-side — once edited it is
  -- theirs, and overwriting it would discard a deliberate correction.
  summary    text not null default '',
  -- [{ id, content, source, category, createdAt }]
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists memory_files_user_idx on memory_files(user_id);

drop trigger if exists memory_files_touch on memory_files;
create trigger memory_files_touch before update on memory_files
  for each row execute function touch_updated_at();

drop trigger if exists memory_profile_touch on memory_profile;
create trigger memory_profile_touch before update on memory_profile
  for each row execute function touch_updated_at();

-- ── RLS, matching the posture set by 0005 ───────────────────────────────────
-- Both tables are owner-scoped directly; there is no parent to inherit from.
-- Memory is the most sensitive user data in the app after API keys, so these
-- are per-operation policies with no read-only escape hatch.
alter table memory_files enable row level security;
alter table memory_profile enable row level security;

do $$
declare t text;
begin
  foreach t in array array['memory_files','memory_profile']
  loop
    execute format('create policy %I_select on %I for select using (user_id = auth.uid());', t, t);
    execute format('create policy %I_insert on %I for insert with check (user_id = auth.uid());', t, t);
    execute format('create policy %I_update on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid());', t, t);
    execute format('create policy %I_delete on %I for delete using (user_id = auth.uid());', t, t);
  end loop;
exception when duplicate_object then null;
end $$;
