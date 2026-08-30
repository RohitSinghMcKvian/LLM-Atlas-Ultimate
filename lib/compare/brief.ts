// The brief: what the run is actually being asked, and how it will be judged.
//
// One cheap model call before anything expensive happens, producing four things
// the rest of the run needs and previously had to guess at:
//
//   * a restated task, unambiguous, which is what every lane receives — so all
//     lanes are answering the identical question, not the same string;
//   * a rubric derived from *this* task, shown to the user before the run and
//     editable, which is what makes the later scores mean something rather than
//     arriving as a number from nowhere;
//   * search queries, or none at all when the task needs no evidence;
//   * a task shape, which decides whether the Build view and artifact scoring
//     turn on.
//
// Structured output via `responseFormat: { type: "json_schema" }` — support the
// router already has. The thing this replaces asked for exact markdown headings
// and re-parsed them client-side with `new RegExp('##\\s*' + name)`, which fails
// silently the moment a model writes `## Synthesis:` instead.

import type { Brief, Criterion, Rubric, TaskShape } from "./types";

/** Rubrics narrower than this are not worth scoring; wider than this, nobody reads. */
export const MIN_CRITERIA = 2;
export const MAX_CRITERIA = 6;

/** Queries beyond this are a planner that has not understood the question. */
export const MAX_BRIEF_QUERIES = 8;

const SHAPES: TaskShape[] = ["answer", "research", "build", "transform"];

/**
 * The schema the model must fill.
 *
 * Deliberately flat and small. Every field is required, because an optional
 * field is one a model will omit under load, and a rubric that arrives without
 * weights is not a rubric.
 */
export const BRIEF_SCHEMA = {
  name: "compare_brief",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["task", "shape", "criteria", "groundRules", "researchQueries"],
    properties: {
      task: {
        type: "string",
        description: "The user's question restated unambiguously, in one or two sentences.",
      },
      shape: {
        type: "string",
        enum: SHAPES,
        description:
          "answer = knowledge or reasoning; research = needs current sources; " +
          "build = produce code, a page or a document; transform = rewrite or convert supplied text.",
      },
      criteria: {
        type: "array",
        minItems: MIN_CRITERIA,
        maxItems: MAX_CRITERIA,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "description", "weight"],
          properties: {
            name: { type: "string", description: "Two or three words." },
            description: { type: "string", description: "What a high score means, in one line." },
            weight: { type: "number", description: "Relative importance, any positive number." },
          },
        },
      },
      groundRules: {
        type: "array",
        maxItems: 5,
        items: { type: "string" },
        description: "Format or length constraints the answer must obey. Empty if none.",
      },
      researchQueries: {
        type: "array",
        maxItems: MAX_BRIEF_QUERIES,
        items: { type: "string" },
        description:
          "Search engine queries, not questions. Two to six keywords each, no punctuation, " +
          "no date ranges, no parentheses. Empty when the task needs no sources.",
      },
    },
  },
} as const;

export const BRIEF_SYSTEM =
  "You prepare comparison runs. Given a question, restate it unambiguously, decide what kind of " +
  "task it is, and write the criteria a good answer should be judged on. Judge the task, not the " +
  "answer — you will not see any answers. Criteria must be specific to this question: " +
  '"accuracy" and "clarity" apply to everything and tell nobody anything. Ask for searches only ' +
  "when the answer genuinely depends on current or external facts. Write searches the way you would type them into a search engine — short keyword phrases, not sentences. A query written as a full question with punctuation returns nothing from most search backends.";

export function briefPrompt(question: string, opts: { web?: boolean } = {}): string {
  const parts = [`Question:\n"""${question.trim()}"""`];
  if (opts.web === false) {
    parts.push("The user has turned web search off. Return an empty researchQueries array.");
  } else if (opts.web === true) {
    parts.push("The user has turned web search on. Propose searches even if the task seems self-contained.");
  }
  return parts.join("\n\n");
}

/**
 * Make weights a distribution.
 *
 * Models return weights on whatever scale they feel like — percentages, 1-5,
 * sometimes all 1. The judge's weighted total is only comparable across runs if
 * they sum to 1, and doing it here rather than in the judge means one
 * implementation rather than one per caller.
 *
 * All-zero or negative weights fall back to equal weighting: a rubric where
 * nothing counts is a bug in the model's output, not an instruction to score
 * everything as zero.
 */
export function normalizeRubric(rubric: Rubric): Rubric {
  const criteria = rubric.criteria.filter((c) => c.name?.trim());
  if (criteria.length === 0) return { ...rubric, criteria: [] };

  const positive = criteria.map((c) => (Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 0));
  const total = positive.reduce((a, b) => a + b, 0);
  const weights =
    total > 0 ? positive.map((w) => w / total) : criteria.map(() => 1 / criteria.length);

  return {
    ...rubric,
    criteria: criteria.map((c, i) => ({ ...c, weight: weights[i] })),
  };
}

/** Stable, readable ids from names — `judge.ts` keys its scores by these. */
function criterionId(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `criterion-${index + 1}`;
}

/**
 * A rubric for when the brief could not run or came back unusable.
 *
 * Generic on purpose — it is a floor, not a target. The UI says the rubric is a
 * fallback so nobody reads a score against it as task-specific.
 */
