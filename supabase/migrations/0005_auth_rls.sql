-- LLM Atlas — auth-scoped row level security (spec §1.9)
--
-- Supersedes the permissive posture of 0001–0004. Those migrations enabled RLS
-- but attached `for all using (true) with check (true)` to every table, which
-- with the browser anon key meant any visitor could read or write any row —
-- every conversation, message, and code session in the database. That was
-- documented as a single-tenant default; this migration makes multi-user safe.
--
-- Shape of the change:
--   * Owner tables (they carry user_id) are scoped to `user_id = auth.uid()`,
--     with the column defaulting to auth.uid() so inserts fill it themselves.
--   * Child tables have no user_id. Rather than denormalize one onto them, they
--     inherit access through an EXISTS check against their parent, so ownership
--     stays in exactly one place and cannot drift.
--   * Operator tables (catalog/news snapshots) become world-readable but
--     write-locked. The sync jobs use the service-role key, which bypasses RLS.
--
-- Policies are split per operation instead of `for all` so that a future
-- read-only share link can relax select without also opening writes.
--
-- IMPORTANT — pre-existing rows: every user_id is currently NULL, so those rows
-- become invisible to everyone once these policies apply (NULL = auth.uid() is
-- never true). They are not deleted. To claim them for a single existing
-- account, run the backfill at the bottom of this file with that account's id.
--
-- Reverse with 0005_auth_rls_down.sql.

-- ── Owner tables: default user_id to the caller ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'projects','conversations','playground_experiments','code_sessions',
    'embeddings','eval_datasets','eval_suites','prompt_versions'
  ]
  loop
    execute format('alter table %I alter column user_id set default auth.uid();', t);
    execute format('create index if not exists %I_user_idx on %I(user_id);', t, t);
  end loop;
end $$;

-- ── Drop the permissive policies from 0001–0004 ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'projects','project_files','conversations','branches','messages',
    'playground_experiments','playground_runs','code_sessions','embeddings',
    'eval_datasets','eval_suites','eval_runs','prompt_versions',
    'catalog_snapshots','catalog_sync_runs','news_snapshots','news_sync_runs'
  ]
  loop
    -- to_regclass keeps this migration idempotent if a later table is absent.
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table %I enable row level security;', t);
      execute format('drop policy if exists %I_all on %I;', t, t);
    end if;
  end loop;
end $$;

-- ── Owner-scoped policies ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'projects','conversations','playground_experiments','code_sessions',
    'embeddings','eval_datasets','eval_suites','prompt_versions'
  ]
  loop
    execute format(
      'create policy %I_select on %I for select using (user_id = auth.uid());', t, t);
    execute format(
      'create policy %I_insert on %I for insert with check (user_id = auth.uid());', t, t);
    -- Both clauses: `using` gates which rows may be targeted, `with check` stops
    -- an update from reassigning a row to another user.
    execute format(
      'create policy %I_update on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid());', t, t);
    execute format(
      'create policy %I_delete on %I for delete using (user_id = auth.uid());', t, t);
  end loop;
end $$;

-- ── Child tables: inherit ownership from the parent row ─────────────────────
-- (child table, parent table, fk column on child)
do $$
declare r record;
begin
  for r in
    select * from (values
      ('project_files',   'projects',               'project_id'),
      ('branches',        'conversations',          'conversation_id'),
      ('messages',        'conversations',          'conversation_id'),
      ('playground_runs', 'playground_experiments', 'experiment_id'),
      ('eval_runs',       'eval_suites',            'suite_id')
    ) as v(child, parent, fk)
  loop
    execute format(
      'create policy %I_select on %I for select using (exists (select 1 from %I p where p.id = %I.%I and p.user_id = auth.uid()));',
      r.child, r.child, r.parent, r.child, r.fk);
    execute format(
      'create policy %I_insert on %I for insert with check (exists (select 1 from %I p where p.id = %I.%I and p.user_id = auth.uid()));',
      r.child, r.child, r.parent, r.child, r.fk);
    execute format(
      'create policy %I_update on %I for update using (exists (select 1 from %I p where p.id = %I.%I and p.user_id = auth.uid())) with check (exists (select 1 from %I p where p.id = %I.%I and p.user_id = auth.uid()));',
      r.child, r.child, r.parent, r.child, r.fk, r.parent, r.child, r.fk);
    execute format(
      'create policy %I_delete on %I for delete using (exists (select 1 from %I p where p.id = %I.%I and p.user_id = auth.uid()));',
      r.child, r.child, r.parent, r.child, r.fk);
  end loop;
end $$;

-- ── Operator tables: public read, writes only via the service role ──────────
-- The catalog and news snapshots are not user data; every visitor needs them,
-- including signed-out ones. No insert/update/delete policy is created, so RLS
-- denies those to anon and authenticated alike. The sync routes use the
-- service-role key, which bypasses RLS entirely.
do $$
declare t text;
begin
  foreach t in array array[
    'catalog_snapshots','catalog_sync_runs','news_snapshots','news_sync_runs'
  ]
  loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('create policy %I_public_read on %I for select using (true);', t, t);
    end if;
  end loop;
end $$;

-- ── match_embeddings: stop it from bypassing RLS ────────────────────────────
-- A `security definer` function would run as its owner and see every row. This
-- one is `security invoker` (the default for SQL functions) so the embeddings
-- policies above still apply, but the explicit auth.uid() filter means the
-- caller cannot widen the search by passing a different match_user.
create or replace function match_embeddings(
  query_embedding vector(1536),
  match_scope     text default null,
  match_user      uuid default null,
  match_count     int  default 6
) returns table (
  id uuid, ref_id uuid, content text, metadata jsonb, similarity float
) language sql stable security invoker as $$
  select e.id, e.ref_id, e.content, e.metadata,
         1 - (e.embedding <=> query_embedding) as similarity
  from embeddings e
  where (match_scope is null or e.scope = match_scope)
    and e.user_id = auth.uid()
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- ── Optional: claim pre-existing rows for one account ───────────────────────
-- Existing data predates auth and has user_id = NULL, so it is now unreachable.
-- To adopt it, uncomment and substitute the account's uuid (Supabase dashboard
-- → Authentication → Users), then run once.
--
-- do $$
-- declare t text; owner uuid := '00000000-0000-0000-0000-000000000000';
-- begin
--   foreach t in array array[
--     'projects','conversations','playground_experiments','code_sessions',
--     'embeddings','eval_datasets','eval_suites','prompt_versions'
--   ]
--   loop
--     execute format('update %I set user_id = $1 where user_id is null;', t) using owner;
--   end loop;
-- end $$;
