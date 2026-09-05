import { MODULES } from "@/lib/modules";
import { similarity } from "./lexicon";

/**
 * What someone meant, decided before a model is asked.
 *
 * The voice surface shipped in P20 could answer questions and do nothing else,
 * and "open Compare" cost a full model round-trip plus up to four tool rounds
 * to accomplish a `router.push`. Both problems have the same answer: recognise
 * the small set of things people say to *operate* an app, and act on them here.
 *
 * ### The bias is towards asking, always
 *
 * Every rule below is conservative, and anything unmatched falls through to
 * `ask` — the model path, exactly as before. A command that fires when someone
 * was asking a question is much worse than a question that takes the slow path:
 * one costs a second, the other moves the page out from under them. That is why
 * question openers are rejected outright, why the navigation verbs are a closed
 * list rather than "any sentence containing a module name", and why fuzzy model
 * matching needs a clear margin over the runner-up.
 *
 * ### Confirmation is parsed separately, on purpose
 *
 * "Stop" means *stop talking* mid-answer and *no* when something is waiting to
 * be confirmed. Rather than guess, `parseConfirm` is its own function and the
 * driver only calls it while a confirmation is pending, so the same word can
 * mean two things without either rule having to know about the other.
 *
 * Pure, so the whole vocabulary is testable without a microphone.
 */

export type SortKey = "price" | "intelligence" | "speed" | "context" | "recency";
export type AccessFilter = "free" | "byok" | "all";

export type VoiceIntent =
  /** Go somewhere, optionally with state already set. */
  | {
      kind: "navigate";
      moduleId: string;
      href: string;
      label: string;
      modelIds?: string[];
      access?: "free" | "byok";
    }
  /** Browser history. Reversible, so it never asks. */
  | { kind: "back" }
  /** Change what is selected on the current surface. */
  | { kind: "select"; op: "set" | "add" | "remove" | "clear"; modelIds: string[] }
  /** Change how the current surface is filtered or ordered. */
  | { kind: "filter"; access?: AccessFilter; sort?: SortKey; openWeights?: boolean; clear?: boolean }
  /** Control the speaking, not the app. */
  | { kind: "playback"; op: "stop" | "repeat" | "faster" | "slower" | "reset_rate" }
  /** Control the conversation itself. */
  | { kind: "session"; op: "reset" | "help" | "end" }
  /** Not a command. Ask the model, as before. */
  | { kind: "ask"; text: string };

export interface IntentContext {
  /** Catalog entries the person could name aloud. */
  models?: { id: string; name: string }[];
  /** Which module they are on, so "add that" has something to add to. */
  moduleId?: string;
}

/**
 * Openers that mean a question is coming.
 *
 * Checked before anything else. "What is on the Cost page" contains a module
 * name and a preposition and is not a request to go there.
 */
const QUESTION_OPENERS = [
  "what",
  "what's",
  "whats",
  "why",
  "how",
  "which",
  "who",
  "when",
  "where",
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "will",
  "tell me",
  "explain",
  "compare the",
  "remind me",
];

/** Verbs that mean "take me there". A closed list, deliberately. */
const NAV_VERBS = [
  "open",
  "go to",
  "goto",
  "take me to",
  "bring up",
  "show me",
  "switch to",
  "navigate to",
  "jump to",
  "pull up",
  "launch",
  "visit",
];

/**
 * Extra words people use for a module that are not its label.
 *
 * Only unambiguous ones. "Models" is missing on purpose: it could mean the
 * Leaderboard, the Hub or the catalog, and guessing wrong navigates away from
 * whatever someone was reading.
 */
