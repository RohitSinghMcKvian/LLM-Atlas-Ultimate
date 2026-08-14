# Claude Code handoff prompt — auth bring-up

Paste everything between the `---` markers into a fresh Claude Code session
started from the repo root (`D:\claude\Llm Atlas Ultimate`).

Fill in the two bracketed values first. Leave the rest verbatim — the
"do not do" section and the landmines are the parts that save time.

---

I'm bringing up Supabase auth on this Next.js app. You have the repo; I handle
anything behind a third-party dashboard. Work only in the repo.

## Verified current state — do not re-derive this, but do re-check before acting

- `.env.local` exists and is git-ignored (`.gitignore:32`, `.env*.local`). It
  currently holds **only** inference-provider config: `NVIDIA_API_KEY`,
  `OPENROUTER_API_KEY`, `OPENROUTER_SITE_URL`, `OPENROUTER_SITE_NAME`,
  `CATALOG_SYNC_SECRET`, `ATLAS_CATALOG_SYNC_INTERVAL_HOURS`,
  `ATLAS_FREE_OPEN_CEILING_PER_M`. No Supabase variables at all.
- `.env.example` documents the three that are missing: `NEXT_PUBLIC_SUPABASE_URL`
  (line 69), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (line 70), and commented
  `NEXT_PUBLIC_AUTH_PROVIDERS=google,github` (line 84). `SUPABASE_SERVICE_ROLE_KEY`
  is line 73.
- `supabase/` contains `migrations/` only — no `config.toml`. The CLI is **not**
  linked, so `supabase db push` will not work until someone runs `supabase link`.
  Assume migrations are applied by hand in the dashboard SQL Editor unless I say
  otherwise.
- Migration `supabase/migrations/0011_profiles_roles.sql` exists (with a `_down`)
  and creates the `profiles` table, the `handle_new_user` trigger, and a backfill.
- Auth routes already exist: `app/(auth)/login/page.tsx`,
  `app/(auth)/register/page.tsx`, `app/auth/callback/route.ts`,
  `app/auth/signout/route.ts`, `middleware.ts`.
- `lib/auth/providers.ts` drives the button list from `NEXT_PUBLIC_AUTH_PROVIDERS`,
  inlined at build time. Registry ids: `google`, `github`, `azure`, `apple`,
  `gitlab`, `discord`. Unknown ids are dropped silently.
- Supabase is **optional by design**. `middleware.ts:42-52`: with no url/anonKey
  it refreshes no session and gates nothing, so the app stays open and
  local-first — except `/admin`, which redirects unconditionally.
  `lib/supabase/client.ts` returns `null` from `getSupabaseBrowser()` and
  documents that callers must handle null.
- Scripts: `verify` = `typecheck && test`; `typecheck` = `tsc --noEmit`;
  `test` = `vitest run`. **`npm run lint` is `next lint`, which is not
  configured — it will try to interactively scaffold ESLint. Do not run it.**
- `dev:verify` and `dev:preview` use `set NEXT_DIST_DIR=...` — Windows `cmd`
  syntax. They will not work from bash/pwsh. Use plain `npm run dev` unless you
  need an isolated build dir.
- Branch `main`, with a large volume of unstaged modifications under `.agents/`.
  Do not stage or commit anything under `.agents/` — it is unrelated churn.

## Credentials I will paste when I have them

[PASTE: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY here, or say
"not yet" and start at Task 0.]

## Do not attempt

These are all behind an authenticated third-party dashboard. Do not try to
automate, script, or browser-drive them. If a task appears blocked on one of
these, stop and tell me which one.

- Creating the Supabase project, or reading keys from the dashboard
- Creating the GitHub OAuth app or Google Cloud OAuth client
- Enabling providers in Supabase Auth → Providers
- Setting Site URL / Redirect URLs in Auth → URL Configuration
- Editing the Magic Link email template
- Adding env vars in the Vercel dashboard

Also: never print the contents of `.env.local` in full, and never echo a secret
value back to me. Mask to the first 4 characters when you need to confirm a
variable is set.

## Tasks

### Task 0 — audit before touching anything

Read `middleware.ts`, `lib/supabase/client.ts`, `lib/supabase/server.ts`,
`lib/auth/providers.ts`, `app/auth/callback/route.ts`, and both
`app/(auth)/*/page.tsx`. Then tell me, in a short list:

1. What `/login` renders today with zero providers enabled — is it an empty
   panel, a bare email field, or something that looks broken?
