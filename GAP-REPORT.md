# Atlas Chat — Claude parity gap report (P0)

Produced for the Atlas Chat parity build spec v3, §2. This is the gate document:
it maps the existing codebase against every subsystem the spec names, records
which of the §1 non-negotiable constraints hold today, and re-scopes P1–P8
against what actually exists.

Audited at commit `57d773d` on `main`.

---

## 1. Method, and one caveat about reading it

Three passes over the repository: route/component/state inventory, infrastructure
and schema, and a keyword sweep for each named capability.

The caveat matters more than the method. **A table in `supabase/migrations/` is
not a feature.** This codebase has a pgvector `embeddings` table, an ivfflat
index, and a `match_embeddings()` RPC — and *zero* `.rpc(` calls anywhere in the
application. Eight of seventeen tables are never queried. Seven feature flags are
declared and never read. So each row below distinguishes:

- **EXISTS** — implemented, reachable from the UI, and exercised.
- **PARTIAL** — a real implementation that falls short of the spec's target.
- **MISSING** — no implementation. Schema, flags, and marketing copy don't count.

The headline finding is that the spec **underestimates the codebase in some places
and overestimates it in others**, and the two are not symmetric. Branching is done.
Agentic execution is done, on the wrong surface. Meanwhile three of the nine
non-negotiable constraints are violated today, and one was a live vulnerability.

---

## 2. Subsystem status

### Core chat UX + streaming — EXISTS

| Piece | Where |
|---|---|
| SSE streaming | `lib/router/index.ts` (761 ln), `lib/router/sse.ts`, `lib/sse-client.ts` |
| Endpoint | `app/api/v1/router/chat/route.ts` |
| UI | `components/chat/chat-client.tsx` (1947 ln) |

Hand-rolled, not the Vercel AI SDK. It carries three-tier timeouts (connect
10s / first chunk 20s / idle 60s), a failover work queue that reads one chunk
before committing so an accept-then-hang provider still falls through, per-provider
parameter stripping, a `stream_options` retry, secret scrubbing on upstream errors,
and a 374-line failover test.

Present: extended-thinking display (`components/reasoning-block.tsx`), attachments
(`lib/chat/attachments.ts` — pdf/docx/xlsx/csv/images), voice
(`lib/hooks/use-speech.ts`), KaTeX + Mermaid + highlighting (`components/markdown.tsx`),
export (`lib/chat/export.ts`), 6 style presets and account instructions
(`lib/store/settings-store.ts`), cost/usage (`lib/chat/cost.ts`), shortcuts
(`components/shortcuts.tsx`).

Missing against parity: **incognito mode** (no occurrence anywhere), archive, share
links, user-authored custom styles.

### Message branching — EXISTS

`lib/chat/tree.ts` is a complete DAG implementation: `activePath()` with a cycle
guard, `siblingsOf()` for the `‹ 2/3 ›` stepper, `treeFromList()` migrating legacy
flat threads, and a `WeakMap` children cache keyed on the nodes object so it can go
cold but never stale. Tested in `tree.test.ts`. `ChatMessage.parentId` is persisted
by both drivers.

**The spec's P1 is essentially already done.** What remains is small: the active
leaf lives in `localStorage` (`lib/chat/branch-state.ts`), not in
`conversations.active_leaf_message_id`, and there is no explicit "fork conversation".

### Artifacts — PARTIAL at audit time; P2 closed persistence, P10 the build path, P11 documents and export

At audit time `components/chat/artifact-panel.tsx` rendered
html/svg/react/mermaid/markdown/code with preview/code/diff tabs and a version
stepper, but artifacts were **ephemeral**: `extractArtifact()` re-derived them
from message text on every render, so they had no identity. Nothing could be
attached to them — no `artifacts` table write (the column existed, unpopulated),
no `window.storage`, no publish/remix, no Sandpack.

Three security defects were found here, all fixed in P0 — see §4.

**Closed in P2:**
- Persistence and immutable version history — `lib/chat/artifact-repo.ts`,
  IndexedDB stores in `lib/chat/idb.ts`, Supabase migration `0007_artifacts.sql`.
- Revert, which moves the `current_version` pointer without destroying later
  versions.
- `window.storage` over a validated postMessage bridge —
  `lib/chat/artifact-bridge.ts`.
- The pinned runtime set (§4), served from Atlas's own origin and loaded per
  artifact based on what the code actually references.

**Closed in P10** — after a user report that Atlas could not build and show a
landing page. That turned out to be a chain of six defects, not one:

1. **Truncation was silent and unrecoverable.** Chat sent no `max_tokens` at all,
   so every turn ran at whatever the route defaulted to — 1–4k on many, under half
   a landing page. The router captured `finish_reason` and the SSE route sent it,
   but nothing in the client ever read it. Now: a per-turn budget from the
   catalog's `maxOutput` (`outputBudget`, capped at 16k), `finishReason` threaded
   through `lib/chat/tool-loop.ts`, and up to three automatic resume rounds joined
   by `stitch` in `lib/chat/continuation.ts`.
2. **The only artifact channel was a fence scrape that failed exactly when
   truncated.** `/```(\w+)?\n([\s\S]*?)```/g` needs a *closing* fence, so a cut-off
   page matched nothing, `artifactVersions` was empty, and the Artifact button
   never rendered — the reported symptom precisely. `lib/chat/artifact-extract.ts`
   replaces it with a line scanner that accepts an unterminated final fence, CRLF,
   fences longer than three backticks, and every block rather than the first.
3. **Nothing rendered until the turn ended, and then only on a click.** The panel
   now previews mid-stream (throttled to one frame reload per 400 ms) and opens
   itself when an artifact appears.
4. **Tailwind was blocked, and models write landing pages in Tailwind.** It was
   excluded because the only distribution was a CDN (§1.4). `@tailwindcss/browser`
   is an npm package, so it is vendored and served from Atlas's own origin like
   React. Verified live: it injects an 8 KB stylesheet inside the sandboxed frame
   and `bg-slate-950 / flex / text-5xl / grid gap-6` all resolve.
