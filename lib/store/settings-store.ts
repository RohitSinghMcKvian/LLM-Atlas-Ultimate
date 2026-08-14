"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgenticMode } from "@/lib/chat/agentic";

export type StyleId =
  | "default"
  | "concise"
  | "explanatory"
  | "formal"
  | "creative"
  | "code";

export interface StylePreset {
  id: StyleId;
  label: string;
  hint: string;
  /** Appended to the system prompt. Empty for "default". */
  prompt: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: "default", label: "Normal", hint: "Balanced default", prompt: "" },
  {
    id: "concise",
    label: "Concise",
    hint: "Short and direct",
    prompt:
      "Be concise. Lead with the answer, keep prose tight, and avoid filler or restating the question.",
  },
  {
    id: "explanatory",
    label: "Explanatory",
    hint: "Teach with detail",
    prompt:
      "Be thorough and educational. Explain the reasoning, define terms, and use short examples or analogies where they aid understanding.",
  },
  {
    id: "formal",
    label: "Formal",
    hint: "Professional tone",
    prompt:
      "Use a formal, professional register. Prefer precise vocabulary and complete sentences; avoid slang and contractions.",
  },
  {
    id: "creative",
    label: "Creative",
    hint: "Playful and vivid",
    prompt:
      "Be imaginative and engaging. Use vivid language and fresh framings while staying accurate.",
  },
  {
    id: "code",
    label: "Code-focused",
    hint: "Minimal prose, real code",
    prompt:
      "Optimize for engineers. Prefer runnable code over prose, include types and error handling, and keep explanations to what's necessary to use the code.",
  },
];

export const styleById = (id: StyleId): StylePreset =>
  STYLE_PRESETS.find((s) => s.id === id) ?? STYLE_PRESETS[0];

export type ReasoningEffort = "off" | "low" | "medium" | "high";

interface SettingsState {
  /** "What Atlas should know about you." */
  aboutYou: string;
  /** "How Atlas should respond." */
  responseGuidance: string;
  /** Preferred name to address the user. */
  displayName: string;
  style: StyleId;
  /**
   * Composer toggles. On models the capability registry marks `toolUse`, these
   * also decide which tools are offered — `webSearch` gates the `web_search`
   * tool, so turning it off genuinely prevents the model from searching.
   */
  webSearch: boolean;
  memory: boolean;
  /** Offer installed skills to the model. Gates the index and the `skill` tool. */
  skills: boolean;
  /** Multi-step research: fan out several searches before answering (§4.6). */
  research: boolean;
  /**
   * Offer the read-only `github` tool. Off by default: it sends repository names
   * the user typed to api.github.com, which is an outbound request they should
   * opt into rather than discover.
   */
  github: boolean;
  /**
   * Plan mode (§4, agentic): draft a numbered plan, wait for approval, then run
   * the steps one at a time. Off by default — it costs an extra round trip per
   * turn and most turns do not need one.
   */
  planMode: boolean;
  /**
   * Build mode: the workspace, the task ledger, and the budgets a long build
   * needs (§4, long-horizon builds).
   *
   * A build turn raises the tool-round cap from 4 to 20 and the output budget
   * from 16k to 32k, so a single ill-judged run can cost many times an ordinary
   * turn. That is why this was a plain off-by-default switch — and why the
   * ordinary experience of asking Atlas to build something end to end was four
   * rounds, no filesystem, no plan, and an apology. The toggle was right and
   * nobody found it.
   *
   * Three states now. `"auto"` is the default: `lib/chat/agentic.ts` decides from
   * the shape of the request, and the composer says so before anything is spent
   * — a one-time consent dialog the first time it fires, then a pre-flight strip
   * naming the round cap and the dollar ceiling on every auto turn, with a way
   * out that sticks for the conversation. Detection without that disclosure would
   * just be spending the user's money quietly, which is worse than the bug.
   */
  agenticMode: AgenticMode;
  /**
   * Whether the auto-build consent dialog has been shown.
   *
   * Once per browser, not per conversation. Re-gating every build request would
   * recreate the friction the whole change exists to remove.
   */
  seenAutoBuild: boolean;
  /**
   * Resume automatically after a *round-cap* stop, this many times.
   *
   * 0 by default: an automatic continuation spends money the user did not ask
   * for a second time. `lib/chat/resume.ts` refuses to auto-resume a cost, time
   * or loop stop at any setting — those are stops the user has to answer.
   */
  autoContinueRounds: 0 | 1 | 2;
  /**
   * Offer `run_python` — a sandboxed interpreter with the build workspace
   * mounted, able to produce real .xlsx/.docx/.pdf bytes.
   *
   * Its own toggle rather than riding build mode: running code is useful in an
   * ordinary conversation and a build can be a static page that never needs an
   * interpreter. Off by default only because the runtime is a ~10MB download
   * from a CDN, which is a cost the user should choose to pay rather than
   * discover.
   */
  codeExecution: boolean;
  /**
   * Expand the activity row on every turn instead of collapsing it.
   *
   * Off by default, which is the whole point of the row: the process is
   * available rather than imposed. On for users who want to watch each tool call
   * as it happens.
   */
  detailedActivity: boolean;
  /**
   * Run a finished artifact headlessly and report what broke.
   *
   * On by default, unlike every other capability here, because it is the only one
   * that costs nothing: an offscreen frame and about a second of local CPU. It
   * turns "ship a page that renders nothing" into "say the page renders nothing",
   * which is worth more than the second.
   */
  autoVerifyArtifacts: boolean;
  /**
   * Model turns Atlas may spend fixing its own broken artifact.
   *
   * 1 by default, and only ever spent when verification found a fatal error the
   * model could actually have caused. 0 is a first-class choice, not a disabled
   * state: it keeps the reporting and never spends unasked.
   */
  autoRepairAttempts: 0 | 1 | 2;
  /** Spend ceiling for the whole repair phase of one turn, in USD. */
  artifactRepairMaxUsd: number;
  /** Which search backend to use. Keyless DuckDuckGo by default. */
  searchProvider: string;
  /** Read assistant replies aloud automatically. */
  voiceAutoRead: boolean;
  /** Reasoning effort level for models that support extended thinking. */
  reasoningEffort: ReasoningEffort;

