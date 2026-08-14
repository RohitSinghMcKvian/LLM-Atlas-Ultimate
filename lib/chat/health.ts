// Conversation health (Depth Spec v2 C.5): token metering and
// summarize-and-continue for long conversations.

import type { ChatMessage } from "./types";
import { getModelById } from "@/lib/catalog";

export interface ConversationHealth {
  estimatedTokens: number;
  contextWindow: number;
  usage: number;
  status: "ok" | "warning" | "critical";
}

/**
 * Wrapper cost of one attachment in `attachmentsToPromptText`, in characters:
 * `<attachment name="" type="">\n` + `\n</attachment>` plus the name and kind.
 * Counted rather than ignored because a turn with eight files pays it eight
 * times, and it is the same order of magnitude as a short message.
 */
const ATTACHMENT_WRAPPER_CHARS = '<attachment name="" type="">\n\n</attachment>'.length;

/**
 * Characters this message actually contributes to a request.
 *
 * Only what `toRouterMessages` sends. That is a narrower set than a `ChatMessage`
 * carries, and the difference matters in both directions:
 *
 *  - `reasoning` is **not** counted, and never is: an assistant turn's thinking
 *    stays in the transcript and does not go back to the model.
 *  - `toolCalls` are not counted *here* either, but they are no longer free.
 *    With `turnActions` on, `lib/chat/request.ts` appends a bounded one-line
 *    record of each recent turn's actions — capped at 2000 characters across
 *    the whole request, which is inside this estimate's noise. The in-turn tool
 *    transcript, which is not bounded by anything that small, arrives through
 *    `HealthInput.toolTranscriptChars` instead.
 *  - Attachment text **is** counted, and was not before. It is inlined into the
 *    user turn, so a 200KB PDF is 200KB of context that the meter could not see.
 *
 * Images are excluded: their cost is tiles, not characters, and only the last
 * turn's images are sent at all.
 */
export function messageChars(m: ChatMessage): number {
  let chars = m.content.length;
  for (const a of m.attachments ?? []) {
    if (a.kind === "image" || !a.text) continue;
    chars += ATTACHMENT_WRAPPER_CHARS + a.name.length + a.kind.length + a.text.length;
  }
  return chars;
}

/** Everything that ends up on the wire, so the meter can count all of it. */
export interface HealthExtras {
  /**
   * Length of the system prompt for this turn.
   *
   * The prompt is budgeted up to `SYSTEM_PROMPT_MAX_CHARS` (24k characters, ~6k
   * tokens) once memories, the skills index and a build workspace are in it. On
   * a 128k model that is a few percent; on an 8k model it is most of the window,
   * and leaving it out is the difference between folding in time and overflowing.
   */
  systemChars?: number;
  /**
   * The search-results block, which rides as a second system message.
   *
   * Counted because it is sent, and it is not small — eight results with
   * snippets is a few thousand characters that the meter used to be blind to.
   */
  searchChars?: number;
  /**
   * The in-turn tool transcript, live from the loop.
   *
   * The big one, and the reason this signature changed. `runToolLoop` re-sends
   * every prior round's calls and results on every round, so a fifteen-round
   * build's request is many times the conversation it started from — and none of
   * it was visible here, so a build could report "ok" right up until the
   * provider refused it. 0 between turns.
   */
  toolTranscriptChars?: number;
}

export function measureHealth(
  messages: ChatMessage[],
  modelId: string,
  /** A number is read as `systemChars`, so existing callers keep working. */
  extras: HealthExtras | number = {},
): ConversationHealth {
  const { systemChars = 0, searchChars = 0, toolTranscriptChars = 0 } =
    typeof extras === "number" ? { systemChars: extras } : extras;
  // Deliberately arithmetic rather than `estimateTokens(contents.join("\n"))`:
  // this runs on every chat render, and materializing the whole conversation
  // as one string was allocating megabytes per keystroke on long threads.
  //
  // `estimateTokens` is chars/4, and the joined length is the sum of the parts
  // plus one separator between each — so for plain messages this is the same
  // integer, exactly. `health.test.ts` pins the two against each other.
  let chars = 0;
  for (const m of messages) chars += messageChars(m);
  if (messages.length > 1) chars += messages.length - 1;
  const estimatedTokens = Math.ceil(
    (chars + systemChars + searchChars + toolTranscriptChars) / 4,
  );

  const model = getModelById(modelId);
  const contextWindow = model?.contextWindow ?? 128_000;
  const usage = estimatedTokens / contextWindow;
  const status = usage >= 0.8 ? "critical" : usage >= 0.6 ? "warning" : "ok";
  return { estimatedTokens, contextWindow, usage, status };
}

export function shouldSuggestSummarize(health: ConversationHealth): boolean {
  return health.usage >= 0.6;
}

// `buildContinuationSummary` used to live here. It was superseded by
// `lib/chat/compact.ts`, which folds messages in place and keeps the transcript
// intact, and had no production callers by the time it was removed — dead code
// that documentation still described as live is worse than no documentation.