5. **The artifact had no feedback path.** `attachArtifactErrorListener` +
   `errorClientScript` report `window.onerror`, unhandled rejections,
   `console.error`, a **blocked cross-origin resource**, and a page that rendered
   nothing at all — over the same per-frame postMessage channel as
   `window.storage`. "Fix these" sends them back, delimited as data.
6. **Editing meant rewriting.** The `artifact` tool (`read` / `update` /
   `rewrite`) patches by exact unique match (`lib/chat/artifact-patch.ts`), so
   changing a heading in a 900-line page costs the fragment, not the document.

The transcript also stopped printing artifact source: `stripArtifactBlock` lifts
it out and `components/chat/artifact-card.tsx` stands in its place.

**Closed in P11** — every artifact kind up to here was a *program*, so a report,
a research sheet or a deck had no shape to be produced in, and nothing could be
exported. Two prose kinds were added, `document` and `slides`, written in
Markdown behind their own fence languages and rendered by the app's own
`<Markdown>` — react-markdown without `rehype-raw`, so raw HTML in a
model-written document is escaped rather than merely sandboxed. Slide splitting,
titles and the paper stylesheet are pure functions in `lib/chat/document.ts`.

PDF export ships **no PDF library**: the browser's own print pipeline is the
writer. Prose is lifted from the rendered DOM into a hidden same-origin frame
carrying `@page` rules (`lib/chat/print.ts`); an executable artifact, which the
parent cannot reach into, prints itself over a third postMessage protocol
alongside storage and errors. The printed document carries its own CSP —
`img-src data: blob:` — so a remote image in a document Atlas assembles cannot
become an outbound request (§1.4).

**Still open:** publish (public slug) and the embed snippet, both of which need a
public route over Supabase and so sit behind the RLS gate. ~~Remix~~ closed in
P16, which also fixed fork silently losing the build.
~~One artifact per conversation~~ and ~~no multi-file artifact and no bundler~~
were both closed later: artifacts are keyed by (conversation, path) with a
version history each, imports between files are resolved by a Babel-to-CommonJS
bundler, P14 taught the `artifact` tool to address a file by path, and P15 added
delete and rename.

### Projects / knowledge / RAG — PARTIAL at audit; RAG closed in P3

`lib/store/projects-store.ts` + `components/chat/projects-dialog.tsx` give real
projects with instructions and files, injected via `projectContext()` and bound
through `Conversation.projectId`.

At audit time retrieval did not exist: files were stuffed whole, with no chunking,
no embedding, no threshold switch, and the vector layer (`embeddings` table,
ivfflat index, `match_embeddings()`) was dead schema.

**Closed in P3:**
- Chunking — `lib/chat/chunk.ts` (paragraph→sentence→hard-cut with overlap).
- Embedding — `lib/chat/embed.ts`: an offline feature-hashed **lexical** embedder
  (the §1.5 default) plus a BYOK provider path via `app/api/v1/embeddings`.
- Retrieval — `lib/chat/rag.ts`: brute-force cosine over an IndexedDB chunk index,
  and the previously-dead `match_embeddings` RPC wired for the signed-in path.
- Threshold switch — `resolveProjectContext()` stuffs whole below ~150K tokens and
  retrieves top-k above it.
- Instruction override — project instructions now explicitly take precedence over
  account preferences in `buildSystemPrompt`.

**Still open:** projects and their chunk vectors persist to browser storage only —
the `projects`/`project_files` tables and the Supabase pgvector write path are
unused, so projects don't sync across devices. Semantic (as opposed to lexical)
retrieval requires a configured provider embedding model, which OpenRouter doesn't
offer and none is wired by default. Both are recorded honestly, not papered over.

### Memory & context management — MOSTLY DONE *(updated after P4)*

Compaction **exists** and is good: `lib/chat/health.ts` measures token pressure
against the model's real context window and `buildContinuationSummary()` preserves
pinned messages verbatim.

**Closed in P4:**

- **The 6-command `/memories` filesystem tool** — `lib/chat/memory-fs.ts` implements
  `view`/`create`/`str_replace`/`insert`/`delete`/`rename` over an injected store,
  with IndexedDB behind it (`memory-repo.ts`, DB v4 store `memory_files`). Paths are
  confined to `/memories` by normalising *before* the prefix check, so
  `/memories/../atlas-keys` fails closed. `str_replace` refuses an ambiguous match
  rather than silently editing the first one.
- **Past-chat RAG** — `lib/chat/chat-index.ts` reuses P3's chunk/embed/cosine
  machinery over a `chat_chunks` store, indexing each thread after its turn
  (idempotent by transcript fingerprint) and exposing `search_past_chats`, which
  returns at most one excerpt per conversation with the title and id attached for
  citation. A minimum-score floor means a query with no real match returns nothing
  instead of the k least-bad chunks.
- **Categories + editable summary** — `MemoryCategory` with a local keyword
  classifier, per-category clearing, and a user-owned summary that is generated on
  request but never regenerated automatically once edited.
- **Incognito mode** — enforced by wrapping the resolved `ChatRepo` in a read-only
  proxy (`lib/chat/repo-private.ts`), so every write path is blocked at one seam
  rather than at ~8 call sites. Memory-file writes and chat indexing carry their own
  checks because they don't go through `ChatRepo`.

**Still open:** memory is browser-local. `supabase/migrations/0008_memory.sql`
creates `memory_files` and `memory_profile` with `auth.uid()` RLS, but no driver
writes to them — deferred with the rest of sync behind the unverified RLS work.
Past-chat chunks likewise belong in the existing `embeddings` table under
`scope = 'chat:<id>'`; the write path is not built.

### Skills — MOSTLY DONE *(updated after P5)*

At audit time this was MISSING app-side: no `SKILL.md` loader, no progressive
disclosure, no UI. (`.claude/skills/**` and `skills-lock.json` are Claude Code
tooling for this repo, not product features.) The one reusable seed was
`parseAgentMd()` at `lib/engine/orchestrator.ts:78`.

**Closed in P5:**

- **`lib/skills/parse.ts`** — the SKILL.md grammar generalized from
  `parseAgentMd`, which stays where it is (it produces an `AgentRole` for the
  /code subagent runner — different type, different lifecycle). The new parser is
  stricter and returns *why* a skill was rejected rather than `null`, because a
  user pasting a skill into the editor needs an actionable message. Unknown
  frontmatter keys are named rather than ignored, so a typo'd `descripton:`
  doesn't surface as "missing description".
