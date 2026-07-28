# LLM Atlas

**The open ecosystem for everything LLM — learn, research, compare, cost, and build in one workspace you can self-host.**

A professional, fully responsive, animation-rich Next.js 15 application realizing the LLM Atlas product: a unified workspace over the entire LLM lifecycle, with a shared catalog, cost engine, and an OpenAI-compatible inference router underneath.

> Built in the **"Cartographic Intelligence"** design language — dark-first, a luminous cyan→violet accent, an interactive constellation hero, and disciplined Framer Motion throughout. Light mode ships fully polished too.

---

## ✨ What's inside

**Landing page** — an interactive Canvas constellation of model nodes, count-up proof stats, an ecosystem constellation map of every module, scroll-pinned feature deep-dives with live animated previews, an animated `docker compose up` terminal, an architecture diagram, social proof, and a magnetic closing CTA.

**Workspace shell** — collapsible icon-rail sidebar (Build · Research · Catalog · Learn), top bar with breadcrumbs, a model/router quick-switcher, theme toggle, and a global **⌘K command palette** (fuzzy nav + model switch + actions). Mobile gets a bottom tab bar, slide-over drawer, and a floating ⌘K button.

**Four flagship modules (built deep):**

| Module | Highlights |
|---|---|
| **Leaderboard** | Faceted filters, **FLIP re-ranking**, attributed benchmarks, expandable detail panels with Recharts, side-by-side compare tray |
| **Compare** | One query fanned out to N models **streaming in parallel**, then a synthesis panel highlighting agreements (green) & divergences (amber, pinnable) |
| **Cost** | Live-recomputing workload calculator, self-host TCO + break-even, a **cost-vs-capability frontier** scatter, CSV export |
| **Chat** | Streaming with reasoning + tool-call rendering, **message-tree branching** (edit-fork, regenerate with model swap, sibling nav), attachments (PDF/DOCX/CSV/XLSX/images), **Artifacts v2** (HTML/SVG/Markdown/Mermaid/React + version diffs), memory, projects, keyless **web search with citations**, voice dictation/read-aloud, per-message cost, Markdown/JSON export |

**Also fully built:**