export function defaultRubric(shape: TaskShape): Rubric {
  const common: Omit<Criterion, "weight">[] =
    shape === "build"
      ? [
          { id: "works", name: "Works", description: "The result runs and does what was asked." },
          { id: "complete", name: "Completeness", description: "Nothing asked for is missing." },
          { id: "quality", name: "Craft", description: "Readable, sensibly structured, no obvious defects." },
        ]
      : [
          { id: "correct", name: "Correctness", description: "Claims are accurate and supported." },
          { id: "complete", name: "Completeness", description: "The whole question is addressed." },
          { id: "useful", name: "Usefulness", description: "Directly answers what was asked, without padding." },
        ];
  return normalizeRubric({
    criteria: common.map((c) => ({ ...c, weight: 1 })),
    groundRules: [],
  });
}

/** Words too common to count as evidence that two strings are about the same thing. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "been", "what", "which", "how", "why", "when",
  "between", "about", "that", "this", "it", "as", "at", "by", "from",
]);

function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Whether the model's `task` is a restatement of the question or a label for it.
 *
 * A small model asked to "restate the question" will sometimes answer with a
 * category — an 8B model given "What are the trade-offs between RAG and
 * long-context prompting?" returned `"technical comparison"`. Taking that at
 * face value means every lane is asked "technical comparison" instead of the
 * real question, which is a silent and total failure of the run.
 *
 * Two cheap checks catch it: a restatement is not drastically shorter than the
 * original, and it shares most of its content words.
 */
export function plausibleRestatement(candidate: string, question: string): boolean {
  if (!candidate) return false;
  if (candidate.length < question.trim().length * 0.4) return false;

  const asked = contentWords(question);
  if (asked.size === 0) return true;
  const restated = contentWords(candidate);
  let shared = 0;
  for (const word of asked) if (restated.has(word)) shared++;
  // Half the question's substance has to survive the restatement. Below that it
  // is a summary or a label, not the same question asked more precisely.
  return shared / asked.size >= 0.5;
}

interface RawBrief {
  task?: unknown;
  shape?: unknown;
  criteria?: unknown;
  groundRules?: unknown;
  researchQueries?: unknown;
}

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Read the model's reply into a `Brief`.
 *
 * Total: any shortfall degrades to the fallback rather than throwing. The brief
 * is a preparation step, and a run that refuses to start because a cheap model
 * emitted a stray token is worse than one that runs on a generic rubric and says
 * so.
 */
export function parseBrief(raw: string, question: string, modelId?: string): Brief {
  let parsed: RawBrief = {};
  try {
    // Models sometimes fence JSON even when asked for a bare object.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
    parsed = JSON.parse((fenced ? fenced[1] : raw).trim()) as RawBrief;
  } catch {
    return fallbackBrief(question, modelId);
  }

  const shape: TaskShape =
    typeof parsed.shape === "string" && (SHAPES as string[]).includes(parsed.shape)
      ? (parsed.shape as TaskShape)
      : "answer";

  const rawCriteria = Array.isArray(parsed.criteria) ? parsed.criteria : [];
  const criteria: Criterion[] = rawCriteria
    .slice(0, MAX_CRITERIA)
    .map((c, i) => {
      const obj = (c ?? {}) as { name?: unknown; description?: unknown; weight?: unknown };
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      return {
        id: criterionId(name, i),
        name,
        description: typeof obj.description === "string" ? obj.description.trim() : "",
        weight: typeof obj.weight === "number" ? obj.weight : 1,
      };
    })
    .filter((c) => c.name);

  // Too few criteria is not a rubric worth scoring against; take the fallback
  // rather than judging a whole run on one axis a model happened to pick.
  const rubric =
    criteria.length >= MIN_CRITERIA
      ? normalizeRubric({ criteria, groundRules: asStringArray(parsed.groundRules, 5) })
      : { ...defaultRubric(shape), groundRules: asStringArray(parsed.groundRules, 5) };

  const candidate = typeof parsed.task === "string" ? parsed.task.trim() : "";
  const task = plausibleRestatement(candidate, question) ? candidate : question;

  return {
    task,
    shape,
    rubric,
    researchQueries: tidyQueries(asStringArray(parsed.researchQueries, MAX_BRIEF_QUERIES)),
    modelId,
  };
}

/**
 * Make a proposed query searchable.
 *
 * Models asked for searches return sentences: "Recent studies on RAG and
 * long-context prompting (2020-2026)". Scrape backends answer those with
 * nothing, and the loop reports a clean run that found no sources. Stripping the
 * punctuation and the parenthetical costs nothing and is the difference between
 * twelve sources and zero.
 */
export function normalizeQuery(raw: string): string {
  return raw
    // Parentheticals are almost always a date range or an aside, and both hurt.
    .replace(/\([^)]*\)/g, " ")
    .replace(/["'“”‘’]/g, " ")
    // Keep hyphens: "long-context" is one term.
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Query words beyond this are noise to a search engine. */
export const MAX_QUERY_WORDS = 10;

function tidyQueries(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const words = normalizeQuery(item).split(" ").filter(Boolean).slice(0, MAX_QUERY_WORDS);
    const query = words.join(" ");
    if (query.length < 3) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(query);
  }
  return out;
}

export function fallbackBrief(question: string, modelId?: string): Brief {
  return {
    task: question,
    shape: "answer",
    rubric: defaultRubric("answer"),
    researchQueries: [],
    modelId,
  };
}

/** Whether the evidence stage has anything to do. */
export function needsEvidence(brief: Brief, web?: boolean): boolean {
  if (web === false) return false;
  return brief.researchQueries.length > 0;
}

/** One line for the run spine. */
export function describeBrief(brief: Brief): string {
  const n = brief.rubric.criteria.length;
  const shape = brief.shape === "answer" ? "" : `${brief.shape} task · `;
  return `${shape}${n} criteri${n === 1 ? "on" : "a"}`;
}