- **Progressive disclosure** — `skillsIndexBlock()` puts only `id`, `name` and
  `description` in the system prompt; the body loads through a `skill` tool when
  the model decides a task matches. `disclosureRatio()` makes the saving
  measurable, and a test asserts the shipped set defers >60% of its own text.
- **`allowed-tools` is enforced, not decorative** — `executeTool` refuses a call
  outside the loaded skill's set, before arguments are parsed, so a forbidden
  call cannot have a side effect on the way to being refused. Enforcement lives
  at the call site rather than in the tool definitions because the definitions
  were already sent when the turn began and cannot be retracted mid-turn.
- **Registry + UI** — IndexedDB store (DB v5) with three built-in skills seeded
  on first run. Seeding never overwrites, so a disabled or edited built-in stays
  that way across reloads; `restoreBuiltinSkills()` is the explicit escape hatch.
  The dialog does create/edit/enable/delete and shows tool restrictions.

**Still open:** skills are browser-local. `supabase/migrations/0009_skills.sql`
lands the table and its `auth.uid()` RLS, but no driver writes to it. There is no
skill marketplace or sharing — deliberately: a skill is instructions the model
follows, so a shared one is an influence channel and needs its own opt-in design
rather than a relaxed RLS policy. Bundled resource files (a skill shipping
scripts or templates alongside SKILL.md) are not supported.

### Connectors / MCP — MOSTLY DONE *(updated after P6)*

At audit time this was entirely absent — no client, no OAuth, no PKCE, no tool
approval. The only occurrences of "MCP" were marketing copy, a module description
that already claimed Chat had it (`lib/modules.ts:53`), and a Learn *lesson*
(`lib/learn/content/tools.ts:388-742`). It was the largest true greenfield in the
plan, and it is now built.

**Closed in P6:**

- **`lib/mcp/protocol.ts`** — JSON-RPC 2.0 over the Streamable HTTP transport,
  Zod-validated rather than cast, because a connector is a third party and its
  response is untrusted input. stdio transport is out of scope by construction: a
  browser cannot spawn a process and §1.7 rules out doing it server-side.
- **`app/api/v1/mcp`** — the thin stateless proxy §1.3 permits for CORS-blocked
  origins. Forwards the token in a header, stores and logs nothing, refuses
  redirects (a redirect is a second URL that never passed the guard), and caps
  both response size and time.
- **`lib/mcp/url-guard.ts`** — the SSRF defence, in two layers: literal-IP and
  hostname rules (including the obfuscated forms `0x7f000001`, `2130706433`,
  `::ffff:127.0.0.1`), then DNS resolution checked across *every* returned
  address. Verified live against 13 vectors including the cloud metadata
  endpoint.
- **`lib/mcp/pkce.ts`** — S256 only, verified against RFC 7636's published test
  vector. `state` is checked before the code is read. RFC 8707 `resource` binds a
  token to one MCP server so it cannot be replayed against another.
- **Encrypted tokens** — `Connector` has no plaintext token field at all; tokens
  are sealed with `lib/crypto/secret-box.ts` and decrypted only at call time.
- **The approval gate** — every connector call is refused by default. Remembering
  is per *tool*, never per connector, and the server's `readOnlyHint` informs the
  prompt but never grants anything.

**Still open:** the OAuth *flow* is not wired end to end — PKCE, the authorize
URL, callback parsing and the token/refresh bodies are built and tested, but
there is no discovery of a server's authorization metadata and no callback route,
so tokens are pasted rather than granted. Connectors are browser-local
(`0010_connectors.sql` lands the schema and RLS; no driver writes to it). Atlas
consumes tools only — MCP resources, prompts and sampling are not implemented.

### Research — MOSTLY DONE *(updated after P7)*

At audit time web search was one-shot: a DuckDuckGo HTML scrape, capped at 8
results, with no alternative backend. `fanOut(jobs, concurrency=3)` existed in
`lib/engine/orchestrator.ts` but only served Atlas Code, and the `deepResearch`
flag was declared and never read.

**Closed in P7:**

- **BYO search providers** — `lib/research/providers.ts` puts Brave, Tavily and
  Exa behind one interface alongside the keyless DuckDuckGo scrape, which stays
  the default and the only zero-configuration path. Keys are held in the browser
  and forwarded once as `x-search-key`, never stored server-side. Every provider
  parser returns `[]` for a malformed body rather than throwing.
- **The multi-step loop** — `lib/research/run.ts` promotes `fanOut` into chat as
  this report anticipated: rounds of plan → search in parallel → merge and
  de-duplicate → decide what is still missing. A failed search costs one angle,
  not the run.
- **Budgets that actually bind** — `lib/research/budget.ts` is a first-class
  object where every spend goes through `charge()`, so staying inside the caps is
  a property of one module rather than a claim about several call sites. Queries,
  sources, rounds and wall-clock are separate limits because they fail
  differently. Tested against a planner demanding 500 queries at once.
- **Citation integrity** — `lib/research/citations.ts` reconciles the answer
  against the sources it was given: markers pointing at sources that were never
  retrieved are removed, the cited sources are collected in citation order, and
  the markers are renumbered to match. What the user sees is exactly what the
  answer cites.
- **A local planner** — `lib/research/planner.ts` decomposes round 0 by rule
  (the question as asked, a recency angle, background, and *counter-evidence*),
  then broadens only if the results were thin. `modelPlanner` is available for
  callers who want the model to plan instead.

**Still open:** no page fetching — Atlas cites snippets, so a claim is only as
good as the snippet supporting it (no Firecrawl/Jina equivalent). No SearXNG or
Serper. The local planner is deliberately dumber than a model planner. Research
runs are not persisted, so reopening a conversation shows the answer and sources
but not which queries produced them.

### Agentic execution — EXISTS, on the wrong surface

