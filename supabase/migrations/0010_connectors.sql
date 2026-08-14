-- LLM Atlas — MCP connectors (spec §4, Connectors).
--
-- Mirrors the `connectors` object store added in lib/chat/idb.ts at
-- DB_VERSION 6. As with skills in 0009 and memory in 0008, no driver writes here
-- yet: connectors are browser-local until the RLS posture from 0005 is verified
-- against a live database.
--
-- READ THE TOKEN NOTE BELOW BEFORE WRITING A SYNC DRIVER.
--
-- Reverse with 0010_connectors_down.sql.

create table if not exists connectors (
  user_id     uuid not null default auth.uid(),
  id          text not null,
  name        text not null,
  -- Always https and never a private address; enforced in lib/mcp/url-guard.ts
  -- before any request. The check here is a second line, not the first.
  url         text not null check (url like 'https://%'),
  enabled     boolean not null default true,

  -- ── Tokens ───────────────────────────────────────────────────────────────
  -- These columns hold the SEALED form produced by lib/crypto/secret-box.ts
  -- ('atlas1.<iv>.<ciphertext>'), which is encrypted under a non-extractable key
  -- that never leaves the user's browser. The server therefore cannot read them,
  -- and that is the point: §1.3 says credentials are held in-browser only.
  --
  -- A sync driver MUST NOT write a plaintext token into these columns. Doing so
  -- would move a third-party bearer credential onto Atlas's server, which is
  -- exactly what the encryption exists to prevent — and unlike a provider key it
  -- would be a credential for someone else's system.
  sealed_token         text,
  sealed_refresh_token text,
  expires_at           timestamptz,
  -- Public by definition for a PKCE public client; not a secret.
  client_id            text,

  -- Cached tool descriptors from the last successful tools/list.
  tools       jsonb not null default '[]'::jsonb,
  protocol_version text,
  -- Per-tool approval rules, keyed by the namespaced tool name.
  -- {"mcp__cal__create_event": "always"}. Absent means ask, which is the default
  -- and is deliberately not representable as a stored "allow".
  approvals   jsonb not null default '{}'::jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists connectors_user_enabled_idx on connectors(user_id, enabled);

drop trigger if exists connectors_touch on connectors;
create trigger connectors_touch before update on connectors
  for each row execute function touch_updated_at();

-- ── RLS, matching the posture set by 0005 ───────────────────────────────────
-- Owner-scoped, no shared-read path, no exceptions. A connector row carries a
-- credential for a third-party account; cross-account readability here would be
-- an account-takeover primitive, not an information leak.
alter table connectors enable row level security;

do $$
begin
  execute 'create policy connectors_select on connectors for select using (user_id = auth.uid())';
  execute 'create policy connectors_insert on connectors for insert with check (user_id = auth.uid())';
  execute 'create policy connectors_update on connectors for update using (user_id = auth.uid()) with check (user_id = auth.uid())';
  execute 'create policy connectors_delete on connectors for delete using (user_id = auth.uid())';
exception when duplicate_object then null;
end $$;
