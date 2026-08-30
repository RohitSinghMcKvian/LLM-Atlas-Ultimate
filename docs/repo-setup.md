# Repository setup runbook

Settings that live in GitHub rather than in the repo, so they are recorded
somewhere reviewable instead of existing only in one person's memory. Everything
here is applied once, by a repository admin.

The workflows, templates and release automation are already in the repo. This is
the half that has to be switched on by hand.

---

## 1. Merge strategy — do this first

`Settings → General → Pull Requests`

- ☑ **Allow squash merging**
  - Default commit message: **"Default to pull request title"**
- ☐ Allow merge commits — *off*
- ☐ Allow rebase merging — *off*
- ☑ Automatically delete head branches

**Why this exact combination.** Squash-only keeps `main` linear and gives every
change one commit. Setting the message to the PR title is what makes
release-please work: it parses the commit subjects on `main`, so the PR title
*is* the release metadata. `.github/workflows/pr-title.yml` enforces that the
title is a Conventional Commit; if the merge message defaulted to anything else,
that check would be enforcing a string nobody reads.

---

## 2. Branch protection for `main`

`Settings → Rules → Rulesets → New branch ruleset`

| Setting | Value |
| --- | --- |
| Name | `main` |
| Enforcement status | **Active** |
| Target branches | Include default branch |
| Restrict deletions | ☑ |
| Block force pushes | ☑ |
| Require linear history | ☑ |
| Require a pull request before merging | ☑ |
| → Required approvals | **0** |
| → Dismiss stale approvals | ☑ |
| → Require review from Code Owners | ☐ (see below) |
| Require status checks to pass | ☑ |
| → Require branches to be up to date | ☑ |

### Required status checks

Add these three **after** the PRs that introduce them have merged — a check that
has never run cannot be selected:

- `typecheck + tests` — from `verify.yml`
- `production build` — from `verify.yml`
- `conventional commit title` — from `pr-title.yml`

Deliberately **not** required: `eslint (reporting only)`. It is non-gating on
purpose while the initial 150-finding backlog is burnt down. When it reaches
zero, drop the two `continue-on-error` lines from `.github/workflows/lint.yml`
and add the check here.

### Why zero required approvals

GitHub does not let anyone approve their own pull request. With a single
maintainer, requiring one approval makes `main` unmergeable — every PR would
need a second account. The protection that matters is still in force: no direct
pushes, and CI must be green.

`CODEOWNERS` is already in place and routes review correctly. When a second
maintainer joins, set **Required approvals: 1** and tick **Require review from
Code Owners**. That is the whole change.

### The same thing with `gh`

```bash
gh api --method POST repos/RohitSinghMcKvian/LLM-Atlas-Ultimate/rulesets \
  --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "typecheck + tests" },
          { "context": "production build" },
          { "context": "conventional commit title" }
        ]
      }
    }
  ]
}
JSON
```

---

## 3. Actions permissions

`Settings → Actions → General`

- Workflow permissions: **Read repository contents and packages permissions**
- ☑ **Allow GitHub Actions to create and approve pull requests**

The second one is required — without it release-please cannot open its Release
PR and the job fails with a permissions error. The read-only default is correct:
each workflow declares the scopes it needs (`release.yml` asks for
`contents: write` and `pull-requests: write`; everything else is read-only).

---

## 4. Repository secrets

`Settings → Secrets and variables → Actions`

| Secret | Needed by | Purpose |
| --- | --- | --- |
| `ATLAS_BASE_URL` | `catalog-sync.yml`, `news-sync.yml` | Deployed origin to poke, e.g. `https://llmatlas.xyz` |
| `CATALOG_SYNC_SECRET` | `catalog-sync.yml` | Must match the deployment's env var |
| `NEWS_SYNC_SECRET` | `news-sync.yml` | Must match the deployment's env var |

All three are **optional**. Both workflows print a skip message and exit 0 when
their secrets are absent, and both endpoints also refresh on read when their data
is stale — so the features work with none of this configured.

`verify.yml` needs no secrets at all, deliberately. That is what lets it run on
pull requests from forks, and what keeps the build honest about not requiring a
provider key.

---

## 5. Vercel

Environment variables belong in the Vercel project, per environment
(Production / Preview / Development) — never in the repository.

- Provider keys (`GROQ_API_KEY`, `NVIDIA_API_KEY`, …) — set at least one on
  Production, or live inference is unavailable there.
- Preview deployments get a **fresh origin per branch**. If Supabase auth is in
  use, each origin needs allowlisting in the Supabase redirect settings — see
  `docs/auth-setup.md`, Phase 11.
- After changing any `NEXT_PUBLIC_*` variable, **redeploy**. Next.js inlines
  those at build time, so a restart is not enough.

`vercel.json` already declares the two cron jobs. On the Hobby plan cron
frequency is capped at daily, which is why `catalog-sync.yml` and `news-sync.yml`
exist alongside them.

---

## 6. Security

`Settings → Code security`

- ☑ **Private vulnerability reporting** — `SECURITY.md` links to it, so it must
  be on or that link is dead.
- ☑ **Dependabot alerts** and **security updates**
- ☑ **Secret scanning** and **Push protection**

Push protection is the valuable one here. This app brokers provider API keys,
the repository is public, and push protection blocks a commit containing a
recognised credential *before* it reaches GitHub — which is the only point at
which the problem is still cheap. After a push, the only real remedy is
rotation.

---

## Verifying it worked

1. Open a throwaway PR titled `test` — the `conventional commit title` check
   must fail, and the merge button must be blocked.
2. Rename it to `chore: verify branch protection` — the check re-runs on `edited`
   and passes.
3. Try `git push origin main` directly — it must be rejected.
4. After merging a `fix:` or `feat:` PR, confirm release-please opens a Release
   PR within a minute or two.
