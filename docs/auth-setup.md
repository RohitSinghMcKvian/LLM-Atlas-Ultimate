# Auth setup

How to take LLM Atlas from local-first-with-no-accounts to a deployment with real
sign-in. Sign-in is OAuth (Google, GitHub), a magic link, or a six-digit emailed
code — **Atlas never handles a password**, so there is no credential to store,
leak, or reset.

Most of this is dashboard work. The repo side is three environment variables.

> **Auth is optional by design.** With `NEXT_PUBLIC_SUPABASE_URL` and
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` unset, `middleware.ts` gates nothing, every
> surface stays open, and the app saves to the browser. `/login` renders a panel
> saying so rather than a form that cannot work. You are turning something on,
> not fixing something broken.

---

## Phases at a glance

| # | Phase | Where |
|---|---|---|
| 1 | Create the Supabase project | Supabase dashboard |
| 2 | Apply migrations, including 0011 | Supabase SQL Editor |
| 3 | Create the GitHub OAuth app | github.com |
| 4 | Create the Google Cloud OAuth client | console.cloud.google.com |
| 5 | Enable providers | Supabase → Authentication → Providers |
| 6 | Set Site URL and the redirect allowlist | Supabase → Authentication → URL Configuration |
| 7 | Add `{{ .Token }}` to the Magic Link template | Supabase → Authentication → Email Templates |
| 8 | Set environment variables | `.env.local` |
| 9 | Verify | Your machine |
| 10 | Promote the first admin | Supabase SQL Editor |
| 11 | Production | Vercel + phases 3–6 again |

The troubleshooting table at the end maps every symptom back to one of these
numbers. That mapping matters because most failures look identical from the
app's side — a button that does nothing can be phase 5, 6, or 8.

---

## Phase 1 — Create the Supabase project

Supabase dashboard → **New project**. Note two things from
**Project Settings → API**:

- **Project URL** — `https://<project-ref>.supabase.co`
- **anon / public key** — safe to ship to the browser; it is what RLS evaluates
  `auth.uid()` against.

`<project-ref>` is the subdomain. You will paste it into GitHub and Google in
phases 3 and 4, so keep it to hand.

The **service_role** key on the same page bypasses RLS entirely. Auth does not
need it — only operator jobs like the catalog sync do. Never expose it to the
browser.

---

## Phase 2 — Apply the migrations

The Supabase CLI is **not linked** in this repo — there is no
`supabase/config.toml`, only `supabase/migrations/`. `supabase db push` will not
work until someone runs `supabase link --project-ref <ref>`. Until then, apply
migrations by hand:

Supabase → **SQL Editor** → paste the file contents → **Run**. In numeric order:

```
0001_init.sql        →  0011_profiles_roles.sql
```

Every migration from 0005 onward ships a matching `_down.sql` if you need to
reverse it.

### 0005 — RLS

Scopes every row to `auth.uid()`. After this, a signed-out client can read and
write nothing, which is why `lib/supabase/client.ts` requires a *session* and not
just configuration before it will use the remote driver.

> `0005_auth_rls.sql` has a **commented-out backfill** near line 152 that claims
> all pre-auth `user_id IS NULL` rows for one account. It is a data decision, not
> a setup step, and it is **not reversible** — once written, adopted rows are
> indistinguishable from rows that account genuinely owned. Leave it commented
> unless you have deliberately decided otherwise.

### 0011 — profiles and roles

The one auth depends on. It creates:

- the `profiles` table (`id`, `email`, `display_name`, `avatar_url`, `role`),
- the `handle_new_user()` trigger on `auth.users`, so a profile row exists for
  every account without any application code having to remember to create one,
- `is_admin()` (`security definer`, to avoid a policy that recurses into itself),
- a `pin_profile_role()` BEFORE UPDATE trigger that blocks self-promotion,
- a backfill for accounts that predate the migration.

**Check it landed:**

```sql
select count(*) from profiles;
```

An error here rather than a number means 0011 did not apply. See the note on
failing closed under phase 10.

---

## Phase 3 — GitHub OAuth app

github.com → **Settings → Developer settings → OAuth Apps → New OAuth App**.

| Field | Value |
|---|---|
| Application name | anything — users see it on the consent screen |
| Homepage URL | `http://localhost:3000` (or your production URL) |
| **Authorization callback URL** | `https://<project-ref>.supabase.co/auth/v1/callback` |