  set: (patch: Partial<Omit<SettingsState, "set" | "toggle">>) => void;
  toggle: (
    key:
      | "webSearch"
      | "memory"
      | "skills"
      | "research"
      | "github"
      | "planMode"
      | "codeExecution"
      | "detailedActivity"
      | "voiceAutoRead"
      | "autoVerifyArtifacts",
  ) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      aboutYou: "",
      responseGuidance: "",
      displayName: "",
      style: "default",
      webSearch: false,
      memory: true,
      skills: true,
      // Off by default: research spends several outbound requests per turn, so
      // it is opted into rather than opted out of.
      research: false,
      github: false,
      planMode: false,
      agenticMode: "auto",
      seenAutoBuild: false,
      autoContinueRounds: 0,
      codeExecution: false,
      detailedActivity: false,
      autoVerifyArtifacts: true,
      autoRepairAttempts: 1,
      artifactRepairMaxUsd: 0.5,
      searchProvider: "duckduckgo",
      voiceAutoRead: false,
      reasoningEffort: "off",
      set: (patch) => set(patch),
      toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SettingsState>),
    }),
    {
      name: "atlas-chat-settings",
      version: 1,
      /**
       * `buildMode: boolean` became `agenticMode`.
       *
       * A user who had found and enabled the old switch was making a deliberate
       * choice, so they get `"always"` rather than being folded into detection —
       * dropping someone from an explicit setting into a heuristic would be a
       * change they never asked for. Everyone else gets the new default.
       */
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Record<string, unknown> & { agenticMode?: AgenticMode };
        if (version < 1 && s.agenticMode === undefined) {
          s.agenticMode = s.buildMode === true ? "always" : "auto";
        }
        delete s.buildMode;
        return s as unknown as SettingsState;
      },
    },
  ),
);