`lib/engine/task-loop.ts` implements
`INTAKE → CLARIFY? → EXPLORE → PLAN → (approve) → EXECUTE ⇄ VERIFY → SELF-CORRECT → REVIEW → DELIVER`
as a pure reducer plus an async runner with an attempt budget. Around it:
`verify.ts`, `changeset.ts`, `security.ts` (secret scanning wired into file writes),
`trace.ts` — each with tests. Sandbox is `lib/code/workspace.ts` (WebContainer, with
an in-memory fallback when cross-origin isolation is absent). Checkpoints and revert
exist in `components/code/agent-panel.tsx`.

All of it is `/code`. Chat reaches it only through `lib/chat/escalate.ts`, behind the
default-off `chatEscalation` flag. **P8 is largely a bridging exercise, not a build.**

Note for P8: WebContainers need COOP/COEP, and `next.config.mjs` scopes those headers
to `/code` only.

**Closed in P8/P9 for chat.** `lib/agent/plan.ts` is the state machine and
`lib/agent/run.ts` the step loop; `PlanPanel` is the approval gate, and the
composer's plan-mode toggle turns it on. What did *not* transfer is EXECUTE and
VERIFY, which read files, apply changesets and run `npm test` — chat has no
workspace, and a loop reporting verdicts nothing verified would be worse than no
loop. A chat step is therefore `done` or `failed` by whether its turn errored,
and nothing richer is claimed. Plans live in component state only: reopening a
conversation shows the answers, not the plan that produced them.

### GitHub — PARTIAL *(updated after P9)*

At audit time: icons and links only, `gitExport` declared and never read, no octokit.

**Closed in P8:** `lib/github/api.ts` plus `/api/v1/github` give **read-only**
repository access — `owner/repo` and URL parsing (including `/tree/<ref>/`), path
confinement with the same normalise-before-check rule as the memory filesystem,
per-segment encoding, size and binary guards, and errors phrased so a 404 reads
as "possibly private" rather than "missing". The token rides in `Authorization`,
never a query string, and the route stores and logs nothing. No octokit: the
surface used here is two endpoints.

No SSRF guard, deliberately — the host is always `api.github.com` and every path
segment is validated against GitHub's naming rules, so the destination is not
caller-controlled. **That property is load-bearing:** the moment this route
accepts a caller-supplied URL it needs `lib/mcp/url-guard.ts` with it.

**Closed in P9 — the chat-facing half.** A read-only `github` tool (`list`, `read`)
now reaches that route, gated on its own composer toggle for the same reason
`web_search` is: it makes an outbound request carrying repository names the user
typed. A `GithubDialog` holds the optional token, BYOK-encrypted by the same store
as the provider key and forwarded once per call as `x-github-token`. Verified live
against the running app: the model called the tool and returned the real root
listing of `vercel/next.js`.

**Still open — writing.** No PR, branch, gist or commit. A write is a side effect
on a real account and needs the per-call approval design connectors got in P6;
shipping a write path without that gate would be worse than shipping nothing.
`gitExport` therefore remains unread.

### Plugins — MOSTLY DONE *(updated after P9)*

At audit time: `/hub` existed but is a model-discovery page, not a marketplace.

**Closed in P8:** a plugin is a *bundle* of what P5 and P6 already built — skills
and connectors installed and removed as one unit — rather than a third extension
mechanism competing with them. `lib/plugins/manifest.ts` validates every skill
with the standalone `parseSkillMd` and every connector URL with the same
`guardConnectorUrl` the proxy uses, so a bundle is never a way past a check that
applies individually. The schema has **no token field**, so a manifest cannot ship
a credential the user cannot see. Conflicts are surfaced before installing.

`lib/plugins/registry.ts` records **the ids an install created**, not the manifest
it came from, because that is what makes uninstall exact: re-deriving ids later
would remove whatever currently holds them, including a skill the user has since
rewritten. Installs are recorded item by item, so a partial install is still
cleanly uninstallable.

**Closed in P9 — the manager.** `PluginsDialog` is a two-step flow: parse and
validate, then show what the bundle would add in words (`describeInstall`) plus
any conflicts with what is already installed, and only then offer Install.
Verified live: a bundle with an `http://127.0.0.1` connector was refused, a valid
one installed a skill and a connector, its `token` field was dropped, and
uninstalling removed exactly those two and left the three built-in skills.

**Still open:** no marketplace or discovery — a manifest is pasted. No signing or
provenance, so trust in a plugin is trust in wherever it came from, which the
dialog says outright rather than implying a review that does not exist.

### Tool calling in Chat — PARTIAL, and worth singling out

The router supports tools end to end: `ToolDef`, `ToolCallRequest`, indexed
`delta.tool_calls[]` accumulation, and pass-through at
`app/api/v1/router/chat/route.ts:89`. Chat renders tool calls
(`components/tool-call.tsx`, `StoredToolCall`).

But `chat-client.tsx` sends only `{ modelId, messages, reasoningEffort }` — **no
`tools` key**. The chat UI renders results it can never receive. Wiring this is
cheap and unblocks P4–P7, all of which are tool-driven.

### Tool calling in Chat — *(updated after P18)*

The registry gained Atlas's own modules — `atlas_graph`, `atlas_catalog`,
`atlas_cost`, `atlas_news` — behind an `atlasTools` toggle, and `lib/tools/spec.ts`
now classifies every tool from all three surfaces by what running it actually
does. `lib/tools/policy.ts` generalises the connector approval gate to every tool
that writes or spends, keeping its three properties: default `ask`, memory per
*tool* rather than per surface, and a self-declared `readOnlyHint` that never
grants anything.

### Provider abstraction / capability registry — EXISTS

`lib/catalog/availability.ts` is the arbiter §1.2 asks for: `routeCost()` and
`modelAvailability()` return `free | your_key | needs_key | unavailable` with the
guarantee that a `free` verdict means every failover candidate is zero-cost.
`lib/catalog/models.ts` carries `contextWindow`, `modalities`, and
`capabilities{toolUse, structuredOutput, reasoning, caching}` per model.
`lib/hooks/use-route-env.ts` mirrors the same verdict client-side.

---

## 3. Constraint compliance (spec §1)

