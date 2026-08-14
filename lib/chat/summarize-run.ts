import { foldFingerprint, foldedMessages, type FoldSummary } from "./compact";
import {
  buildSummaryRequest,
  parseFoldSummary,
  renderFoldSummary,
  SUMMARY_HARD_MAX,
  type SummaryRejection,
} from "./summarize";
import type { ChatMessage } from "./types";

/**
 * Driving the post-fold job to a conclusion.
 *
 * Shaped like `artifact-repair-run.ts`: every effect is an injected port, so
 * "can this spend money it should not" is answerable by a unit test rather than
 * by reading the component. That question is the reason this file exists
 * separately from `summarize.ts` at all — folding fires automatically, without
 * the user asking for anything, and an automatic action that bills someone has
 * to be provably bounded.
 *
 * The guard is polled at every boundary, not once at the start. This job
 * outlives the turn that triggered it: the user can send a new message, switch
 * conversation, switch branch or hit Stop while it is running, and each of those
 * must abandon it without writing anything.
 */

export interface SummarizeLimits {
  /**
   * Hard ceiling on one summarisation, in USD.
   *
   * Checked against the model's own rate *before* the call, not measured after.
   * A cap you can only enforce retrospectively is not a cap.
   */
  maxUsd: number;
  /** Assumed output size for the estimate, and the acceptance ceiling. */
  maxOutputChars: number;
}

export const SUMMARIZE_LIMITS: SummarizeLimits = {
  maxUsd: 0.05,
  maxOutputChars: SUMMARY_HARD_MAX,
};

export interface SummarizePorts {
  /**
   * One plain completion: no tools, no reasoning effort, no streaming into the
   * transcript. Supplied by the host because it owns the key and the route.
   */
  complete: (system: string, user: string) => Promise<string>;
  /**
   * Cost of a call of this size on the conversation's own model, in USD.
   *
   * Takes characters rather than tokens so the caller owns the one conversion
   * and this module stays free of the tokenizer. The conversation's model is
   * deliberately the one used: BYOK means there is no other key that can be
   * assumed to work, and quietly routing a user's conversation to a different
   * provider to save a cent is a surprise, not an optimisation.
   */
  estimateUsd: (inputChars: number, outputChars: number) => number;
  save: (summary: FoldSummary) => Promise<void>;
  /**
   * Index the folded turns for `recall_context`. Optional: without it the
   * summary is still written, it just cannot point anywhere for the exact
   * wording, and `renderFoldSummary` says so instead of promising a tool that
   * would return nothing.
   */
  index?: (messages: ChatMessage[], fingerprint: string) => Promise<number>;
  /** Polled at every boundary. True abandons the job where it stands. */
  shouldStop?: () => boolean;
  now?: () => number;
}

export type SummarizeStatus =
  | "saved"
  /** Nothing folded, or nothing in the folded turns worth summarising. */
  | "skipped"
  /** The model answered instead of summarising, refused, or ran long. */
  | "rejected"
  | "errored"
  | "aborted"
  | "too-expensive";

export interface SummarizeOutcome {
  status: SummarizeStatus;
  reason?: SummaryRejection;
  summary?: FoldSummary;
  /** What the call was priced at, whether or not it was made. */
  estimatedUsd?: number;
  /** Chunks written to the recall index, when one was wired up. */
  indexed?: number;
}

export interface SummarizeInput {
  conversationId: string;
  /** The conversation's own model. Named in the summary header. */
  model: string;
  messages: ChatMessage[];
}

/**
 * Summarise this conversation's folded turns, once.
 *
 * **One attempt per fold.** A rejected or failed summary is not retried: the
 * derived excerpt stays, and the fold's fingerprint does not change, so nothing
 * re-triggers this. Retrying on the next turn would mean a model that reliably
 * answers instead of summarising bills the user on every single turn for the
 * rest of the conversation, invisibly.
 *
 * The recall index is built **first**, and unconditionally. It is local, free
 * and lexical, and it matters most in exactly the case where the summary fails —
 * when the only thing standing in for forty turns is their opening sentences,
 * being able to fetch the original wording is the difference between a gap and a
 * fabrication. Building it first also lets the summary header honestly say
 * whether `recall_context` will find anything.
 */
export async function runFoldSummary(
  input: SummarizeInput,
  ports: SummarizePorts,
  limits: SummarizeLimits = SUMMARIZE_LIMITS,
): Promise<SummarizeOutcome> {
  const now = ports.now ?? (() => Date.now());
  const stopped = () => ports.shouldStop?.() === true;

  if (stopped()) return { status: "aborted" };

  const folded = foldedMessages(input.messages);
  if (folded.length === 0) return { status: "skipped" };

  const fingerprint = foldFingerprint(input.messages);
  const request = buildSummaryRequest(folded);
  if (!request) return { status: "skipped" };

  let indexed: number | undefined;
  if (ports.index) {
    try {
      // The whole thread, not just the folded turns: the index records each
      // hit's position in the conversation, and that number only means anything
      // if it is counted against what the user can see on screen.
      indexed = await ports.index(input.messages, fingerprint);
    } catch {
      // A failed index is not a failed job. The summary is still worth having,
      // and the header will simply not offer a tool that cannot deliver.
      indexed = undefined;
    }
  }

  if (stopped()) return { status: "aborted", indexed };

  const estimatedUsd = ports.estimateUsd(
    request.system.length + request.user.length,
    limits.maxOutputChars,
  );
  if (estimatedUsd > limits.maxUsd) return { status: "too-expensive", estimatedUsd, indexed };

  let raw: string;
  try {
    raw = await ports.complete(request.system, request.user);
  } catch {
    return { status: "errored", estimatedUsd, indexed };
  }

  // Checked after the call as well as before it: the user may have moved on
  // during the seconds it took, and writing a summary into a conversation they
  // have left is the same class of bug as filing an aborted turn's artifacts
  // into whichever conversation happens to be open.
  if (stopped()) return { status: "aborted", estimatedUsd, indexed };

  const parsed = parseFoldSummary(raw, request.replacedChars);
  if (!parsed.ok) return { status: "rejected", reason: parsed.reason, estimatedUsd, indexed };

  const summary: FoldSummary = {
    conversationId: input.conversationId,
    fingerprint,
    text: renderFoldSummary(parsed.body, {
      foldedCount: folded.length,
      model: input.model,
      at: now(),
      recallable: (indexed ?? 0) > 0,
    }),
    model: input.model,
    createdAt: now(),
    foldedCount: folded.length,
  };

  try {
    await ports.save(summary);
  } catch {
    return { status: "errored", estimatedUsd, indexed };
  }
  return { status: "saved", summary, estimatedUsd, indexed };
}
