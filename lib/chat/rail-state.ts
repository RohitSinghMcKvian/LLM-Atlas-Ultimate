/**
 * When the build rail is shown, and which tab.
 *
 * The rail carries three things — the live run, the files, the preview — and it
 * used to be gated on one of them. `railShown` was `artifactCount > 0 &&
 * artifactOpen`, and every writer of `artifactOpen` was an artifact appearing.
 * So the Run panel, which exists to make a twenty-round build legible *while it
 * runs*, could not be seen during a build: the workspace→artifact mirror only
 * happens when the turn ends, so for the whole run `artifactCount` was 0 and
 * nothing opened the rail. The panel was reachable exactly when it was no longer
 * needed.
 *
 * The fix is to say what the rail is *for* rather than what it started as. A run
 * in flight is content. Files are content. An artifact is content. And the user
 * closing it is a decision that holds for the turn.
 *
 * Pure, because this is the rule that was wrong and a rule that lives in a
 * component cannot be tested — `vitest.config.ts` reaches only `lib/**`.
 */

export type RailTab = "run" | "files" | "preview";

export const RAIL_TABS: RailTab[] = ["run", "files", "preview"];

export function isRailTab(v: unknown): v is RailTab {
  return v === "run" || v === "files" || v === "preview";
}

/** What the conversation currently has to show. */
export interface RailSignals {
  hasConversation: boolean;
  artifactCount: number;
  workspaceFileCount: number;
  /** Binaries `run_python` produced — reachable only through the Files tab. */
  producedFileCount: number;
  toolCallCount: number;
  streaming: boolean;
}

/** What the user has decided about it. */
export interface RailUserState {
  open: boolean;
  /** They closed it during this turn. Cleared on the next send. */
  closedThisTurn: boolean;
  /** They picked a tab during this turn, so stop moving it for them. */
  pinnedTab: boolean;
}

/**
 * Is there anything worth showing?
 *
 * `streaming || toolCallCount > 0` is the whole repair. During a build with no
 * artifact and no file yet, **the run is the content** — the meters, the plan
 * ledger and the live terminal are precisely what the user wants to watch — and
 * the old predicate was the one thing refusing to count it.
 *
 * `producedFileCount` covers the other reachability hole: `run_python` with
 * Build off writes a file that lives only in the Files tab.
 */
export function railHasContent(s: RailSignals): boolean {
  if (!s.hasConversation) return false;
  return (
    s.artifactCount > 0 ||
    s.workspaceFileCount > 0 ||
    s.producedFileCount > 0 ||
    s.streaming ||
    s.toolCallCount > 0
  );
}

export function railShown(s: RailSignals, u: RailUserState): boolean {
  return u.open && railHasContent(s);
}

/** Why the rail opened. Kept for the caller's own reasoning and for tests. */
export type OpenReason = "build-start" | "tools" | "artifact" | "files";

/**
 * Should the rail open by itself, and why?
 *
 * `closedThisTurn` suppresses every trigger — the same lifecycle as `pinnedTab`,
 * and for the same reason: choreography right up until someone disagrees, then
 * their choice holds for the turn.
 */
export function autoOpen(
  s: RailSignals,
  u: RailUserState,
  event: { buildStarting?: boolean; artifactAppeared?: boolean; filesAppeared?: boolean },
): OpenReason | null {
  if (u.open || u.closedThisTurn) return null;
  // Before the first stream round, not on the first tool call: the meters are
  // already initialised against this turn's real ceilings before a token is
  // spent, and that disclosure is worth nothing if it arrives twenty seconds in.
  if (event.buildStarting) return "build-start";
  if (event.artifactAppeared && s.artifactCount > 0) return "artifact";
  if (event.filesAppeared) return "files";
  // A turn that turns out agentic without being a build — auto-detect, a
  // connector, code execution.
  if (s.streaming && s.toolCallCount > 0) return "tools";
  return null;
}

/**
 * Which tab the rail should move to on its own, or null to leave it alone.
 *
 * Ordered by what the user most wants to see: a finished artifact is what they
 * asked for, a run in flight is how it is going, files are the record. A tab the
 * user picked themselves is never overridden.
 */
export function autoTab(
  s: RailSignals,
  u: RailUserState,
  event: { artifactAppeared?: boolean; filesAppeared?: boolean },
): RailTab | null {
  if (u.pinnedTab) return null;
  // Never while streaming: an artifact recorded mid-build should not yank the
  // panel away from the run that is still producing it.
  if (event.artifactAppeared && s.artifactCount > 0 && !s.streaming) return "preview";
  if (s.streaming && s.toolCallCount > 0) return "run";
  if (event.filesAppeared) return "files";
  return null;
}

/**
 * The tab actually rendered.
 *
 * Preview is the one tab that can be empty — a build may produce only data
 * files, and the persisted tab may name a state this conversation never reached.
 * Falling back here means a stale value can never leave the rail blank.
 */
export function effectiveTab(tab: RailTab, hasPreview: boolean): RailTab {
  if (tab === "preview" && !hasPreview) return "run";
  return tab;
}

/** Whether a tab may be selected at all, for the tab strip's disabled state. */
export function tabEnabled(tab: RailTab, hasPreview: boolean): boolean {
  return tab !== "preview" || hasPreview;
}
