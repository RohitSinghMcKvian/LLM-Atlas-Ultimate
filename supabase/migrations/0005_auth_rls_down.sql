-- Reverses 0005_auth_rls.sql, restoring the permissive single-tenant posture of
-- 0001–0004.
--
-- WARNING: applying this makes every row in these tables readable and writable
-- by anyone holding the anon key — which is shipped to the browser. Only run it
-- for a local or single-operator deployment that is not publicly reachable.
--
-- Rows written while 0005 was active keep their user_id; nothing is destroyed,
-- and re-applying 0005 restores per-user isolation exactly.

-- ── Drop the auth-scoped policies ───────────────────────────────────────────
do $$
declare t text; op text;
begin
  foreach t in array array[
    'projects','project_files','conversations','branches','messages',
    'playground_experiments','playground_runs','code_sessions','embeddings',
    'eval_datasets','eval_suites','eval_runs','prompt_versions'
  ]
  loop
    if to_regclass(format('public.%I', t)) is not null then
      foreach op in array array['select','insert','update','delete']
      loop
        execute format('drop policy if exists %I_%s on %I;', t, op, t);
      end loop;
    end if;
  end loop;

  foreach t in array array[
    'catalog_snapshots','catalog_sync_runs','news_snapshots','news_sync_runs'
  ]
  loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('drop policy if exists %I_public_read on %I;', t, t);
    end if;
  end loop;
end $$;

-- ── Drop the auth.uid() defaults added by 0005 ──────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'projects','conversations','playground_experiments','code_sessions',
    'embeddings','eval_datasets','eval_suites','prompt_versions'
  ]
  loop
    execute format('alter table %I alter column user_id drop default;', t);
  end loop;
end $$;

-- ── Restore the permissive policies ─────────────────────────────────────────
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
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table %I enable row level security;', t);
      execute format('drop policy if exists %I_all on %I;', t, t);
      execute format(
        'create policy %I_all on %I for all using (true) with check (true);', t, t);
    end if;
  end loop;
end $$;

-- ── Restore the unscoped match_embeddings ───────────────────────────────────
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
