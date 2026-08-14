import { declinedToPlan } from "@/lib/agent/plan";
import type { ChatMessage } from "./types";

/**
 * Writing a real summary of the folded turns.
 *
 * `foldedSummary` in compact.ts keeps the first 240 characters of each turn.
 * That is honest and free, and on a forty-turn design conversation it is close
 * to useless: every decision, every constraint and every rejected approach lives
 * past the first sentence. This module asks the model to write the summary
 * instead.
 *
 * Pure. Deciding what to ask for, and deciding whether what came back is usable,
 * are the two things worth testing; making the call is `summarize-run.ts`.
 *
 * The headings are fixed, and that is the whole design. A summary with a known
 * shape is a summary that can be *checked* — `parseFoldSummary` can tell "the
 * model summarised the conversation" from "the model answered the conversation",
 * which is a real and common failure mode when you hand a chat transcript to a
 * chat model. Free-form output gives you nothing to check against, so a refusal,
 * an apology and an actual summary all look alike.
 */

/** The five sections, in order. Order is part of the contract: it is checked. */
export const FOLD_HEADINGS = ["Decisions", "Constraints", "Produced", "Open", "Rejected"] as const;

/** How much of one folded turn is shown to the summariser. */
export const USER_CLIP = 1_500;
/**
 * Assistant turns get more room than user turns.
 *
 * Not symmetry for its own sake: the user states a requirement in a sentence and
 * the assistant spends four paragraphs on the approach, the trade-off and the
 * caveat. Clipping both at the same point loses the reasoning while preserving
 * whitespace.
 */
export const ASSISTANT_CLIP = 2_500;

/** Ceiling on the transcript handed to the summariser. */
export const INPUT_MAX = 24_000;

/**
 * Longest summary that will be accepted.
 *
 * Generous against the ~2000 the prompt asks for — rejecting a good summary for
 * being 2400 characters would leave the mechanical excerpt in place permanently,
 * since there is only one attempt per fold. It exists to catch the runaway case,
 * not to enforce the request.
 */
export const SUMMARY_HARD_MAX = 6_000;

const SUMMARY_SYSTEM = [
  "You are compacting the earlier part of a conversation so those turns can be dropped from the context window.",
  "Write ONLY the summary. Do not answer anything asked in the conversation, do not greet, do not add a preamble or a sign-off.",
  `Use exactly these five markdown headings, in this order: ${FOLD_HEADINGS.map((h) => `## ${h}`).join(", ")}.`,
  "Under each, write terse bullets.",
  "Decisions: what was settled, and why. Constraints: requirements, limits, preferences and anything the user ruled in.",
  "Produced: files, artifacts, data and deliverables that exist as a result, by name. Open: what is unresolved or still to do.",
  "Rejected: approaches that were tried or proposed and abandoned, and what was wrong with them — so they are not proposed again.",
  "Keep exact names, paths, numbers, versions and the user's own wording wherever it constrains the work. Those are the parts that cannot be reconstructed.",
  "If a heading has nothing under it, write '- none'.",
  "Keep the whole summary under 2000 characters.",
  "If the conversation cannot be summarised, reply with exactly: NO PLAN",
].join(" ");

export interface SummaryRequest {
  system: string;
  user: string;
  /** Characters this summary would replace — the budget `parseFoldSummary` checks against. */
  replacedChars: number;
}

/**
 * What to send the summariser, or null when there is nothing worth summarising.
 *
 * Head-and-tailed rather than truncated when over budget, for the same reason
 * `foldedSummary` is: the head says what the conversation was about and the tail
 * says where it had got to. The middle is the most recoverable part, because
 * whatever it produced is in the workspace — and, once B3 is on, in the recall
 * index.
 */