| Module | Highlights |
|---|---|
| **Code** | A **real browser-side coding agent**: Node 20 via WebContainer + Python via Pyodide, three-pane IDE (file tree · Monaco · live terminal). Seven-tool agent loop (read/write/edit/delete/run/python/**subagent**), **plan mode** (propose → approve → execute), per-tool **allow/ask/deny policy + hooks**, `ATLAS.md` project memory, auto-checkpoints with restore, per-change diffs with revert, persistent sessions, and a **dev-server preview** pane via WebContainer `server-ready` |
| **News** | Live AI news from ~30 first-party, research and press feeds. Re-synced hourly with no API key, de-duplicated into cross-publisher clusters, scored for provenance (`verified` / `corroborated` / `reported`), and always linked to the original |
| **Playground** | Multi-turn conversation editor streamed across models side-by-side — full parameter surface (top-k, penalties, stop, seed, reasoning effort, JSON mode), **function-calling tools**, `{{variables}}`, presets, starred run history, and **export as cURL/TypeScript/Python** with real TTFT/tokens/cost metrics |
| **Learn** | Model-connected lessons with a live "Run this live" cell, auto-graded quizzes, a learning-path constellation, and a self-branded certificate |
| **Flow** | An interactive multi-agent builder — draggable nodes, drag-to-connect ports, an inspector, and a Run that animates execution through the graph (parallel branches) |
| **Router** | An inference-gateway dashboard — provider status, **cost-aware routing** (cheapest model meeting constraints) with a fallback chain, and a live request log |
| **Bench** | A reproducible eval runner — pick suites + models, run real graded evals (contains/regex/JSON/word-count), and read a model×suite score matrix with reproducibility metadata |
| **Prompt** | A versioned prompt library — `{{variable}}` templates with live fill/preview, a per-prompt changelog, tags, and one-click open-in-Playground (localStorage-persisted) |
| **Hub** | An orchestrator home — trending / new / free-open / frontier-BYOK model rails, each card jumping straight into Chat, Compare, or Cost |
| **Vault** | A credentials manager — connect and **live-test** your BYOK model key (real OpenRouter key-info check), see operator provider status (server truth, keys never exposed), store tool secrets, and read a full access trail |

The remaining modules (Datasets, Notebooks) ship as styled, navigable placeholder pages so the whole ecosystem is explorable.

---

## 🧠 Atlas Router (real inference)

Atlas Router is an OpenAI-compatible gateway. All three configured providers share one adapter:

- **NVIDIA NIM** — `https://integrate.api.nvidia.com/v1` (Nemotron + many open models)
- **OpenRouter** — `https://openrouter.ai/api/v1` (one key, hundreds of models)
- **Local** — `http://localhost:11434/v1` (Ollama / vLLM / llama.cpp)

Operator keys are read **server-side only** from `.env.local` and never exposed to the client. BYOK user keys live in a client-side vault and travel per-request as a header — never stored server-side, never logged. With no key configured, Chat and Compare show a graceful "connect a provider" state instead of failing.

---

## 💾 Persistence (optional Supabase)

Everything runs **without any database** — conversations, playground presets/runs, and code sessions persist to `localStorage`. Set `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` and apply `supabase/migrations/0001_init.sql` to light up server-side persistence (Postgres + pgvector). The Supabase client is **lazy-loaded on first use**, so it costs nothing on page load either way.

---

## 🚀 Getting started

```bash
npm install
cp .env.example .env.local     # add one provider key (optional — the app runs without it)
npm run dev                    # http://localhost:3000
```

To enable live Chat / Compare, set **one** of these in `.env.local` and restart:

```bash
NVIDIA_API_KEY=...        # from https://build.nvidia.com
# or
OPENROUTER_API_KEY=...    # from https://openrouter.ai/keys
# or point at a local OpenAI-compatible server
LOCAL_BASE_URL=http://localhost:11434/v1
```

Production build:

```bash
npm run build && npm run start
```

---

## 🧩 Tech stack

- **Next.js 15** (App Router, RSC, Route Handlers) · **TypeScript** (strict)
- **Tailwind CSS** with CSS-variable design tokens (dark + light)
- Hand-built **shadcn-style** primitives on **Radix UI** + **cva**, **cmdk** palette
- **Framer Motion** · **Recharts** (lazy) · **Zustand** · **Lucide** · **next-themes**
- **WebContainer** (real in-browser Node) · **Pyodide** (in-browser Python) · **Monaco** (CDN)
- **Supabase** (optional, lazy-loaded) · **KaTeX / Mermaid / highlight.js** renderers

## 📁 Structure

```
app/
  (marketing)/        # landing page + nav/footer
  (workspace)/        # authenticated shell + all module routes
  api/v1/             # router/chat (SSE), compare (fan-out), cost/estimate, models, providers
components/
  ui/                 # design-system primitives
  shell/              # sidebar, topbar, model switcher, mobile nav
  landing/            # hero constellation + all landing sections
  leaderboard/ cost/ compare/ chat/ playground/ code/   # module UIs
lib/
  catalog/            # model catalog, benchmarks, providers, pricing (single source of truth)
  router/             # OpenAI-compatible inference gateway (server-only)
  cost/               # cost engine (pure functions)
  chat/               # message tree, repo (Supabase/localStorage), memory, export
  playground/         # config types, repo, export-code generators
  code/               # workspace (WebContainer/memory), pyodide, agent loop, tools, policy, sessions
  supabase/           # lazy browser client + server client
  motion.ts  store/  hooks/
supabase/migrations/  # optional Postgres + pgvector schema
```

---

## 📐 Notes

- Every benchmark number in the catalog carries a `source` + `measuredAt` date (transparency over authority). Values are **illustrative aggregates** of public sources for this build.
- Accessibility: semantic HTML, keyboard-navigable widgets, visible focus rings, and a calm `prefers-reduced-motion` fallback across all animations.
- "Atlas Certified" is a **self-branded** credential and is not affiliated with MIT the institution; the *code* is MIT-licensed.

## 📄 License

MIT.