const MODULE_SYNONYMS: Record<string, string[]> = {
  leaderboard: ["rankings", "ranking", "the board", "leader board", "top models"],
  cost: ["pricing", "prices", "price calculator", "cost calculator", "spend"],
  news: ["headlines", "the feed", "latest news", "articles"],
  compare: ["comparison", "arena", "side by side", "head to head"],
  playground: ["sandbox", "scratchpad"],
  prompt: ["prompts", "prompt library", "my prompts", "library"],
  vault: ["keys", "my keys", "api keys", "credentials"],
  bench: ["benchmarks", "benchmark", "evals", "evaluations"],
  code: ["editor", "the ide"],
  chat: ["conversation", "assistant"],
  learn: ["lessons", "courses", "tutorials"],
  router: ["routing", "routes", "failover"],
  hub: ["catalog", "model catalog"],
  flow: ["workflows", "workflow", "pipelines"],
  datasets: ["data sets", "data"],
  notebooks: ["notebook"],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function startsWithAny(text: string, prefixes: string[]): string | null {
  for (const p of prefixes) {
    if (text === p) return p;
    if (text.startsWith(`${p} `)) return p;
  }
  return null;
}

/** Whether this reads as a question rather than an instruction. */
export function looksLikeQuestion(text: string): boolean {
  const t = normalize(text);
  if (t.endsWith("?")) return true;
  return startsWithAny(t, QUESTION_OPENERS) !== null;
}

/**
 * Which module a phrase names, if exactly one.
 *
 * Longest match wins, so "leader board" beats a stray "board", and a phrase
 * naming two modules returns null rather than picking the first — "compare cost
 * and news" is a question about three things, not a navigation.
 */
export function matchModule(phrase: string): { id: string; href: string; label: string } | null {
  const t = normalize(phrase);
  if (!t) return null;

  const hits: { id: string; href: string; label: string; length: number }[] = [];
  for (const m of MODULES) {
    const names = [m.id, m.label.toLowerCase(), m.name.toLowerCase(), ...(MODULE_SYNONYMS[m.id] ?? [])];
    let best = 0;
    for (const n of names) {
      // Word-boundary match: "cost" must not fire inside "costly".
      const re = new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
      if (re.test(t) && n.length > best) best = n.length;
    }
    if (best > 0) hits.push({ id: m.id, href: m.href, label: m.name, length: best });
  }
  if (hits.length === 0) return null;

  hits.sort((a, b) => b.length - a.length);
  // Two different modules named with equal weight is ambiguous, not a tie to
  // break. Only a strictly longer match is treated as the intended one.
  if (hits.length > 1 && hits[1].length === hits[0].length) return null;
  const { id, href, label } = hits[0];
  return { id, href, label };
}

/**
 * Catalog models named in a phrase.
 *
 * Literal first, then fuzzy with a margin. `similarity` is the same scorer
 * `lib/voice/lexicon.ts` uses to correct a transcript, so a name the lexicon
 * would have fixed is a name this can find.
 */
export function matchModels(
  phrase: string,
  models: { id: string; name: string }[] = [],
  minScore = 0.84,
): string[] {
  const t = normalize(phrase);
  if (!t || models.length === 0) return [];

  const found: { id: string; at: number; score: number }[] = [];
  for (const m of models) {
    const name = m.name.toLowerCase();
    const id = m.id.toLowerCase();
    const at = t.indexOf(name) >= 0 ? t.indexOf(name) : t.indexOf(id);
    if (at >= 0) {
      found.push({ id: m.id, at, score: 1 });
      continue;
    }
    // Fuzzy, token-wise: a spoken "GPT five codex" against "gpt-5-codex".
    const tokens = t.split(" ");
    for (let i = 0; i < tokens.length; i++) {
      for (let span = 1; span <= 4 && i + span <= tokens.length; span++) {
        const candidate = tokens.slice(i, i + span).join(" ");
        if (candidate.length < 3) continue;
        const score = Math.max(similarity(candidate, name), similarity(candidate, id));
        if (score >= minScore) found.push({ id: m.id, at: i, score });
      }
    }
  }
  if (found.length === 0) return [];

  // Best score per model, then in the order they were spoken: "compare A and B"
  // should select A first.
  const best = new Map<string, { at: number; score: number }>();
  for (const f of found) {
    const prev = best.get(f.id);
    if (!prev || f.score > prev.score) best.set(f.id, { at: f.at, score: f.score });
  }
  return [...best.entries()].sort((a, b) => a[1].at - b[1].at).map(([id]) => id);
}

const PLAYBACK: { op: Extract<VoiceIntent, { kind: "playback" }>["op"]; phrases: string[] }[] = [
  { op: "stop", phrases: ["stop", "stop talking", "be quiet", "quiet", "hush", "enough", "shush"] },
  {
    op: "repeat",
    phrases: ["repeat", "repeat that", "say that again", "again", "come again", "what was that"],
  },
  { op: "faster", phrases: ["faster", "speak faster", "speed up", "talk faster"] },
  { op: "slower", phrases: ["slower", "speak slower", "slow down", "talk slower"] },
  { op: "reset_rate", phrases: ["normal speed", "reset speed", "default speed"] },
];

const SESSION: { op: Extract<VoiceIntent, { kind: "session" }>["op"]; phrases: string[] }[] = [
  {
    op: "reset",
    phrases: ["new topic", "start over", "start again", "forget that", "clear the conversation", "new conversation"],
  },
  {
    op: "help",
    phrases: [
      "help",
      "what can i say",
      "what can you do",
      "what can i ask",
      "show commands",
      "list commands",
    ],
  },
  {
    op: "end",
    phrases: ["end", "goodbye", "bye", "we're done", "were done", "that's all", "thats all", "stop listening", "exit voice", "close voice"],
  },
];

const BACK_PHRASES = ["back", "go back", "previous page", "take me back"];

/** The one entry point. Returns `ask` for anything it is not sure about. */
export function parseIntent(raw: string, ctx: IntentContext = {}): VoiceIntent {
  const text = raw.trim();
  const t = normalize(text);
  if (!t) return { kind: "ask", text };

  // Short, exact utterances first: these are the ones said mid-answer, and a
  // question opener can never be one of them.
  if (BACK_PHRASES.includes(t)) return { kind: "back" };
  for (const p of PLAYBACK) {
    if (p.phrases.includes(t)) return { kind: "playback", op: p.op };
  }
  for (const s of SESSION) {
    if (s.phrases.includes(t)) return { kind: "session", op: s.op };
  }

  // Everything below can move the page, so a question stops here.
  if (looksLikeQuestion(text)) return { kind: "ask", text };

  const navigate = parseNavigate(t, ctx);
  if (navigate) return navigate;

  const select = parseSelect(t, ctx);
  if (select) return select;

  const filter = parseFilter(t);
  if (filter) return filter;

  return { kind: "ask", text };
}

function parseNavigate(t: string, ctx: IntentContext): VoiceIntent | null {
  const verb = startsWithAny(t, NAV_VERBS);
  if (!verb) return null;

  const rest = t.slice(verb.length).trim().replace(/^(the|my|a)\s+/, "");
  if (BACK_PHRASES.includes(rest)) return { kind: "back" };

  const mod = matchModule(rest);
  if (!mod) return null;

  const modelIds = matchModels(rest, ctx.models);
  const access = /\bfree\b/.test(rest) ? "free" : /\bbyok|own key\b/.test(rest) ? "byok" : undefined;

  return {
    kind: "navigate",
    moduleId: mod.id,
    href: mod.href,
    label: mod.label,
    ...(modelIds.length ? { modelIds } : {}),
    ...(access ? { access } : {}),
  };
}

function parseSelect(t: string, ctx: IntentContext): VoiceIntent | null {
  if (!ctx.models?.length) return null;

  if (/^(clear|reset|deselect)( the)? (selection|models|everything|all)$/.test(t)) {
    return { kind: "select", op: "clear", modelIds: [] };
  }

  const op = /^(add|also add|include|throw in)\b/.test(t)
    ? "add"
    : /^(remove|drop|take out|exclude)\b/.test(t)
      ? "remove"
      : /^(compare|select|pick|choose|show)\b/.test(t)
        ? "set"
        : null;
  if (!op) return null;

  const modelIds = matchModels(t, ctx.models);
  if (modelIds.length === 0) return null;
  return { kind: "select", op, modelIds };
}

function parseFilter(t: string): VoiceIntent | null {
  if (/^(clear|reset)( the)? filters?$/.test(t)) return { kind: "filter", clear: true };

  const out: Extract<VoiceIntent, { kind: "filter" }> = { kind: "filter" };
  let matched = false;

  if (/\b(only |just )?free( models| ones)?\b/.test(t) && /^(show|only|just|filter)/.test(t)) {
    out.access = "free";
    matched = true;
  } else if (/\b(byok|my own key|own key)\b/.test(t) && /^(show|only|just|filter)/.test(t)) {
    out.access = "byok";
    matched = true;
  }

  if (/\b(open weights?|open source)\b/.test(t) && /^(show|only|just|filter)/.test(t)) {
    out.openWeights = true;
    matched = true;
  }

  const sort = parseSort(t);
  if (sort) {
    out.sort = sort;
    matched = true;
  }

  return matched ? out : null;
}

function parseSort(t: string): SortKey | null {
  if (!/^(sort|order|rank)\b/.test(t) && !/\b(first|cheapest|fastest|smartest|newest)\b/.test(t)) {
    return null;
  }
  if (/\b(price|cost|cheapest|cheap)\b/.test(t)) return "price";
  if (/\b(intelligence|smartest|quality|best)\b/.test(t)) return "intelligence";
  if (/\b(speed|fastest|throughput|latency)\b/.test(t)) return "speed";
  if (/\b(context|window)\b/.test(t)) return "context";
  if (/\b(new|newest|recent|latest)\b/.test(t)) return "recency";
  return null;
}

/**
 * One short line naming what is about to happen.
 *
 * Shown as a chip before the action runs and spoken back for anything that
 * writes, so the two can never describe the same action differently.
 */
export function describeIntent(intent: VoiceIntent): string {
  switch (intent.kind) {
    case "navigate": {
      const withModels = intent.modelIds?.length ? ` with ${intent.modelIds.join(" and ")}` : "";
      return `Opening ${intent.label}${withModels}`;
    }
    case "back":
      return "Going back";
    case "select":
      switch (intent.op) {
        case "clear":
          return "Clearing the selection";
        case "add":
          return `Adding ${intent.modelIds.join(" and ")}`;
        case "remove":
          return `Removing ${intent.modelIds.join(" and ")}`;
        default:
          return `Selecting ${intent.modelIds.join(" and ")}`;
      }
    case "filter": {
      if (intent.clear) return "Clearing the filters";
      const parts: string[] = [];
      if (intent.access === "free") parts.push("free models only");
      if (intent.access === "byok") parts.push("models you have a key for");
      if (intent.openWeights) parts.push("open weights only");
      if (intent.sort) parts.push(`sorted by ${intent.sort}`);
      return parts.length ? `Showing ${parts.join(", ")}` : "Filtering";
    }
    case "playback":
      switch (intent.op) {
        case "stop":
          return "Stopping";
        case "repeat":
          return "Saying that again";
        case "faster":
          return "Speaking faster";
        case "slower":
          return "Speaking slower";
        default:
          return "Normal speed";
      }
    case "session":
      return intent.op === "reset" ? "Starting fresh" : intent.op === "help" ? "What you can say" : "Ending";
    case "ask":
      return "Thinking";
  }
}

/**
 * The vocabulary, for the "what can I say" sheet.
 *
 * Built from the same tables `parseIntent` matches on and from the caller's own
 * catalog, so the help can never drift from what actually works — the failure
 * mode of every voice UI that documents its commands by hand. Model examples
 * name models the person actually has; a sheet that suggests "Compare GPT-5 and
 * Claude" to someone whose catalog holds neither is teaching a phrase that will
 * fail.
 */
export function intentHelp(ctx: IntentContext = {}): { group: string; examples: string[] }[] {
  const modules = MODULES.slice(0, 6).map((m) => `"Open ${m.label}"`);
  const [a, b] = ctx.models ?? [];
  const picks = a && b ? [`"Compare ${a.name} and ${b.name}"`, `"Add ${b.name}"`] : [];
  return [
    { group: "Go somewhere", examples: [...modules, '"Go back"'] },
    {
      group: "Pick models",
      examples: [...picks, '"Clear the selection"'],
    },
    {
      group: "Filter what you see",
      examples: ['"Show only free models"', '"Sort by price"', '"Clear filters"'],
    },
    {
      group: "Control the voice",
      examples: PLAYBACK.map((p) => `"${p.phrases[0]}"`),
    },
    {
      group: "Control the conversation",
      examples: ['"New topic"', '"What can I say"', '"Goodbye"'],
    },
  ];
}