| # | Constraint | Before P0 | After P0 |
|---|---|---|---|
| 1.1 | Next 15 App Router + TS + Tailwind + shadcn + Supabase + OpenRouter | ✅ | ✅ |
| 1.2 | Capability registry, graceful degradation | ✅ `lib/catalog/availability.ts` | ✅ |
| 1.3 | BYOK in-browser, **WebCrypto at rest** | ❌ plaintext `localStorage`; vault `btoa` | ✅ AES-GCM, non-extractable IndexedDB key |
| 1.4 | Zero telemetry, self-hosted bundler | ⚠️ no analytics, but artifacts loaded React+Babel from `unpkg.com` | ✅ vendored to own origin |
| 1.5 | Local-first, **IndexedDB default** | ⚠️ works offline, but via `localStorage`, not IndexedDB | ✅ closed in P1 — `lib/chat/repo-idb.ts` |
| 1.6 | Single Next app, not a monorepo | ✅ | ✅ |
| 1.7 | Free-tier hosting; WebContainers default | ✅ no E2B | ✅ |
| 1.8 | Cartographic Intelligence design system | ✅ | ✅ |
| 1.9 | **RLS on every table via auth.uid()** | ❌ all 17 tables `using (true) with check (true)`, no auth layer | ✅ migration `0005` + Supabase Auth |

One note on the honest reading of this table:

**§1.9 could not be verified empirically in this environment.** Supabase is not
configured locally (`/api/v1/persistence` → `{"configured": false}`), so the
two-account isolation test in the plan could not be run. The policies are written
and reviewed but **unproven against a live database**. This is called out again in
`SELF-AUDIT.md`; it is the single largest open verification item from P0.

---

## 4. Security defects found and fixed

Discovered during the audit, not previously tracked.

**4a. Artifact iframe sandbox escape — the severe one.**
`artifact-panel.tsx` set `sandbox="allow-scripts allow-same-origin"`. That
combination is self-defeating: the frame runs at Atlas's own origin, so
model-generated code could read `parent.localStorage` — where the BYOK OpenRouter
key was sitting in cleartext. A model, or anyone who could influence its output,
could exfiltrate the user's API key.

Demonstrated, not assumed. The same payload under both configurations:

```
old config (allow-scripts allow-same-origin) → "ESCAPED: atlas1.FAKEIV.SEALEDBLOB-decoy"
new config (allow-scripts, + CSP)            → "BLOCKED: SecurityError"
```

**4b. Pop-out was worse.** `openTab()` opened the artifact as a `blob:` URL. A blob
inherits the creating document's origin, and a top-level document cannot be
sandboxed after the fact — so this ran model code at full origin privilege with no
sandbox at all. Replaced with `/artifact/preview`, a first-party shell that re-hosts
the artifact in the same locked-down iframe.

**4c. Third-party CDN.** React UMD and Babel standalone were fetched from
`unpkg.com` per render: a §1.4 violation, and incompatible with the COEP
`require-corp` header WebContainers need. Now vendored to `/artifact-runtime/`.

**4d. Cleartext key at rest.** What 4a exposed. Now AES-GCM.

Regression guards: `lib/chat/artifact-sandbox.test.ts` asserts `allow-same-origin`
never returns and that no remote host appears in `script-src` or `img-src`.

---

## 5. Reusable assets — build on these, don't replace them

This is the most actionable section.

- **`lib/router/index.ts` — keep it.** Swapping in the Vercel AI SDK would discard
  hardened failover, three-tier timeouts, the `stream_options` retry, per-provider
  param stripping, and secret scrubbing, all with production comments explaining
  why each exists. Add MCP as a separate client that emits the existing `ToolDef`
  shape.
- **`lib/chat/tree.ts`** — branching is done.
- **`lib/chat/repo.ts`** — the `ChatRepo` interface is where the IndexedDB driver goes.
- **`lib/engine/orchestrator.ts`** — `parseAgentMd()` seeds the SKILL.md parser;
  `fanOut()` seeds research subagents.
- **`lib/engine/task-loop.ts` + `lib/code/workspace.ts`** — the P8 loop exists.
- **`lib/catalog/availability.ts`** — the §1.2 capability arbiter.
- **`lib/chat/attachments.ts`** — parsers already cover the spec's upload matrix.
- **`lib/chat/health.ts`** — P4's compaction requirement, already met.
- **`lib/crypto/secret-box.ts`** *(new)* — reuse for MCP `connector_tokens` in P6.

---

## 6. Re-scoped roadmap

| Phase | Spec assumed | Reality | Revised scope |
|---|---|---|---|
| ~~P1 Core + branching~~ | Build the tree | Built and tested | **DONE** — active leaf persisted, explicit fork, tool calling wired, IndexedDB driver |
| ~~P2 Artifacts~~ | Build panel | Existed, ephemeral | **MOSTLY DONE** — persistence + version history + revert, `window.storage` bridge, pinned runtime set, `chat-client.tsx` extracted. Remix landed in P16; **publish and the embed snippet still outstanding** (both need a public route, so both wait on the RLS gate). Sandpack deliberately not adopted (see §7) |
| ~~P3 Projects + RAG~~ | Build both | Stuffing worked; vector layer dead | **MOSTLY DONE** — chunk/embed/retrieve pipeline, threshold switch, instruction override, `match_embeddings` wired. **Projects-to-DB and Supabase pgvector writes deferred** (sync, gated on unverified RLS) |
| ~~P4 Memory~~ | Build all | Compaction done | **MOSTLY DONE** — 6-command `/memories` tool with path confinement, past-chat RAG with citations, categories + editable summary, incognito enforced at the repo seam. **Memory sync to Supabase deferred** (same unverified-RLS gate) |
| ~~P5 Skills~~ | Build all | Parser reusable | **MOSTLY DONE** — SKILL.md parser with actionable errors, measured progressive disclosure, enforced `allowed-tools`, registry + editor UI, three built-ins. **Skill sync and sharing deferred** (sync on the RLS gate; sharing needs its own opt-in design) |
| ~~P6 MCP~~ | Build all | Nothing | **MOSTLY DONE** — protocol layer, stateless proxy with a two-layer SSRF guard, PKCE (RFC 7636 vector verified), sealed tokens, per-tool approval gate, connectors UI. **OAuth flow not wired end to end** (no metadata discovery, no callback route — tokens are pasted); resources/prompts/sampling not implemented |
| ~~P7 Research~~ | Build all | `fanOut` + citations reusable | **MOSTLY DONE** — `fanOut` promoted to chat, BYO search providers (Brave/Tavily/Exa + keyless default), enforced query/source/round/time budgets, citation reconciliation, rule-based planner. **No page fetching** (snippets only); runs are not persisted |
| ~~P8 Agentic/GitHub/Plugins~~ | Build all | Loop exists in `/code` | **PARTIAL** — plan-and-approve for chat reusing the engine's `Todo` (the /code loop's EXECUTE/VERIFY need a workspace chat lacks, so they were not transplanted); plugins as bundles of skills + connectors with exact uninstall; GitHub **read-only**. Logic only — no surfaces |
| ~~P9 Surfaces~~ *(added; not in the original §5)* | — | P8 shipped three features with no UI | **MOSTLY DONE** — plan mode end to end (draft, edit, approve, run step-by-step, stop), the `github` tool with a BYOK token dialog, and a plugin manager with a review-then-install gate. All three exercised live against a real model. **GitHub writes, plugin marketplace/signing, and persisted plans still open** |

