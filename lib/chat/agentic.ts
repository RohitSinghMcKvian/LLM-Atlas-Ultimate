/**
 * Is this a build?
 *
 * Build mode gives the model a workspace, a task ledger, twenty tool rounds and
 * a 32k output budget. It was also off by default and buried in a dropdown, so
 * the ordinary experience of asking Atlas to build something end to end was four
 * rounds, no filesystem, no plan, and an apology. The toggle was correct and
 * nobody found it.
 *
 * The answer is not to turn it on for everyone — a build turn can cost many
 * times an ordinary one, and a mode that spends the user's money must never
 * arrive unannounced. It is to *detect* the request and then say so, before
 * spending anything. Detection here, disclosure in the composer.
 *
 * Deliberately lexical rather than a model call. A classifier round trip would
 * cost a request and several seconds on every message, to answer a question that
 * the shape of the sentence already answers — and it would have to happen before
 * the user sees any response at all, which is the worst possible place to add
 * latency.
 *
 * Pure and tested. The weights are the whole design, so they live somewhere they
 * can be argued with.
 */

export type AgenticMode = "off" | "auto" | "always";

export interface BuildSignal {
  /** 0–1ish. Above `BUILD_THRESHOLD` is a build. */
  score: number;
  /** Which rules fired, in the order they were checked. For the UI and for tests. */
  reasons: string[];
  verdict: "chat" | "build";
}

export interface BuildIntentInput {
  text: string;
  attachments?: { kind: string; name: string }[];
  /** Files already in this conversation's build workspace. */
  workspaceFileCount?: number;
  /** Whether an artifact is open for this conversation. */
  hasOpenArtifact?: boolean;
}

export const BUILD_THRESHOLD = 0.5;

const BUILD_VERBS =
  "build|create|make|implement|write|generate|scaffold|develop|design|code|port|migrate|refactor|rewrite|convert|assemble|produce|set\\s+up|put\\s+together";

/**
 * A build verb *heading a clause* — an instruction, not a mention.
 *
 * Position is what separates "Build me a dashboard" from "How would you build a
 * dashboard?", and it is the only thing that separates them: the words are
 * identical. So the verb must open the message, follow sentence punctuation or a
 * comma, or follow one of the few phrasings English uses to hand over an
 * instruction ("…to build", "please build", "can you build").
 *
 * "you build" is deliberately absent. That is the shape of a question about
 * building, and treating it as an instruction turned every architecture question
 * into a twenty-round build.
 */
const BUILD_INSTRUCTION = new RegExp(
  `(?:^|[.!?;:\\n]\\s*|,\\s*|\\bto\\s+|\\bthen\\s+|\\bplease\\s+|\\bcan\\s+you\\s+|\\bcould\\s+you\\s+)(?:${BUILD_VERBS})\\b`,
  "i",
);

/** The thing being produced. A verb without one of these is usually not a build. */
const DELIVERABLE =
  /\b(app|application|site|website|page|landing|dashboard|component|widget|script|tool|utility|library|game|api|endpoint|cli|bot|extension|plugin|report|brief|spec|deck|slides|presentation|spreadsheet|sheet|workbook|document|readme|blog|newsletter|form|prototype|mockup|clone|tracker|calculator|planner|editor|viewer|simulator|visuali[sz]ation|chart|diagram|test\s+suite|pipeline|scraper|parser)s?\b/i;

/** Several things, or one thing described as complete. */
const MULTIPLICITY =
  /\b(end[\s-]to[\s-]end|and\s+then|after\s+that|step\s+by\s+step|full[ly]?|complete(ly)?|production[\s-]ready|from\s+scratch|entire|whole|multi[\s-]?(file|page|step)|as\s+well\s+as|plus\s+a)\b|^\s*\d+[.)]\s|\n\s*\d+[.)]\s|\n\s*[-*]\s/im;

/** Concrete technology or a literal filename. */
const CONCRETE =
  /\.(tsx?|jsx?|py|rb|go|rs|java|css|html?|md|json|ya?ml|sql|sh|csv|xlsx?|docx?|pdf)\b|\b(react|next\.?js|vue|svelte|tailwind|typescript|javascript|python|node|express|fastapi|django|flask|postgres|sqlite|d3|three\.?js|recharts|pandas|numpy|matplotlib|pytest|vitest|jest|package\.json|dockerfile|tsconfig)\b/i;

