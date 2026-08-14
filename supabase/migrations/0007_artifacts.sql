-- LLM Atlas — artifact persistence, version history, and window.storage (spec §4).
--
-- Until now artifacts were re-derived from message text on every render. They
-- had no identity, so nothing could be attached to them: no stable key for
-- `window.storage`, no publish target, and no revert beyond scrolling a
-- scrubber over whatever happened to be in the thread.
--
-- Mirrors the IndexedDB stores created in lib/chat/idb.ts, so the local-first
-- driver and the synced driver hold the same shape.
--
-- Identity: ONE artifact per conversation, matching the panel's UX of a single
-- evolving document. Claude supports several distinct artifacts per
-- conversation; Atlas does not yet. Recorded as a known gap, not designed out —
-- dropping the unique constraint below is all this schema needs to allow it.
--
-- Reverse with 0007_artifacts_down.sql.

create table if not exists artifacts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  -- html | svg | markdown | code | mermaid | react
  kind            text not null,
  title           text not null default 'Artifact',
  -- Which version the panel shows. Reverting moves this pointer; it never deletes.
  current_version int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- One artifact per conversation (see the identity note above).
create unique index if not exists artifacts_conversation_uniq on artifacts(conversation_id);
create index if not exists artifacts_user_idx on artifacts(user_id);

-- Immutable history. Rows are inserted, and updated only when the SAME
-- assistant turn is regenerated; a revert never deletes one.
create table if not exists artifact_versions (
  id             uuid primary key default gen_random_uuid(),
  artifact_id    uuid not null references artifacts(id) on delete cascade,
  version_number int not null,
  -- Assistant message that produced it. No FK: branch pruning may remove the
  -- message, and losing the version with it would defeat the point.
  message_id     uuid,
  kind           text not null,
  lang           text not null default '',
  title          text not null default '',
  code           text not null,
  created_at     timestamptz not null default now()
);
create unique index if not exists artifact_versions_number_uniq
  on artifact_versions(artifact_id, version_number);
create index if not exists artifact_versions_artifact_idx on artifact_versions(artifact_id);

-- Backing store for `window.storage` inside sandboxed artifact iframes. The
-- frame is origin-isolated and has no storage of its own, so the host proxies
-- reads and writes here over postMessage.
create table if not exists artifact_storage (
  artifact_id uuid not null references artifacts(id) on delete cascade,
  key         text not null,
  value       jsonb,
  -- Reserved for cross-artifact sharing; always false today.
  shared      boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (artifact_id, key)
);

drop trigger if exists artifacts_touch on artifacts;
create trigger artifacts_touch before update on artifacts
  for each row execute function touch_updated_at();

-- ── RLS, matching the posture set by 0005 ───────────────────────────────────
-- `artifacts` is owner-scoped. The two child tables inherit through their
-- parent, so ownership lives in exactly one place and cannot drift.
alter table artifacts enable row level security;
alter table artifact_versions enable row level security;
alter table artifact_storage enable row level security;

do $$
begin
  execute 'create policy artifacts_select on artifacts for select using (user_id = auth.uid())';
  execute 'create policy artifacts_insert on artifacts for insert with check (user_id = auth.uid())';
  execute 'create policy artifacts_update on artifacts for update using (user_id = auth.uid()) with check (user_id = auth.uid())';
  execute 'create policy artifacts_delete on artifacts for delete using (user_id = auth.uid())';
exception when duplicate_object then null;
end $$;

do $$
declare t text; op text;
begin
  foreach t in array array['artifact_versions','artifact_storage']
  loop
    execute format(
      'create policy %I_select on %I for select using (exists (select 1 from artifacts a where a.id = %I.artifact_id and a.user_id = auth.uid()));', t, t, t);
    execute format(
      'create policy %I_insert on %I for insert with check (exists (select 1 from artifacts a where a.id = %I.artifact_id and a.user_id = auth.uid()));', t, t, t);
    execute format(
      'create policy %I_update on %I for update using (exists (select 1 from artifacts a where a.id = %I.artifact_id and a.user_id = auth.uid())) with check (exists (select 1 from artifacts a where a.id = %I.artifact_id and a.user_id = auth.uid()));', t, t, t, t);
    execute format(
      'create policy %I_delete on %I for delete using (exists (select 1 from artifacts a where a.id = %I.artifact_id and a.user_id = auth.uid()));', t, t, t);
  end loop;
exception when duplicate_object then null;
end $$;
