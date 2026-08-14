-- LLM Atlas — account profiles and roles
--
-- Until now identity was entirely `auth.users`: migration 0005 scopes every row
-- to `auth.uid()` and nothing else was needed, because there was nothing else to
-- know about a person. Sign-in is now a real product surface (OAuth, magic link,
-- one-time code) and two facts have to live somewhere queryable:
--
--   1. Display identity — the name and avatar Google and GitHub hand over. They
--      arrive on `auth.users.raw_user_meta_data`, which the anon client cannot
--      read; mirroring them into a public table is what lets the account menu
--      render without a service-role round trip.
--   2. Role — `user` | `admin` | `owner`. `/admin` is gated on it.
--
-- Shape of the change:
--   * `profiles`, one row per auth user, created by a trigger on signup so no
--     application code can forget to create it and no account can exist without
--     one. `on delete cascade` means deleting the auth user takes the profile.
--   * `is_admin()` is `security definer`. That is load-bearing, not incidental:
--     an admin policy ON profiles that itself SELECTs profiles would recurse
--     into the policy it is evaluating. Running as the owner side-steps RLS for
--     that one lookup. `set search_path = public` stops a caller-controlled
--     search_path from resolving `profiles` to some other table.
--   * A BEFORE UPDATE trigger pins `role`. RLS `with check` can only accept or
--     reject a whole row, so it cannot express "you may edit any column except
--     this one" — without the trigger, `profiles_update_own` would let anyone
--     make themselves an admin with a one-line PATCH.
--
-- Policies stay split per operation, matching 0005.
--
-- Reverse with 0011_profiles_roles_down.sql.

-- ── Table ───────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  role         text not null default 'user' check (role in ('user', 'admin', 'owner')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists profiles_role_idx on profiles(role);

alter table profiles enable row level security;

-- Reuses touch_updated_at() from 0001_init.sql.
drop trigger if exists profiles_touch on profiles;
create trigger profiles_touch before update on profiles
  for each row execute function touch_updated_at();

-- ── Signup trigger ──────────────────────────────────────────────────────────
-- Providers disagree on where the display name lives: Google sends `full_name`
-- and `picture`, GitHub sends `user_name` and `avatar_url`, an email-only signup
-- sends nothing at all. Coalesce across them and fall back to the local part of
-- the address so the account menu is never blank.
--
-- `security definer` because the trigger fires as the anon role during signup,
-- which has no insert privilege on profiles.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name',
      new.raw_user_meta_data ->> 'preferred_username',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  -- A retried signup must not abort the auth insert.
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Role helper ─────────────────────────────────────────────────────────────
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'owner')
  );
$$;

-- ── Role pin ────────────────────────────────────────────────────────────────
-- Self-promotion guard. Anyone may edit their own display name; only an admin
-- may change a role, and nobody may change their own.
create or replace function pin_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if not is_admin() or auth.uid() = old.id then
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_pin_role on profiles;
create trigger profiles_pin_role before update on profiles
  for each row execute function pin_profile_role();

-- ── Policies ────────────────────────────────────────────────────────────────
drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles
  for select using (id = auth.uid());

drop policy if exists profiles_select_admin on profiles;
create policy profiles_select_admin on profiles
  for select using (is_admin());

-- `with check` repeats the `using` clause so an update cannot re-point a row at
-- another account, matching the pattern established in 0005.
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_update_admin on profiles;
create policy profiles_update_admin on profiles
  for update using (is_admin()) with check (is_admin());

-- No insert policy: rows come from the signup trigger, which runs as definer.
-- No delete policy: profiles die with their auth user via the cascade.

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Accounts that existed before this migration never fired the trigger.
insert into profiles (id, email, display_name, avatar_url)
select
  u.id,
  u.email,
  coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    u.raw_user_meta_data ->> 'user_name',
    u.raw_user_meta_data ->> 'preferred_username',
    split_part(coalesce(u.email, ''), '@', 1)
  ),
  coalesce(
    u.raw_user_meta_data ->> 'avatar_url',
    u.raw_user_meta_data ->> 'picture'
  )
from auth.users u
on conflict (id) do nothing;

-- ── Promoting the first admin ───────────────────────────────────────────────
-- There is deliberately no way to do this from the app: the role pin above
-- blocks self-promotion by design, so the first admin has to be made here or in
-- the Supabase SQL editor. Substitute the address and run once.
--
-- update profiles set role = 'owner' where email = 'you@example.com';