2. Whether `app/auth/callback/route.ts` validates the `next` parameter against
   open redirects. Phase 8 step (l) tests `/login?next=//evil.com`; I want to
   know whether that test passes because of a guard you can point to, or by
   accident.
3. Whether the login/register split is actually enforced server-side — the
   claim is that an unknown email at `/login` is refused with "No Atlas account
   uses that address yet" while `/register` accepts it. Show me the code that
   distinguishes them, or tell me it doesn't exist.
4. Any place that calls `getSupabaseBrowser()` without a null check.

Do not fix anything yet. I want the report first.

### Task 1 — env wiring (blocked until I paste credentials)

Add to `.env.local`, preserving the existing commented style of that file:

```
NEXT_PUBLIC_SUPABASE_URL=<value I give you>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<value I give you>
NEXT_PUBLIC_AUTH_PROVIDERS=google,github
```

Only list a provider once I have confirmed its OAuth app exists and is enabled
in Supabase. A listed-but-unconfigured provider renders a button that 400s.
Ask me which are ready rather than assuming both.

Remind me that `NEXT_PUBLIC_*` is inlined at build time, so the dev server must
be restarted — a running server will not pick this up.

### Task 2 — verification

Run `npm run verify`. Expect green except a pre-existing failure in
`lib/catalog/sync/live.test.ts`, which is unrelated to auth. If anything else
fails, diagnose it before proceeding. Do not run `npm run lint`.

Then, with `npm run dev` running, check what you can from the shell — the
signed-out redirects are plain HTTP and need no browser:

| # | Check | Expect |
|---|---|---|
| a | GET `/leaderboard`, `/news`, `/docs` signed out | 200 |
| b | GET `/chat` signed out | 302 → `/login?next=%2Fchat` |
| c | GET `/admin` signed out | 302 → `/login?next=%2Fadmin` |
| l | GET `/login?next=//evil.com` then follow | lands on `/chat`, not an external host |

Report status codes and `Location` headers verbatim. Do not follow redirects
silently.

**Before credentials are in place, (b) will not redirect** — middleware gates
nothing with no url/anonKey, so `/chat` returns 200. That is correct behaviour,
not a bug. (c) *will* redirect, but via the no-credentials branch, not the role
check. Say which branch produced each result.

The remaining steps — provider consent screens, the OTP code, resend timer,
role flip — need a real browser and a real inbox. I'll do those by hand.

### Task 3 — write the runbook to the repo

Create `docs/auth-setup.md` capturing the full setup sequence: Supabase project,
migration 0011, GitHub OAuth app, Google Cloud OAuth client, provider enablement,
redirect allowlist, the `{{ .Token }}` email-template edit, env vars, the
verification matrix, the admin role flip, and production.

Include the troubleshooting table. Every row must name the phase that caused it:

| Symptom | Cause |
|---|---|
| Provider button does nothing, or flashes back to `/login` | Redirect URL missing from Auth → URL Configuration |
| `redirect_uri_mismatch` on the provider's page | Used the app's URL instead of `https://<ref>.supabase.co/auth/v1/callback` |
| Email arrives with a link but no code | `{{ .Token }}` not in the Magic Link template |
| No email at all | Supabase built-in SMTP is rate-limited; configure own SMTP |
| Google `access_denied` | Consent screen in Testing and the address isn't a test user |
| `/admin` redirects even as owner | Migration 0011 not applied, or no hard refresh after the SQL update |
| No buttons on `/login` | `NEXT_PUBLIC_AUTH_PROVIDERS` unset, or server not restarted |

State explicitly that the callback URL registered with GitHub and Google is
**Supabase's** (`https://<project-ref>.supabase.co/auth/v1/callback`), not the
app's `/auth/callback` — that is the second hop and the provider never sees it.

Also note that the middleware fails closed on the role check: a missing
`profiles` table or any query error reads as "not admin", never as admin. So a
broken 0011 shows up as `/admin` being locked, not open.

### Task 4 — ask before doing

`supabase/migrations/0005_auth_rls.sql` has a commented-out backfill near line
157 that claims pre-existing `user_id = NULL` rows for one account. Read it and
tell me what it would do and whether it is reversible. Do not run it. It is a
data decision, not a setup step.

## Working style

- Show me a diff before writing to `.env.local`.
- One task at a time. Stop at the end of each and wait.
- If a check fails, tell me which of the dashboard phases to go back to — the
  failure modes look identical from the app's side, and that mapping is the
  whole point of the troubleshooting table.