export interface SystemContext {
  style: StyleId;
  aboutYou?: string;
  responseGuidance?: string;
  displayName?: string;
  /** Instructions injected from an active Project (§4.5). */
  projectInstructions?: string;
  /** Relevant recalled memories (§4.7). */
  memories?: string[];
  /** The user's editable summary of what Atlas remembers (§4.7). */
  memorySummary?: string;
  /** Paths in the /memories filesystem, advertised without their contents (§4.7). */
  memoryDirectory?: string;
  /** Installed skills as name + description only; bodies load on demand (§4 Skills). */
  skillsIndex?: string;
  /** Connected MCP services, so the model knows what it can reach (§4 Connectors). */
  connectorsIndex?: string;
  /** True when the session is temporary and nothing will be saved (§4.7). */
  incognito?: boolean;
  /**
   * The build workspace: goal, task ledger and file inventory, already bounded
   * by `buildWorkspaceContext`. Present only in build mode, and only once the
   * build has something in it.
   */
  workspaceContext?: string;
  /** Build mode is on, so the long-horizon conventions below apply. */
  buildMode?: boolean;
  /**
   * Earlier turns have been folded out of the request and can be read back with
   * `recall_context`.
   */
  hasFoldedContext?: boolean;
}

/**
 * What changes when the user turns Build on.
 *
 * Everything here exists because of a specific way long builds used to fail:
 *
 *  - Deliverables went into the reply, so compaction lost them. Now they go into
 *    the workspace, which outlives the messages.
 *  - A page longer than the output limit was truncated mid-fence and abandoned.
 *    Now it is appended in chunks, which has no such ceiling.
 *  - Editing meant re-emitting the whole file, which was slow and changed things
 *    nobody asked to change. Now it is a patch.
 *  - The model had nowhere to record progress, so a resumed build restarted.
 *    Now there is a ledger, and it is read back on every turn.
 *
 * Stated as rules rather than suggestions because a model that treats them as
 * optional produces exactly the old behaviour.
 */
const BUILD = [
  "BUILD MODE is on. You are working on something too large for one reply, so work like an engineer, not like a chat.",
  "Before writing anything substantial, call `tasks` with `plan` and the full list of steps plus a one-sentence `goal`. Then `start` each step as you begin it and `complete` it when it is done. This ledger is shown back to you every turn and is how you know where you are after earlier messages are no longer visible.",
  "Put every deliverable in the workspace with the `workspace` tool, one file per thing: `index.html`, `styles.css`, `app.js`, `src/App.jsx`. Files there persist for the whole conversation; text in your reply does not.",
  "Written deliverables are files too. A report, brief or research sheet is a `.md` file — it renders as a paginated document the user can save as PDF. A slide deck is a `*.slides.md` file with slides separated by a line containing only `---`; that extension is what makes it print one slide per page instead of one long page.",
  "If a file is longer than you can send in one reply, `create` the first chunk and then `append` the rest across several calls. Never stop partway through a file and never leave a placeholder section.",
  "To change an existing file, `view` it and then `str_replace` the part that changes. Do not re-send a whole file to edit one line.",
  "Name files in the fence when you show one, like ```html path=\"index.html\", so it is previewed as that file. A multi-file page is entry `index.html` plus whatever it links to; relative `<link href>`, `<script src>` and ES `import` between workspace files all resolve.",
  "When the build is finished, say what you made and what each file is for. Do not paste the whole source back.",
].join(" ");