| ~~P10 Artifact build engine + process encapsulation~~ *(added; not in the original §5)* | — | Atlas could not build and show a landing page | **MOSTLY DONE** — output budget and automatic resume after truncation, a fence scanner that tolerates an unterminated block, streaming preview and auto-open, an artifact card instead of raw source in the transcript, vendored Tailwind, runtime error capture with a repair action, patch-based editing via the `artifact` tool, and one collapsed activity row in place of the sibling card stack. Sandbox, CSP, Tailwind and the error channel verified live in a real frame, and all seven acceptance checks re-run on a hydrated page; **the provider was stubbed at the SSE seam, so no real model has driven it — see SELF-AUDIT §P10.5** |

| ~~P11 Documents, decks and PDF~~ *(added; not in the original §5)* | — | Every artifact was a program; no way to export one | **MOSTLY DONE** — `document` and `slides` artifact types written in Markdown, rendered by the app's own escaping Markdown renderer rather than a sandbox, and PDF export through the browser's own print pipeline with no PDF library: prose prints from a same-origin frame, executable artifacts print themselves over a third postMessage protocol. Verified live end to end on a hydrated page. **No print dialog was confirmed by eye, and no real model has been asked for a document — see SELF-AUDIT §P11.5** |

| ~~P12 Image output~~ *(added; not in the original §5)* | — | `modalities` only ever meant vision *input*; a model returning an image produced an empty bubble | **PARTIAL** — a pure parser with a scheme allowlist for the several shapes providers use, an `image` router event, an `outputModalities` field the sync now populates from OpenRouter, and generated images stored as attachments and rendered inline with download. A live run caught a `javascript:` URL reaching an `<img src>` and the download `<a href>`, fixed by re-validating client-side. **No real image model has been called; discovery and pricing were left open and closed in P13 — see SELF-AUDIT §P12.5** |

| ~~P13 Image models: discoverable and priced~~ *(added; not in the original §5)* | — | P12 could render an image but nothing could find a model that makes one, and the turn's cost line under-reported it by roughly an order of magnitude | **MOSTLY DONE** — `imageOutputPerM` on `ModelPricing`, synced from OpenRouter's `pricing.image_output`; image-output tokens read off the usage frame, carried on the message and persisted; `messageCostUsd` charges them at the image rate and subtracts them from the text total instead of billing both; an image marker in the model picker, a capability chip on the model detail, and an "Image output" filter on the leaderboard. Verified live that the fields survive the catalog API and that the filter renders. **The filter was not driven by a click and the detail chip was not seen — the browser pane would not composite; and the shipped snapshot still contains no image model, so the markers are dark until a sync runs — see SELF-AUDIT §P13.5** |

| ~~P14 Addressing a build's files~~ *(added; not in the original §5)* | — | Storage, the fence parser, the panel switcher and the Babel bundler all understood several files; the `artifact` tool could only reach the one on screen, so iterating on a four-file build meant re-emitting three of them | **MOSTLY DONE** — `ArtifactHandle` carries the whole file list and its own path, `writeArtifact` takes an address, and the tool gained `list` and `create` plus a `path` on `read`/`update`/`rewrite`, validated by the fence parser's own rule so both entry points agree on what a path is. The repair round reads the build too, so an error thrown in a module can be patched in that module. **Not driven live — the browser pane would not composite; see SELF-AUDIT §P14.5** |

| ~~P15 Removing and moving a file~~ *(added; not in the original §5)* | — | The tool could add and change a file but not delete or rename one, so a file written to the wrong path stayed in the panel, the bundle and the model's context | **MOSTLY DONE** — `delete` and `rename` on the `artifact` tool. The delete is **soft**: the record, its whole version history and its `window.storage` rows survive, listings filter it out, and writing the path again revives the same id rather than starting a second file with the same name. Rename changes the path field alone, for the same reason — `artifact_storage` is keyed by artifact id, so create-plus-delete would silently drop the page's saved state. The last file cannot be removed. **Not driven live, nothing garbage-collects a deleted record, and no UI shows the user one exists; see SELF-AUDIT §P15.5** |

| ~~P16 Taking a build with you~~ *(added; not in the original §5)* | — | Every part of a build is keyed by conversation id and nothing copied it, so **fork silently lost the build** — and artifacts had no incognito gate at all, so a temporary chat's build was written to disk and orphaned there | **MOSTLY DONE** — `copyBuild` duplicates records, full version history, `window.storage` rows and the `/workspace` filesystem under fresh ids; fork now calls it, and a Remix action carries the build into a new chat without the transcript. Separately, artifact persistence gained the incognito gate `lib/chat/incognito.ts` already claimed it had: writes land in a session-only overlay, reads still fall through to disk, and the overlay is discarded when the mode ends. **Not driven live — the browser pane would not composite; publish (public slug) and the embed snippet remain behind the RLS gate; see SELF-AUDIT §P16.5** |