> ### The callback URL is Supabase's, not the app's
>
> This is the single most common setup mistake, so it is worth being blunt about.
>
> The callback you register with GitHub and Google is
> **`https://<project-ref>.supabase.co/auth/v1/callback`**.
>
> It is **not** `http://localhost:3000/auth/callback`, and not your production
> `/auth/callback` either.
>
> The flow has two hops. GitHub redirects to **Supabase**, Supabase mints a
> session and redirects to **the app's** `/auth/callback`, which exchanges the
> one-time code for cookies (`app/auth/callback/route.ts`). The provider never
> sees the second hop and has no business knowing about it. Registering the app's
> URL with GitHub produces `redirect_uri_mismatch`.
>
> The app's `/auth/callback` URL belongs in phase 6, in Supabase's own redirect
> allowlist. Two different lists, two different values.

Generate a client secret and keep both it and the client id for phase 5.

---

## Phase 4 — Google Cloud OAuth client

console.cloud.google.com → create or pick a project.

1. **APIs & Services → OAuth consent screen.** Choose External. Fill in app name,
   support email, developer contact.
2. While the consent screen is in **Testing**, only addresses listed under **Test
   users** can sign in. Everyone else gets `access_denied`. Add your own address
   now — this trips people up constantly.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID →
   Web application.**

| Field | Value |
|---|---|
| Authorized JavaScript origins | `http://localhost:3000` (and your production origin) |
| **Authorized redirect URIs** | `https://<project-ref>.supabase.co/auth/v1/callback` |

Same rule as GitHub: the redirect URI is **Supabase's**. Keep the client id and
secret for phase 5.

---

## Phase 5 — Enable the providers in Supabase

Supabase → **Authentication → Providers**.

Enable **GitHub** and **Google**, pasting each one's client id and secret. This
page also displays the callback URL Supabase expects the provider to use — it
should match exactly what you entered in phases 3 and 4.

A provider that is listed in `NEXT_PUBLIC_AUTH_PROVIDERS` (phase 8) but not
enabled here renders a button that fails with a 400. `lib/auth/providers.ts` has
no way to detect this — it can only filter the list you give it. So only add a
provider to that variable once it is genuinely enabled here.

---

## Phase 6 — Site URL and the redirect allowlist

Supabase → **Authentication → URL Configuration**.

- **Site URL:** `http://localhost:3000` for local work; your production origin
  for production.
- **Redirect URLs** — add every app-side callback you will use:
  - `http://localhost:3000/auth/callback`
  - `https://your-app.vercel.app/auth/callback`
  - any preview-deployment origin you actually intend to sign in from

**This is the app's `/auth/callback`** — the second hop from the box in phase 3.
If it is missing, Supabase refuses to redirect back after a successful provider
sign-in, and the symptom is a button that appears to do nothing or a page that
flashes and returns to `/login`.

---

## Phase 7 — The Magic Link email template

Supabase → **Authentication → Email Templates → Magic Link**.

`sendEmailCode()` in `lib/auth/actions.ts` issues **one** call that sends both a
sign-in link and a six-digit code. Which one the recipient actually receives is
decided entirely by this template. The default has `{{ .ConfirmationURL }}` and
no token, so the code never arrives — and the OTP step in the UI then has nothing
to verify.

Add `{{ .Token }}`. For example:

```html
<h2>Sign in to Atlas</h2>
<p>Your code is <strong>{{ .Token }}</strong></p>
<p>Or <a href="{{ .ConfirmationURL }}">open this link</a>.</p>
```

Supabase's built-in SMTP is heavily rate-limited (a handful of emails per hour,
shared). It is fine for testing and not fine for production — configure your own
SMTP under **Project Settings → Authentication → SMTP Settings** before real
users arrive.

---

## Phase 8 — Environment variables