export function buildSummaryRequest(folded: ChatMessage[]): SummaryRequest | null {
  const lines: string[] = [];
  let replacedChars = 0;
  for (const m of folded) {
    const text = m.content.replace(/\s+/g, " ").trim();
    if (!text) continue;
    replacedChars += text.length;
    const clip = m.role === "user" ? USER_CLIP : ASSISTANT_CLIP;
    const who = m.role === "user" ? "User" : "Atlas";
    lines.push(`${who}: ${text.length > clip ? `${text.slice(0, clip)}…` : text}`);
  }
  if (lines.length === 0) return null;

  let body = lines.join("\n\n");
  if (body.length > INPUT_MAX) {
    const half = Math.floor((INPUT_MAX - 40) / 2);
    body = `${body.slice(0, half)}\n\n[…middle of the conversation omitted…]\n\n${body.slice(-half)}`;
  }

  return {
    system: SUMMARY_SYSTEM,
    user: `Summarise this conversation excerpt:\n\n${body}`,
    replacedChars,
  };
}

/** Why a summary was thrown away. Surfaced so a bad model is diagnosable. */
export type SummaryRejection = "empty" | "declined" | "headingless" | "too-long";

export type ParsedSummary =
  | { ok: true; body: string }
  | { ok: false; reason: SummaryRejection };

/**
 * Decide whether the model actually wrote a summary.
 *
 * Three rejections, each for a failure seen in practice:
 *
 *  - **declined** — the model said it could not, using the same `NO PLAN`
 *    sentinel `draftPlan` already uses, so there is one refusal token in the
 *    codebase rather than two that drift.
 *  - **headingless** — the model answered the conversation instead of
 *    summarising it. Handing a chat transcript to a chat model and asking it not
 *    to reply is a genuinely hard instruction, and the result is fluent,
 *    confident, and completely wrong for this slot. The fixed headings are what
 *    make it detectable.
 *  - **too-long** — output longer than what it replaces is not a summary. Almost
 *    always the model echoing the transcript back.
 *
 * A rejected summary leaves the derived excerpt in place, which is a downgrade
 * and not a breakage.
 */
export function parseFoldSummary(raw: string, replacedChars: number): ParsedSummary {
  const body = raw.trim();
  if (!body) return { ok: false, reason: "empty" };
  if (declinedToPlan(body)) return { ok: false, reason: "declined" };

  const found = FOLD_HEADINGS.filter((h) =>
    new RegExp(`^\\s*#{1,4}\\s*${h}\\b`, "im").test(body),
  );
  if (found.length === 0) return { ok: false, reason: "headingless" };

  const limit = Math.min(replacedChars, SUMMARY_HARD_MAX);
  if (body.length > limit) return { ok: false, reason: "too-long" };

  return { ok: true, body };
}

export interface SummaryProvenance {
  foldedCount: number;
  model: string;
  at: number;
  /** True once `recall_context` can reach the original turns. */
  recallable?: boolean;
}

/**
 * Wrap the summary in a header that says where it came from.
 *
 * Not decoration. The model is about to read a block of text describing turns it
 * cannot see, and its next answer depends on how much it trusts that block. So
 * the header states who wrote it, when, that it may be incomplete, and — this is
 * the load-bearing part — what to do about it: call `recall_context` and get the
 * original wording. Without that last sentence a model that notices a gap has no
 * move except to guess.
 *
 * Worded differently from `foldedSummary`'s header on purpose, so the two are
 * never mistaken for each other.
 */
export function renderFoldSummary(body: string, p: SummaryProvenance): string {
  const date = new Date(p.at).toISOString().slice(0, 10);
  const recall = p.recallable
    ? " If you need something from those turns exactly as it was said — a name, a number, the user's own wording — call `recall_context` rather than working from this summary."
    : " The full transcript is still on screen for the user, but you cannot read it, so do not claim to remember details that are not written here.";
  return (
    `[Summary of ${p.foldedCount} earlier turns, written by ${p.model} on ${date}. ` +
    `Those turns are no longer in this request. This summary may be incomplete.${recall} ` +
    `The build workspace and any artifacts are unaffected.]\n\n${body}`
  );
}