| ~~P17 Deleting actually deletes~~ *(added; not in the original §5)* | — | `deleteConversationCascade` drops the conversation and its messages; artifacts, version history, `artifact_storage` and the whole `/workspace` survived every delete, and `WorkspaceRepo.clear()` — documented as *"Used when the conversation is deleted"* — had no caller outside its own test | **DONE** — `deleteBuild` removes a conversation's records, versions, saved storage and workspace, wired into `chat-store.remove`; `sweepOrphanedBuilds` collects the builds left by every earlier delete and by every pre-P16 temporary chat. The sweep deletes on the strength of an absence, so it refuses to run unless the caller can claim its conversation list is complete — never against the Supabase driver, whose `listConversations()` sets no limit while PostgREST caps rows server-side — refuses an empty list, and spares any build touched within 24h. **Not driven live — the browser pane would not composite; a workspace with no artifacts is not reachable by the sweep; see SELF-AUDIT §P17.5** |
| ~~P18 The task-execution surface~~ *(added; not in the original §5)* | — | A user selected a streaming build bubble and reported three faults: unresponsive, overflowing sideways, and red where it should be `--foreground`. All three were one **state** bug — the prose fallback is *gated on* `error: true`, `patchMessage` shallow-merges, and the flag was cleared only after the whole retry finished, so a build that was busy succeeding rendered in the failure style for its entire run, unstripped and unwrapped | **DONE** — the recovery clears the flag when it *starts* and records itself as an activity note; text now counts as an answer even when no file parses out of it, so only a retry that returned nothing at all stays failed. The failure notice itself renders its body in `--foreground` with a `--danger` icon and short label — Terrain's own rule that a failed state never rests on hue alone — wrapped, broken and height-capped. `LiveStatus` had an inverted gate (`!streaming`) and so never appeared during a run; `ToolCall` and `ReasoningBlock` gained a flat `row` variant so a six-tool turn stops drawing seven frames inside the one card built to prevent that; `PlanPanel` and `ResearchProgress` fold when finished; touch targets, `aria-expanded` and wrapping swept across the run panel, rail, files tab and sources. **Driven live in both themes at 1400/820/375 px — see SELF-AUDIT §P18** |
| ~~P19 The unfinished build renders~~ *(added; not in the original §5)* | — | Every build showed “2 errors” over a blank preview: `index.html` links to `styles.css` and `app.js`, and `inlineHtmlAssets` treated a relative reference it could not resolve as a **build failure**, so `buildArtifactDoc` returned `doc: ""`. That is the normal state of every multi-file build — a model plans the page before the files the page links to — and the permanent state of one the provider cut short, so the whole page was discarded over a file the next tool round was about to write. It was also self-inconsistent: an *absolute* URL that cannot load left the page rendering | **DONE** — a missing relative asset is now a warning, not an error. The dead tag is dropped (left in, the relative URL resolves against the opaque origin and fires a `resource` error that `FATAL_RESOURCE` calls fatal — one missing file, reported twice), the page renders unstyled exactly as a browser does with a 404, and a second `--warning` strip names each file and the correction. Still worth a repair turn: `verifyArtifact` now runs the document *and* passes the warnings into the triage as fatal, so “fatal” means “worth a turn” rather than “the frame is blank”. **Driven live in both themes — see SELF-AUDIT §P19** |

| **P18 Graph-RAG, one tool plane, orchestration, voice, MCP server** *(added; not in the original §5)* | — | Retrieval was flat prose chunks, so the ~400-model catalog and the news corpus with its already-resolved `models[]` links were unreachable; Atlas's other 15 modules were dark to the agent; sub-agents were capped at a hardcoded 3 and their outcomes discarded; the agent lived only at `/chat`; and voice was a 130-line dictation hook | **MOSTLY DONE** — a knowledge graph derived from the shipped snapshot (no network, no key), hybrid mention+similarity seeding with budgeted traversal and personalised-PageRank ranking, citations reconciled by the *existing* `reconcileCitations`; a tool-class table with a drift guard plus an approval gate generalised from `lib/mcp/approval.ts`; four Atlas-module tools each thin over the function the UI already calls; typed sub-agent roles with a budget-derived cap and an append-only persisted trace; a voice stack with VAD, endpointing, streaming segmentation, barge-in and catalog-vocabulary correction (20/20 on misheard terms, zero false corrections); a Map/Agents/Log console and an Ask Atlas panel on every workspace screen; and Atlas exposed over MCP, driven live. **`streamInto` was not migrated onto the session runner, so the orchestration trace has no driver on the chat page and there is no Map tab in the rail; no live model turn and nothing heard aloud — see SELF-AUDIT §P18.5** |

| ~~P20 The agent reaches Atlas, and speaks~~ *(added; not in the original §5)* | — | Three whole subsystems were built, unit-tested and had **zero callers in the running app**. `atlas_graph/catalog/cost/news` were unreachable from `/chat`: `atlasTools` was never set in `toolAvailability` and no `atlas` port was ever put in the tool context, so every call answered “unavailable this turn”. `lib/tools/policy.ts` — the generalised approval gate whose own docstring names `atlas_prompt` and `atlas_bench` — had no consumer, and neither did `toolIndexBlock`. `useSurfaceContext` was described in a docstring and did not exist, so none of the sixteen modules published anything and every question asked from the dock was answered against a route name. `lib/voice/*` — VAD, endpointing, the five-phase session machine with barge-in, the lexicon, the segmenter, the speech planner — was imported by nothing but its own tests. Every Atlas tool was a `read`: the agent could describe the workspace and could not act in it. And `lib/chat/idb.ts` carried three unresolved merge-conflict markers, so `tsc` failed outright and the app did not build | **MOSTLY DONE** — conflict resolved (both the graph/orchestra and the Compare stores, `DB_VERSION = 12`). Atlas tools reach `/chat` behind a default-**on** toggle, with graph, news and route-env ports on both the chat page and the dock; `toolIndexBlock` now tells the model which tools ask first. Two acting tools: `atlas_open` deep-links into Compare, Cost, the Leaderboard, the Playground and a news story using only `searchParams` keys the routes actually read, refusing an id the catalog does not have rather than landing someone on an apology; `atlas_prompt` saves a worked-out prompt into the library, appending a version rather than overwriting. Both go through `decideToolApproval`, which now has its first caller — and only writes with no switch of their own are gated, because twenty dialogs in a twenty-round build is a gate people learn to click through. `useSurfaceContext` exists, and Leaderboard, Cost, News, Compare and Playground publish through pure, tested summary builders. Voice conversation is a surface: an `AnalyserNode` feeds the existing VAD, `SpeechRecognition` supplies words while the VAD owns turn-taking, answers are narrated sentence-by-sentence as they stream, and talking over one interrupts it. **The spoken happy path was never heard — microphone capture is blocked in the browser pane, so only the permission-denied path was driven live. `atlas_open`/`atlas_prompt` were exercised through `executeTool` in tests, not clicked through the approval dialog. See SELF-AUDIT §P20** |

