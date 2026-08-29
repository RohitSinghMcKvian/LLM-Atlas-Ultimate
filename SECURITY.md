# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting instead:
[**Report a vulnerability**](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/security/advisories/new).
It is private between you and the maintainers until a fix is published.

Please include what the issue is, how to reproduce it, and what an attacker
could actually do with it. A proof of concept helps, but a clear description of
the flaw is worth more than a working exploit.

You will get an acknowledgement within a few days. This is a small project — if
you have not heard back within a week, feel free to nudge the report.

## Supported versions

Only the latest release, and `main`. This project deploys continuously; fixes
land on `main` and go out with the next release rather than being backported.

## What this project handles

Worth knowing before you look, because it determines what counts as a
vulnerability here.

**Two kinds of credential, treated differently by design:**

- **Operator keys** (`NVIDIA_API_KEY`, `GROQ_API_KEY`, `GOOGLE_API_KEY`,
  `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are read **server-side only**
  from the environment. The client is only ever told a boolean — whether a
  provider is configured — never a value. Anything that leaks a value to the
  browser, a log, or an API response is a vulnerability.
- **BYOK user keys** are the end user's own OpenRouter key. They are stored in
  that user's browser and forwarded per request as a header. They are never
  persisted server-side and never logged. Anything that stores, logs, or echoes
  one is a vulnerability.

Upstream error bodies are scrubbed for credential-shaped strings before they are
surfaced (`scrubSecrets`, `lib/router/index.ts`). A path that returns an
unscrubbed upstream body is a vulnerability.

**Also in scope:**

- Anything letting one user read another user's conversations, projects or
  memory. Row-level security is enforced in Postgres — see
  `supabase/migrations/`.
- Server-side request forgery through a provider base URL override.
- Escapes from the artifact sandbox (`/code`) into the host page or the network.
- Auth bypass, privilege escalation to an `owner` role, or session fixation.
- The MCP server endpoint (`/api/v1/mcp/server`) exposing anything beyond public
  catalog data. It is read-only and public-data-only by design, and off unless
  explicitly enabled.

**Not vulnerabilities:**

- API routes are unauthenticated by design and serve public data — the catalog,
  benchmarks, pricing, news. That is the product.
- The MCP server being reachable when the operator has deliberately enabled it.
- Rate limits being reachable on free provider tiers.
- A key you put in your own `.env.local` being readable by code running on your
  own machine.

## If you find a leaked key

If you find a live credential committed anywhere in this repository or its
history, report it privately as above and **tell us where it is — do not include
the value** in the report. It will be revoked first and removed second, in that
order, because rotation is what actually ends the exposure.
