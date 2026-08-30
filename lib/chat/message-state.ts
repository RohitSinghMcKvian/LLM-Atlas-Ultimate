/**
 * How one assistant turn presents itself, as a decision separated from the JSX.
 *
 * This exists because the branch it replaces got the answer wrong in a way that
 * was invisible from the component. `chat-client.tsx` marks a message
 * `error: true` when the router fails, `patchMessage` is a shallow merge, and the
 * prose fallback — the recovery path, which is *gated on that very flag* — then
 * streams an entire build through content-only patches. So a turn that was busy
 * succeeding rendered in the failure style for its whole run: red, unwrapped, and
 * with its artifact card suppressed.
 *
 * The rule that prevents it is one sentence — **a turn that produced text is not
 * a failure** — and it belongs somewhere it can be stated once and tested. The
 * suite is node-only (`vitest.config.ts` sets `environment: "node"`), so a rule
 * living inside a component is a rule nothing can check.
 *
 * Same seam as `lib/chat/activity.ts`: pure here, dumb there.
 */

/** Which of the four shapes a turn takes in the transcript. */
export type MessagePresentation =
  /** The user's own text, in a bubble. */
  | "user"
  /** An answer: markdown body, on the page rather than in a card. */
  | "answer"
  /** Nothing to show yet — the run is under way and the bubble says so. */
  | "waiting"
  /** The turn produced nothing usable, and says why. */
  | "failed";

export interface MessageStateInput {
  role: string;
  /**
   * There is body text to render — measured *after* the artifact block is
   * stripped out, since a turn whose entire output was one file has no prose and
   * must not be mistaken for an empty one.
   */
  hasBody: boolean;
  /** The turn is still in flight. */
  streaming?: boolean;
  /** The message carries a failure. */
  error?: boolean;
}

export interface MessageView {
  presentation: MessagePresentation;
  /** Render the body container at all. */
  showsBody: boolean;
  /**
   * Show what the turn produced: the artifact card, the file chips, the usage
   * line. Suppressed only on a real failure, where there is nothing to point at.
   */
  showsDeliverables: boolean;
  /** The blinking caret that trails live text. */
  showsCaret: boolean;
}

export function messageView(input: MessageStateInput): MessageView {
  if (input.role === "user") {
    return {
      presentation: "user",
      showsBody: true,
      showsDeliverables: false,
      showsCaret: false,
    };
  }

  if (input.error) {
    return {
      presentation: "failed",
      showsBody: true,
      showsDeliverables: false,
      showsCaret: false,
    };
  }

  if (input.hasBody) {
    return {
      presentation: "answer",
      showsBody: true,
      showsDeliverables: true,
      showsCaret: !!input.streaming,
    };
  }

  return {
    presentation: "waiting",
    // Only while something is actually happening. The condition this replaces
    // was inverted — `!streaming` — so the live step line never appeared during
    // an agentic run, and a finished turn that returned nothing pulsed forever.
    showsBody: !!input.streaming,
    showsDeliverables: true,
    showsCaret: false,
  };
}

/**
 * What the prose fallback amounted to.
 *
 * The fallback re-asks in prose after a build failed to get its file out through
 * a tool call, and it is entered on a message already flagged as an error. Three
 * endings, and only one of them is still a failure:
 *
 *  - files parsed out of the answer — the build worked;
 *  - text arrived but no file did — the answer is real and the user should read
 *    it. Presenting several thousand words as an error is how the original bug
 *    looked; saying "no files" as a note is the honest version;
 *  - nothing came back — the original error stands, and stands alone.
 */
export type RecoveryOutcome = "files" | "text-only" | "nothing";

export function recoveryOutcome(input: { text: string; files: number }): RecoveryOutcome {
  if (input.files > 0) return "files";
  return input.text.trim() ? "text-only" : "nothing";
}

/** The note a recovery leaves in the activity row, or null when it needs none. */
export function recoveryNote(outcome: RecoveryOutcome): string | null {
  if (outcome === "files") return "Retried without tools";
  if (outcome === "text-only") return "Retried without tools · no files in the answer";
  return null;
}