| ~~P21 Voice that acts~~ *(added; not in the original §5)* | — | The voice surface shipped in P20 could answer questions and **do nothing else**: `voice-mode.tsx` passed no `navigate` port, no `prompts` port and no `onApproval`, so every write was refused by construction. There was no intent layer either, so “open Compare” cost a full model round-trip and up to four tool rounds to accomplish a `router.push`. It was also slow in four separate places at once: 600 ms of endpoint silence even after the recogniser had already finalised the words, the knowledge graph built *during* render, no audio at all until a **complete sentence** had arrived, and whatever voice the OS defaults to — David or Zira on Windows — with no voice, rate or prewarm anywhere, and no handling of Chrome’s 15-second cutoff | **MOSTLY DONE** — an intent layer (`lib/voice/intent.ts`) answers navigation, selection, filter, playback and session commands **without a model**, biased hard towards asking: question openers are rejected, the navigation verbs are a closed list, and a phrase naming two modules resolves to nothing rather than guessing. `surface-commands.ts` is the write half of `surface-context.ts`, so “show only free models” changes the Leaderboard you are looking at instead of opening a second one — and a command the current page cannot take is *routed* to the module whose job it is, through the same `hrefForOpen` the tools use. The withheld ports are wired, with the P20 objection answered rather than overruled: the approval is **spoken**, a card shows the identical sentence, silence is never consent and a timed-out confirmation is a refusal. Latency: a backchannel fills the gap, the first piece of an answer cuts at a clause instead of a full stop, a finalised transcript ends the turn at 380 ms, voices are ranked and the Chrome cutoff is worked around. “Hey Atlas” runs on the *same single recogniser*, armed only while the surface is closed, and carries any command that rode along with the greeting. New surface: an audio-reactive canvas orb, word-by-word captions from the synthesiser’s own boundary events, a transcript drawer and a settings sheet whose command list is generated from the parser’s own tables. **Nothing was heard aloud — microphone capture is blocked in the browser pane, so no spoken turn, no wake, no barge-in and no command was ever driven end to end; all three flags therefore ship OFF. See SELF-AUDIT §P21** |

Sequencing note: wiring chat tool-calling was a prerequisite for P4–P7, which are
all tool-driven. It landed in P1, so those phases are now unblocked — a new tool is
an entry in `lib/chat/tools.ts` and nothing else.

---

## 7. Deviations and inference labels

Per §8, flagging where the spec describes Claude.ai behaviour Anthropic has not
publicly documented. These will be implemented to the spec's description but must
not be reported as verified parity:

- **`window.storage` semantics** for artifacts (API shape, sharing model,
  persistence guarantees) — **inference**. Implemented in P2 as a promise-based
  `get/set/delete/list(prefix)` namespaced per artifact. The API *shape* follows
  the spec's description; whether it matches Claude's is unverified.
- **The ~150K-token auto-RAG threshold** for projects — **inference**. The
  switchover exists as a concept; the specific number is not documented.
- **Skill progressive-disclosure mechanics** — the spec's staged
  name+description → body → resources model is a reasonable reading, but the exact
  trigger and eviction behaviour is **inference**.

Parity items not reachable as specified under the §1 constraints, which belong in
§8.3 as substitutes rather than gaps to close:

- **Anthropic-hosted server-side tools** (their web search, code execution) — not
  available through OpenRouter. Substitute: BYO search providers (P7) and
  WebContainers (P8).
- **E2B sandboxes** — conflicts with §1.7 (free tier). Remains opt-in BYO-key;
  WebContainers stay the default.
- **Sandpack for React artifacts** — the spec names
  `@codesandbox/sandpack-react` with a self-hosted bundler. **Deliberately not
  adopted** in P2: self-hosting the Sandpack bundler means deploying a second
  always-on service, which §1.7 (Oracle Always Free) rules out, and the hosted
  bundler is a third-party endpoint that §1.4 rules out. The vendored
  Babel-standalone path already satisfies what the requirement is *for* —
  self-hosted, zero third-party requests, pinned runtime set — at ~3MB of static
  assets and no server. Substitute, not parity.
- **Tailwind inside artifacts** — its browser build is a JIT compiler
  distributed via a third-party CDN, which §1.4 rules out. The system prompt
  tells the model to use inline styles instead, so this fails loudly at
  generation time rather than silently at render time.
- **Provider-dependent extended thinking and prompt caching** — degrade per the
  capability registry rather than being uniformly available.

---

## 8. Also worth fixing, not yet scheduled

- **7 dead feature flags** in `lib/flags.ts`: `evalLab`, `deepResearch`,
  `artifactsFileGen`, `repoIntel`, `gitExport`, `promptOptimizer`, `promptCoaching`.
- **8 dead tables** and the unused `match_embeddings` RPC.
- **`messages.pinned` is lost on reload** — the column doesn't exist, and
  `repo.ts:227` silently early-returns on a `pinned` patch.
- **ESLint is installed but unconfigured** (no `.eslintrc*`), `next.config.mjs` sets
  `eslint.ignoreDuringBuilds: true` with a comment saying lint runs in CI, and
  `.github/workflows/verify.yml` does not run it. Lint currently runs nowhere.
- **`chat-client.tsx` is 1947 lines** holding 11 components. Every later phase
  touches it.
- **Two different `ChatMessage` types** share a name (`lib/chat/types.ts` UI-side,
  `lib/router/index.ts` wire-side); `chat-client.tsx` redeclares a third locally.
