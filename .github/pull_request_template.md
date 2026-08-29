<!--
The title becomes the commit subject on `main` (this repo squash-merges), and
release-please reads it to decide the next version. So it must be a Conventional
Commit:  type(scope): summary

  fix(router): ...   → patch      feat(chat): ...    → minor
  feat(api)!: ...     → major      chore/docs/ci/test: no release

See CONTRIBUTING.md.
-->

## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem, not the patch. If it fixes an issue, "Closes #123". -->

## How it was verified

<!--
What you actually ran, and what it printed — not what you expect to happen.
Delete rows that do not apply.
-->

- [ ] `npm run verify` (typecheck + tests) passes
- [ ] `npm run build` passes
- [ ] Exercised in a browser / against a running server
- [ ] New or updated tests cover the change
- [ ] Behaviour change is documented (README / `.env.example` / `docs/`)

## Risk and rollback

<!--
Anything a reviewer should look hardest at. Named explicitly:
  - migrations, or anything that changes stored data
  - a changed default that affects existing installs
  - new dependencies
  - anything touching keys, auth, or a network boundary
Revert plan if this misbehaves in production.
-->

## Screenshots

<!-- For UI changes. Before and after. -->

---

<!--
Never include a real API key, token, or `.env.local` content in a PR — this repo
is public and PR bodies are permanent and indexed. Refer to a variable by name.
-->
