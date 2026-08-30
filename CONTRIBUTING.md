# Contributing to LLM Atlas

## The short version

```bash
git switch main && git pull
git switch -c feat/short-slug
# ...work...
npm run verify                       # typecheck + tests — the same gate CI runs
git push -u origin feat/short-slug
```

Open a pull request, give it a **Conventional Commit title**, wait for green CI,
squash-merge. Releases are cut automatically; you never edit a version number or
a changelog by hand.

---

## Local setup

```bash
npm install
cp .env.example .env.local     # every key is empty; fill in only what you need
npm run dev                    # http://localhost:3000
```

The app runs with **no keys at all** — the catalog, cost engine, graph, news and
docs are all local data. Keys only light up live inference.

### Models will not run

Run this first:

```bash
npm run doctor
```

It reports which providers are configured and whether each one is actually
**reachable**, which are different questions and are the usual source of
confusion. It never prints a key — only whether one is present.

To get live models, set **one** of these in `.env.local` and restart:

| Variable | Notes |
| --- | --- |
| `GROQ_API_KEY` | Free tier. Fastest to get. |
| `NVIDIA_API_KEY` | Free tier. Widest open-model coverage. |
| `GOOGLE_API_KEY` | Free tier. Gemini and Gemma families. |
| `OPENROUTER_API_KEY` | Metered — only its `:free` variants run on a zero-credit key. |
| `LOCAL_BASE_URL` | Ollama / vLLM / llama.cpp. **See the warning below.** |

> **`LOCAL_BASE_URL` is the one provider configured by a URL rather than a key.**
> Setting it marks `local` as connected whether or not anything is listening on
> that port. If you set it, make sure the server is actually running — otherwise
> the app will offer local-routed models and every request will fail. This is
> what `npm run doctor` checks for.

Restart the dev server after editing `.env.local`; Next.js reads env files at
startup.

**Never commit a key.** `.env` and `.env*.local` are gitignored — keep it that
way. Keys belong in `.env.local`, in Vercel project settings, or in GitHub
Actions secrets. Never in a commit, an issue, or a pull request body: this
repository is public.

---

## Branching

Trunk-based. `main` is the only long-lived branch and is always deployable.

- Branch from `main`, and keep the branch short-lived — a day or two, not a week.
- Name it `type/short-slug`, using the same types as the commit convention:
  `feat/agent-dock`, `fix/local-provider-trap`, `ci/harden-pipeline`,
  `docs/governance`.
- Rebase or merge `main` in if you fall behind. Do not rewrite a branch someone
  else has checked out.
- Delete the branch after merge.

Every push to a branch with an open PR gets a **Vercel Preview deployment** with
its own URL. Use it — it is the closest thing to production before merge. Note
that preview deployments get a fresh origin per branch, so Supabase OAuth
redirects need that origin allowlisted (`docs/auth-setup.md`, Phase 11).

---

## Commits and PR titles

This repo uses [Conventional Commits](https://www.conventionalcommits.org/).

```
type(optional-scope): imperative summary
```

| Type | Use for | Release effect |
| --- | --- | --- |
| `feat` | A new capability | **minor** (0.1.0 → 0.2.0) |
| `fix` | A bug fix | **patch** (0.1.0 → 0.1.1) |
| `perf` | Faster, same behaviour | patch |
| `refactor` | No behaviour change | none |
| `docs` | Documentation only | none |
| `test` | Tests only | none |
| `ci` | Workflows, pipelines | none |
| `chore` | Deps, tooling, housekeeping | none |
| `build` | Build system, bundling | none |

A breaking change takes a `!` — `feat(router)!: drop the v1 chat endpoint` — or
a `BREAKING CHANGE:` footer, and bumps the **major**.

### The PR title is what matters most

This repo **squash-merges**, so the PR title becomes the single commit subject on
`main` — and that is the text release-please reads to decide the next version.
A PR titled "fixes" produces a release note that says "fixes".

CI checks the PR title format and will fail on a non-conforming one. Individual
commits inside the branch are checked locally by `commitlint` but are squashed
away, so they matter less.

---

## Before you open a PR

```bash
npm run verify      # typecheck + tests. CI runs exactly this.
npm run build       # CI runs this too, as a separate job.
```

Both must pass. CI will tell you anyway, but a red PR costs a cycle and the
reviewer's attention.

Business logic lives in `lib/**` and is tested there — `vitest.config.ts` only
collects `lib/**/*.test.ts`. If you are fixing a bug in a component, look for the
logic underneath it: that is usually where the fix and the test belong.

Fill in the PR template honestly, especially **how it was verified**. "Ran the
tests" and "opened it in a browser and watched it work" are different claims.

---

## Review and merge

- CI must be green: **typecheck + tests** and **production build**.
- `main` requires a pull request — no direct pushes.
- Merge with **Squash and merge**, keeping the PR title as the commit subject.
- Approvals are not currently required, because a single maintainer cannot
  approve their own PR and requiring it would deadlock the repo. `CODEOWNERS`
  already routes review correctly, so enabling the rule later is a one-line
  change.

The GitHub-side settings behind all of this — merge strategy, the branch
ruleset, Actions permissions, secrets and the security toggles — are recorded in
[`docs/repo-setup.md`](docs/repo-setup.md).

---

## Releases

Fully automated by [release-please](https://github.com/googleapis/release-please).
Nobody edits `package.json`'s version or `CHANGELOG.md` by hand.

1. You merge a `feat:` or `fix:` PR into `main`.
2. release-please opens (or updates) a **Release PR** with the computed version
   bump and a changelog assembled from the commit subjects since the last tag.
3. That PR sits there accumulating changes for as long as you like. It is the
   review step — read the changelog, confirm the bump is right.
4. Merging it tags `vX.Y.Z`, publishes a GitHub Release, and updates
   `CHANGELOG.md`.

Nothing is published to npm — the package is `private`.

> **Known quirk:** the Release PR is opened by `GITHUB_TOKEN`, and GitHub does
> not trigger workflows for PRs created that way. So the Release PR shows no CI
> run. This is expected and safe — it only ever touches `CHANGELOG.md` and the
> version in `package.json`. Do not "fix" it by pushing an empty commit.

---

## Deployment

`main` auto-deploys to production on Vercel. Preview deployments come from PRs.

Environment variables are set **in Vercel**, per environment (Production /
Preview / Development) — never in the repo. After changing one, redeploy;
Next.js inlines `NEXT_PUBLIC_*` at build time, so a change to those needs a
rebuild, not just a restart.

Scheduled jobs run from two places, and both are optional:

- `vercel.json` declares Vercel Crons for `/api/v1/catalog/sync` (04:00 UTC) and
  `/api/v1/news/sync` (04:07 UTC).
- `.github/workflows/{catalog,news}-sync.yml` poke the same endpoints on a
  schedule. They skip silently unless the repo secrets `ATLAS_BASE_URL` and
  `CATALOG_SYNC_SECRET` / `NEWS_SYNC_SECRET` are set.

Neither is required: both endpoints also refresh on read when their data is
stale.

---

## Repository secrets

| Secret | Used by | Needed for |
| --- | --- | --- |
| `ATLAS_BASE_URL` | both sync workflows | The deployed origin to poke |
| `CATALOG_SYNC_SECRET` | `catalog-sync.yml` | Authorising the sync endpoint |
| `NEWS_SYNC_SECRET` | `news-sync.yml` | Authorising the sync endpoint |

The `verify` workflow needs **no secrets**, deliberately — that is what lets it
run on fork pull requests, and what keeps the build honest about not requiring a
provider key.