// The artifact rules are specific because the sandbox is strict: the frame runs
// at an opaque origin under a CSP with `connect-src 'none'` and no remote hosts
// (see lib/chat/artifact-sandbox.ts). Code that reaches for a CDN or fetches an
// API silently fails to render, so the model is told the actual constraints
// rather than being left to discover them.
const BASE = [
  "You are Atlas, a helpful, precise AI assistant inside the LLM Atlas workspace. Use clean markdown.",
  "When asked to build a UI or page, return a single fenced ```html code block (or ```jsx for a React component) so it renders as an artifact.",
  "Artifacts run fully sandboxed and OFFLINE. Do not load anything from a CDN, and do not fetch() or call external APIs — network requests are blocked and will fail silently.",
  "You may `import` from exactly these, and nothing else: react, react-dom, framer-motion, lucide-react, recharts, d3, three, mathjs, papaparse, clsx, tailwind-merge, next/link, next/image, next/navigation, next/font/google. They are preloaded from Atlas's own origin.",
  // Named as a hard boundary rather than left to be discovered, because the
  // failure is total: one unavailable specifier fails the whole bundle and the
  // page renders nothing at all. Models reach for gsap, react-icons, axios,
  // @react-three/fiber and shadcn/ui by habit, and each one blanked the artifact.
  "Any other package — gsap, axios, react-icons, @react-three/fiber, styled-components, a shadcn/ui path — is NOT available. There is no npm and no network. A single unavailable import fails the entire artifact and it renders as a blank page, so write the code inline instead of importing something that is not on that list.",
  "The `next/*` entries are thin stand-ins for a preview: <Link> renders an <a>, <Image> renders an <img>, and useRouter() is a no-op. There is no routing, no server component and no data fetching — build one page that renders on its own.",
  "Tailwind CSS works in artifacts — write utility classes normally. A <style> block and inline styles work too. Do not add a Tailwind CDN script tag; it is already loaded.",
  "For a page or landing page, write one complete self-contained HTML document and keep going until it is finished — do not stop partway or leave placeholder sections.",
  "Artifacts may persist state across reloads with `await storage.set(key, value)`, `await storage.get(key)`, `await storage.delete(key)` and `await storage.list(prefix)`.",
  "For a written deliverable — a report, a research sheet, a brief, a spec — return markdown in a single fenced ```document block. It renders as a paginated document the user can save as PDF. Start it with a `# Title`.",
  "For a slide deck, return markdown in a single fenced ```slides block and separate the slides with a line containing only `---`. Give each slide a heading and keep it to a few lines; it prints one slide per page.",
  "Use ```document and ```slides only for a real deliverable. An ordinary explanation belongs in the reply itself, not in a fence.",
  // The tool could only ever reach the file on screen until P14, so the prompt
  // told the model to re-emit fences for the rest. It can address them now.
  "A build can hold several files: name them in the fence, like ```html path=\"index.html\" and ```css path=\"styles.css\". To change one afterwards, use the `artifact` tool with that `path` — `list` to see the files, `read` one, `update` to patch it, `create` to add another, `rename` to move one and `delete` to drop one. Do not re-send a file to edit one line of it.",
].join(" ");

/**
 * Ceiling on the whole system prompt, in characters (~6k tokens).
 *
 * Every subsystem that landed since P3 added a block here — project
 * instructions, memory summary, recalled memories, the memory directory, the
 * skills index, the connectors index, and now the workspace. Each is
 * individually bounded, but nothing bounded their *sum*, and on a conversation
 * with a big project, many skills and a large build they compound into a prompt
 * that crowds out the conversation it is supposed to support.
 */
export const SYSTEM_PROMPT_MAX_CHARS = 24_000;

/**
 * A prompt section and how willing we are to lose it.
 *
 * Lower numbers survive. 0 is structural — who Atlas is, and the rules for a
 * build in progress — and is never dropped. The user's own words come next,
 * because discarding an instruction someone typed is worse than discarding an
 * index the model can query with a tool. The three tool indexes are last
 * precisely because they are recoverable: the model can still call `memory`,
 * `skill` or a connector without having seen the listing.
 */
interface PromptPart {
  text: string;
  priority: number;
}

function fit(parts: PromptPart[], max: number): string {
  const kept = parts.filter((p) => p.text.trim().length > 0);
  const size = (list: PromptPart[]) =>
    list.reduce((n, p) => n + p.text.length, 0) + Math.max(0, list.length - 1) * 2;

  if (size(kept) <= max) return kept.map((p) => p.text).join("\n\n");

  // Drop whole sections, least important first, rather than truncating several
  // of them: half a skills index is worse than none — it advertises skills whose
  // descriptions were cut mid-sentence.
  const order = kept
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.priority - a.p.priority || b.p.text.length - a.p.text.length);
  const dropped = new Set<number>();
  for (const { p, i } of order) {
    if (p.priority === 0) continue;
    if (size(kept.filter((_, j) => !dropped.has(j))) <= max) break;
    dropped.add(i);
  }
  const survivors = kept.filter((_, j) => !dropped.has(j));
  const joined = survivors.map((p) => p.text).join("\n\n");
  // Backstop: the structural sections alone are over budget, which means one of
  // them is pathological rather than the set being large.
  return joined.length <= max ? joined : joined.slice(0, max);
}