In `.env.local` (git-ignored via `.gitignore`'s `.env*.local`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_AUTH_PROVIDERS=google,github
```

Notes:

- `NEXT_PUBLIC_AUTH_PROVIDERS` is the display list, filtered against the registry
  in `lib/auth/providers.ts`. Supported ids: `google`, `github`, `azure`, `apple`,
  `gitlab`, `discord`. **Unknown ids are dropped silently** — a typo costs you one
  missing button, not an error. Order in the file does not matter; display order
  is fixed by the registry.
- Leaving it unset is a valid configuration: `/login` renders a clean email-only
  panel with no empty divider.
- `SUPABASE_SERVICE_ROLE_KEY` is **not** required for auth. Add it only if you
  need the operator jobs that bypass RLS.

> **`NEXT_PUBLIC_*` variables are inlined at build time.** A running dev server
> will not pick up a change. Stop it and start it again:
>
> ```bash
> npm run dev
> ```
>
> (`dev:preview` and `dev:verify` use `set VAR=...`, which is Windows `cmd`
> syntax — they will not run from bash or PowerShell. Use plain `npm run dev`
> unless you specifically need an isolated build directory.)

---

## Phase 9 — Verification

First, the test suite:

```bash
npm run verify
```

That is `tsc --noEmit && vitest run`. **Do not run `npm run lint`** — it is
`next lint`, which is not configured in this repo and will try to scaffold ESLint
interactively.

Then, with `npm run dev` running, check the routes. Do not follow redirects — the
`Location` header is the answer:

```bash
curl -s -o /dev/null -D - http://localhost:3000/chat
```

| # | Request (signed out) | With credentials | Without credentials |
|---|---|---|---|
| a | `/leaderboard`, `/news`, `/docs` | 200 | 200 |
| b | `/chat` | 307 → `/login?next=%2Fchat` | **200** — nothing is gated |
| c | `/admin` | 307 → `/login?next=%2Fadmin` | 307 → `/chat` |

`NextResponse.redirect()` defaults to **307**, not 302 — the method is preserved. Row (c)
is the useful one for telling the two branches apart: with credentials it points at
`/login`, without them it points at `/chat`.

Row (b) returning 200 with no credentials is correct, not a bug: `middleware.ts`
takes its no-credentials branch and gates nothing, because locking every visitor
out of a deployment that has no way in would be worse. Row (c) redirects in both
columns but for different reasons — with credentials it is the missing-session
check; without, it is the unconditional `/admin` exception in the same branch
(an admin surface no role can ever govern should not be reachable at all).

The rest needs a real browser and a real inbox:

- each provider button reaches its consent screen and returns you signed in
- the six-digit code arrives and verifies
- the resend countdown runs 60s and the button is genuinely disabled underneath
- `/login` and `/register` bounce you to `/chat` once signed in

### `next=` is sanitized

`safeNext()` in `lib/auth/routes.ts` rejects anything that is not a plain
same-origin path: absolute URLs, protocol-relative `//evil.com`, backslashes, and
control characters. It runs in all three places that consume a destination —
`middleware.ts`, `app/auth/callback/route.ts`, and `components/auth/auth-form.tsx`
— and is covered by `lib/auth/routes.test.ts`.

Signed out, `/login?next=//evil.com` returns 200 and simply renders the form; the
sanitizer only fires on the redirect, which needs a session. Sign in and you land
on `/chat`, never an external host.

---

## Phase 10 — Promote the first admin

There is deliberately no way to do this from the app. The `pin_profile_role()`
trigger from 0011 silently reverts any role change made by a non-admin, and
blocks anyone from changing their own role even if they are an admin. So the
first one is made in SQL:

```sql
update profiles set role = 'owner' where email = 'you@example.com';
```

Then **hard-refresh** the app. Middleware reads the role per request, but the
client-side profile is cached for the session.

Roles are `user` | `admin` | `owner`. Both `admin` and `owner` pass the `/admin`
gate.

> ### The role check fails closed
>
> `middleware.ts` treats *any* failure of the `profiles` query — missing table,
> RLS refusal, transient network error — as **"not admin"**. It never reads as
> admin. The safe answer to "we don't know" is no.
>
> The practical consequence: **a broken or unapplied migration 0011 shows up as
> `/admin` being locked, never as `/admin` being open.** If you are an owner and
> still getting bounced, suspect phase 2 before you suspect phase 10.
>
> `requireAdmin()` in `lib/auth/session.ts` guards the admin layout as a second
> line of defence, on the same fail-closed principle. It is in middleware rather
> than only in the layout because the workspace layout renders the whole app shell
> above `/admin` — by the time a layout guard finished its query the response has
> already begun streaming, and `redirect()` at that point degrades to a
> client-side redirect that ships the admin markup in a 200.

---

## Phase 11 — Production

1. Vercel → Project → **Settings → Environment Variables**. Add
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `NEXT_PUBLIC_AUTH_PROVIDERS`. Because they are inlined at build time, you must
   **redeploy** after adding them — restarting is not a thing here.
2. Repeat phase 6 with the production origin: Site URL, plus
   `https://your-app.vercel.app/auth/callback` in Redirect URLs.
3. Add the production origin to the GitHub OAuth app's Homepage URL and to
   Google's Authorized JavaScript origins. The **redirect** URI stays
   `https://<project-ref>.supabase.co/auth/v1/callback` — it does not change
   between environments, because it never pointed at your app.
4. Move the Google consent screen from **Testing** to **In production**, or every
   sign-in from an address not on the test-user list gets `access_denied`.
5. Configure your own SMTP (phase 7).
6. Preview deployments get a fresh origin per branch. Either add each one to the
   redirect allowlist or accept that sign-in only works on production and
   localhost.

---

## Troubleshooting

Every row names the phase that caused it.

| Symptom | Cause |
|---|---|
| Provider button does nothing, or flashes back to `/login` | Redirect URL missing from Auth → URL Configuration (**phase 6**) |
| `redirect_uri_mismatch` on the provider's page | Used the app's URL instead of `https://<ref>.supabase.co/auth/v1/callback` (**phase 3 / 4**) |
| Email arrives with a link but no code | `{{ .Token }}` not in the Magic Link template (**phase 7**) |
| No email at all | Supabase built-in SMTP is rate-limited; configure own SMTP (**phase 7**) |
| Google `access_denied` | Consent screen in Testing and the address isn't a test user (**phase 4**) |
| `/admin` redirects even as owner | Migration 0011 not applied, or no hard refresh after the SQL update (**phase 2 / 10**) |
| No buttons on `/login` | `NEXT_PUBLIC_AUTH_PROVIDERS` unset, or server not restarted (**phase 8**) |

A few more, same principle:

| Symptom | Cause |
|---|---|
| `/login` says "Accounts aren't set up here" | URL or anon key missing, or the dev server predates them (**phase 8**) |
| Provider button 400s: "That sign-in method isn't enabled" | Listed in `NEXT_PUBLIC_AUTH_PROVIDERS` but not enabled in Supabase (**phase 5**) |
| "No Atlas account uses that address yet" at `/login` | Working as intended — `/login` sends `shouldCreateUser: false`. Use `/register` (**not a fault**) |
| Signed in, but chats still save only to the browser | Expected until there is a session; check `getCurrentUserId()` returns an id. RLS from 0005 means a signed-out client would silently discard writes, so the local driver is the honest default (**phase 2**) |
| Account menu shows no name or avatar | `handle_new_user()` did not fire — 0011 applied after the account was created. The migration's backfill covers this; re-run it (**phase 2**) |
| Sign-out appears to work, then a refresh is signed in again | The `POST /auth/signout` call failed; only the client session cleared. Cookies expire on the next request (**not a setup fault**) |

### A note on account enumeration

`/login` sends `shouldCreateUser: false`, so an address with no account is
refused with *"No Atlas account uses that address yet. Create one instead."* That
is a deliberate tradeoff: it confirms to an anonymous caller whether an address
has an account, in exchange for turning a dead end into a next step. The comment
at `lib/auth/actions.ts:55` marks the spot to change if that tradeoff is wrong
for your deployment.

Note also that the login/register split is enforced by **Supabase's Auth API**
acting on a flag the browser sends — it is a guard against a mistyped address,
not a security boundary. Nothing is lost if someone bypasses it: they get an
empty profile row.

---

## Reference

| File | Role |
|---|---|
| `middleware.ts` | Session refresh, route gating, the `/admin` role check |
| `lib/auth/routes.ts` | Which prefixes are public / protected / admin / auth; `safeNext()` |
| `lib/auth/providers.ts` | Provider registry; reads `NEXT_PUBLIC_AUTH_PROVIDERS` |
| `lib/auth/actions.ts` | `signInWithProvider`, `sendEmailCode`, `verifyEmailCode`, `signOutEverywhere` |
| `lib/auth/session.ts` | Server-side `getSessionUser`, `getProfile`, `requireAdmin` |
| `lib/supabase/client.ts` | Browser client; returns `null` when unconfigured |
| `lib/supabase/server.ts` | `getSupabaseServer()` (service role) and `getSupabaseRouteClient()` (acts as the user) |
| `app/auth/callback/route.ts` | Exchanges the one-time code for session cookies |
| `app/auth/signout/route.ts` | POST-only cookie expiry |
| `components/auth/auth-form.tsx` | The `/login` and `/register` panel |
| `supabase/migrations/0005_auth_rls.sql` | Per-user RLS |
| `supabase/migrations/0011_profiles_roles.sql` | `profiles`, signup trigger, roles |
