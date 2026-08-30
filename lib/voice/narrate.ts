import { feed, flush, initSegmenter, type SegmentState } from "./segment";
import { planSpeech } from "./speech-plan";

/**
 * A streaming answer, as things to say.
 *
 * The two halves of this already existed and had never been put together.
 * `segment.ts` cuts a stream at places a listener expects a pause;
 * `speech-plan.ts` turns one piece of markdown into something worth hearing.
 * Neither is useful alone during a spoken turn: segmenting raw markdown queues
 * a fenced code block for the synthesiser to read character by character, and
 * planning the whole answer means saying nothing until the last token arrives,
 * which is the difference between a conversation and a form submission.
 *
 * Order is segment-then-plan rather than plan-then-segment, and that is the
 * only real decision here. Planning first would rewrite a half-arrived code
 * fence into "Code is being written on screen" on every flush, and then say it
 * again on the next one, and again - the announcement is stable only once the
 * fence has closed, which is exactly what `firstFenceBlock` waits for.
 *
 * Pure, so a spoken turn is testable without a synthesiser: given the chunks a
 * stream produced, these are the sentences that would have been spoken, in
 * order.
 */

export interface NarrationState {
  segmenter: SegmentState;
}

export function initNarration(): NarrationState {
  return { segmenter: initSegmenter() };
}

export interface NarrationResult {
  state: NarrationState;
  /** Ready to speak, in order. Empty is the common case mid-sentence. */
  utterances: string[];
}

/**
 * Whether a planned segment is worth sending to a synthesiser.
 *
 * A segment that was nothing but a link, a citation marker or an equation plans
 * down to punctuation or to nothing at all. Queuing that produces a gap the
 * listener reads as the agent having stopped, and on some engines an utterance
 * that never fires `onend` - which would strand the turn in `speaking` forever.
 */
export function isSpeakable(text: string): boolean {
  return /[a-zA-Z0-9]/.test(text);
}

/** Advance with the next chunk of the answer. */
export function narrate(state: NarrationState, chunk: string): NarrationResult {
  const r = feed(state.segmenter, chunk);
  return {
    state: { segmenter: r.state },
    utterances: r.segments.map((s) => planSpeech(s).speak).filter(isSpeakable),
  };
}

/** Say whatever is left. Called once the answer is complete. */
export function finishNarration(state: NarrationState): NarrationResult {
  const r = flush(state.segmenter);
  return {
    state: { segmenter: r.state },
    utterances: r.segments.map((s) => planSpeech(s).speak).filter(isSpeakable),
  };
}

/**
 * Narrate a whole answer at once.
 *
 * For a turn that was not streamed — a cached answer, an error, or a test.
 */
export function narrateAll(markdown: string): string[] {
  const fed = narrate(initNarration(), markdown);
  const rest = finishNarration(fed.state);
  return [...fed.utterances, ...rest.utterances];
}