/** A question about the world, not an instruction to produce something. */
const QUESTION_SHAPED =
  /^\s*(what|why|who|when|where|which|how\s+(do|does|did|can|could|would|should|is|are)|is|are|was|were|do|does|did|can|could|would|should|explain|describe|summari[sz]e|compare|translate|define|tell\s+me\s+about)\b/i;

/**
 * How much each signal is worth.
 *
 * Exported so a test can assert the arithmetic rather than re-derive it, and so
 * the one weight that matters most is visible at a glance: a conversation that
 * already has a build clears the threshold on its own.
 */
export const WEIGHTS = {
  /**
   * The single most important rule here.
   *
   * A conversation that has already produced files is still building, and the
   * follow-up almost never restates it — "now make the header blue" scores
   * nothing on every other signal. Without this, build mode applied to turn one
   * and silently dropped on turn two, which is the most common real failure and
   * the one users describe as "it forgot what it was doing".
   */
  hasBuild: 0.55,
  /**
   * An instruction plus a thing to produce is a build on its own, and the two
   * weights are set so that it clears the threshold with nothing else. "Build me
   * an expense tracker" needs no further evidence, and demanding some was why
   * the plainest possible build request used to be classified as chat.
   */
  buildInstruction: 0.3,
  deliverable: 0.25,
  multiplicity: 0.2,
  concrete: 0.15,
  /** A data file attached is usually "do something with this", not "read this". */
  dataAttachment: 0.15,
  questionShaped: -0.4,
  terse: -0.2,
} as const;

export function detectBuildIntent(input: BuildIntentInput): BuildSignal {
  const text = input.text ?? "";
  const trimmed = text.trim();
  const reasons: string[] = [];
  let score = 0;

  const add = (weight: number, reason: string) => {
    score += weight;
    reasons.push(reason);
  };

  const hasBuild =
    (input.workspaceFileCount ?? 0) > 0 || !!input.hasOpenArtifact;
  if (hasBuild) add(WEIGHTS.hasBuild, "conversation already has a build");

  const instruction = BUILD_INSTRUCTION.test(trimmed);
  const deliverable = DELIVERABLE.test(trimmed);
  if (instruction) add(WEIGHTS.buildInstruction, "build instruction");
  if (deliverable) add(WEIGHTS.deliverable, "deliverable noun");
  if (MULTIPLICITY.test(trimmed)) add(WEIGHTS.multiplicity, "multi-step or complete");
  if (CONCRETE.test(trimmed)) add(WEIGHTS.concrete, "names a technology or file");

  if (
    input.attachments?.some((a) => a.kind === "csv" || a.kind === "xlsx" || a.kind === "code")
  ) {
    add(WEIGHTS.dataAttachment, "data or code attached");
  }

  // A question that also issues an instruction is not penalised: "What would a
  // good README look like? Write one." is a build. A question that only mentions
  // building — "How would you build a rate limiter?" — is not, and the clause
  // position in `BUILD_INSTRUCTION` is what tells the two apart.
  if (QUESTION_SHAPED.test(trimmed) && !instruction) {
    add(WEIGHTS.questionShaped, "question-shaped");
  }

  // Brevity means something different once a build exists. "add a footer" is a
  // follow-up instruction, not small talk, and penalising it is how build mode
  // used to apply on turn one and silently drop on turn two.
  if (!hasBuild && trimmed.length < 40 && !deliverable) {
    add(WEIGHTS.terse, "short with no deliverable");
  }

  return {
    score,
    reasons,
    verdict: score >= BUILD_THRESHOLD ? "build" : "chat",
  };
}

export interface AgenticDecision {
  /** Run this turn as a build. */
  build: boolean;
  /**
   * The decision was made by detection rather than by the user.
   *
   * Drives the pre-flight strip: a mode the user did not ask for has to announce
   * itself and offer a way out, every turn, before anything is spent.
   */
  auto: boolean;
}

/**
 * Reconcile the setting, any per-conversation override, and the detector.
 *
 * The override wins over detection but not over `"off"`. That ordering is what
 * makes "Just answer" mean it: a user who declined a build in this conversation
 * is not asked again by the same heuristic three messages later.
 */
export function resolveAgentic(
  mode: AgenticMode,
  conversationOverride: boolean | null | undefined,
  signal: BuildSignal,
): AgenticDecision {
  if (mode === "off") return { build: false, auto: false };
  if (mode === "always") return { build: true, auto: false };
  if (conversationOverride != null) return { build: conversationOverride, auto: false };
  return { build: signal.verdict === "build", auto: signal.verdict === "build" };
}