/** Compose the full system prompt from base + user style + custom instructions. */
export function buildSystemPrompt(ctx: SystemContext): string {
  const parts: PromptPart[] = [{ text: BASE, priority: 0 }];
  const push = (text: string | undefined, priority: number) => {
    if (text?.trim()) parts.push({ text: text.trim(), priority });
  };

  // Immediately after BASE: these rules change how every later instruction is
  // carried out, so they must not read as an afterthought appended to the end.
  if (ctx.buildMode) parts.push({ text: BUILD, priority: 0 });
  // Priority 0, and for the same reason as the workspace block: the model cannot
  // ask about turns it does not know were removed. Without this sentence it
  // reads the summary as the whole conversation and answers from it — which is
  // exactly the confident-substitute failure the recall tool exists to prevent.
  if (ctx.hasFoldedContext)
    parts.push({
      text:
        "Earlier turns of this conversation have been folded out of your context to save room, " +
        "and replaced by a summary. That summary is lossy. Before relying on any specific " +
        "detail from before it — a name, a path, a number, a version, or what the user asked " +
        "for in their own words — call `recall_context` and read the original. Never fill a " +
        "gap in the summary with a plausible guess.",
      priority: 0,
    });

  const style = styleById(ctx.style).prompt;
  if (style) parts.push({ text: style, priority: 1 });
  if (ctx.displayName?.trim())
    parts.push({ text: `Address the user as ${ctx.displayName.trim()}.`, priority: 1 });
  push(ctx.aboutYou && `About the user (they provided this):\n${ctx.aboutYou.trim()}`, 1);
  push(
    ctx.responseGuidance && `How the user wants you to respond:\n${ctx.responseGuidance.trim()}`,
    1,
  );
  // Explicit precedence (spec §4.5): project instructions override the
  // account-level preferences above when they conflict. Stated outright rather
  // than relying on ordering, so the model is told which wins.
  push(
    ctx.projectInstructions &&
      "Project context and instructions. These take precedence over the account " +
        "preferences above wherever they conflict:\n" +
        ctx.projectInstructions.trim(),
    2,
  );
  // Priority 0: the build state is the one thing that cannot be recovered by
  // calling a tool, because the model would have to know the build existed in
  // order to ask about it. Dropping this is what re-creates the failure the
  // workspace was built to fix.
  push(ctx.workspaceContext, 0);
  // The user's own words about what they want remembered, so it is stated
  // before the individual facts rather than left to be inferred from them.
  push(
    ctx.memorySummary &&
      "A summary of what you remember about the user, written and approved by them:\n" +
        ctx.memorySummary.trim(),
    3,
  );
  push(
    ctx.memories?.length
      ? "Relevant things you remember about the user from past chats (use if helpful, don't force it):\n" +
          ctx.memories.map((m) => `- ${m}`).join("\n")
      : undefined,
    3,
  );
  // Progressive disclosure: paths only. The model pays for the index, not for
  // every remembered note, and fetches a file with the `memory` tool when a
  // turn actually calls for it. Droppable for the same reason — the tool still
  // works without the listing.
  push(ctx.memoryDirectory, 4);
  // Same progressive-disclosure bargain as memory files: the index is always
  // in context, the bodies are fetched with the `skill` tool when a task
  // matches. Placed after the user's own instructions so a skill cannot read
  // as outranking them.
  push(ctx.skillsIndex, 4);
  push(ctx.connectorsIndex, 4);
  // Told to the model as well as shown in the UI: it should not offer to
  // remember something it will be unable to save, and should not claim to have
  // saved anything. Priority 0 — a privacy promise is not a nice-to-have.
  if (ctx.incognito)
    parts.push({
      text:
        "This is a temporary chat. Nothing from it is saved — not the conversation, " +
        "not your memory files. Do not offer to remember anything, and do not claim you have.",
      priority: 0,
    });

  return fit(parts, SYSTEM_PROMPT_MAX_CHARS);
}
