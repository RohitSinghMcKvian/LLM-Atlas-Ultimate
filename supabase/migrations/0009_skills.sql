-- LLM Atlas — installed skills (spec §4, Skills).
--
-- Mirrors the `skills` object store added in lib/chat/idb.ts at DB_VERSION 5.
-- As with memory in 0008 and projects in P3, no driver writes here yet: skills
-- are browser-local until the RLS posture from 0005 is verified against a live
-- database. The schema lands now so enabling sync is a driver, not a driver plus
-- a migration.
--
-- Reverse with 0009_skills_down.sql.

create table if not exists skills (
  user_id     uuid not null default auth.uid(),
  -- Slug derived from the skill directory name, or from `name`. Stable across
  -- renames on purpose: the model is told about a skill by id, and letting a
  -- rename change it would silently make it a different skill.
  id          text not null,
  name        text not null,
  -- The only field always present in the system prompt, hence the length cap:
  -- it is paid for on every request. Matches MAX_DESCRIPTION_CHARS in parse.ts.
  description text not null check (char_length(description) <= 500),
  body        text not null,
  -- NULL means unrestricted; an empty array means "no tools at all". The two are
  -- different declarations and the column preserves that distinction — do not
  -- collapse NULL and '{}' here or in any driver written against this table.
  allowed_tools text[],
  version     text,
  -- 'builtin' | 'user'. A built-in the user edits becomes 'user'.
  source      text not null default 'user' check (source in ('builtin', 'user')),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists skills_user_enabled_idx on skills(user_id, enabled);

drop trigger if exists skills_touch on skills;
create trigger skills_touch before update on skills
  for each row execute function touch_updated_at();

-- ── RLS, matching the posture set by 0005 ───────────────────────────────────
-- Owner-scoped with no shared-read path. Skills are executable instructions the
-- model follows, so a skill readable across accounts would be a way to influence
-- someone else's assistant; publishing, if it is ever built, needs its own
-- explicit opt-in column and policy rather than a relaxation of these.
alter table skills enable row level security;

do $$
begin
  execute 'create policy skills_select on skills for select using (user_id = auth.uid())';
  execute 'create policy skills_insert on skills for insert with check (user_id = auth.uid())';
  execute 'create policy skills_update on skills for update using (user_id = auth.uid()) with check (user_id = auth.uid())';
  execute 'create policy skills_delete on skills for delete using (user_id = auth.uid())';
exception when duplicate_object then null;
end $$;
