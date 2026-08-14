import { describe, it, expect } from "vitest";
import {
  autoOpen,
  autoTab,
  effectiveTab,
  isRailTab,
  railHasContent,
  railShown,
  tabEnabled,
  type RailSignals,
  type RailUserState,
} from "./rail-state";

const signals = (over: Partial<RailSignals> = {}): RailSignals => ({
  hasConversation: true,
  artifactCount: 0,
  workspaceFileCount: 0,
  producedFileCount: 0,
  toolCallCount: 0,
  streaming: false,
  ...over,
});

const user = (over: Partial<RailUserState> = {}): RailUserState => ({
  open: true,
  closedThisTurn: false,
  pinnedTab: false,
  ...over,
});

describe("railHasContent", () => {
  /**
   * THE regression. The Run panel exists to make a twenty-round build legible
   * while it runs, and the old predicate — artifacts only — meant it could not
   * be seen during one: the workspace→artifact mirror happens when the turn
   * ends, so for the entire run there was nothing to count.
   */
  it("counts a run in flight as content", () => {
    expect(railHasContent(signals({ streaming: true }))).toBe(true);
    expect(railHasContent(signals({ toolCallCount: 2 }))).toBe(true);
  });

  // The other reachability hole: `run_python` with Build off writes a file that
  // lives only in the Files tab.
  it("counts a produced file as content", () => {
    expect(railHasContent(signals({ producedFileCount: 1 }))).toBe(true);
  });

  it("counts artifacts and workspace files", () => {
    expect(railHasContent(signals({ artifactCount: 1 }))).toBe(true);
    expect(railHasContent(signals({ workspaceFileCount: 1 }))).toBe(true);
  });

  it("has nothing to show in an empty conversation", () => {
    expect(railHasContent(signals())).toBe(false);
  });

  it("has nothing to show with no conversation at all", () => {
    expect(railHasContent(signals({ hasConversation: false, streaming: true }))).toBe(false);
  });
});

describe("railShown", () => {
  it("needs both content and an open rail", () => {
    expect(railShown(signals({ streaming: true }), user())).toBe(true);
    expect(railShown(signals({ streaming: true }), user({ open: false }))).toBe(false);
    expect(railShown(signals(), user())).toBe(false);
  });
});

describe("autoOpen", () => {
  // Before the first stream round, not on the first tool call: the meters are
  // initialised against this turn's real ceilings before a token is spent, and
  // that disclosure is worth nothing arriving twenty seconds in.
  it("opens on build start, before anything has happened", () => {
    expect(autoOpen(signals(), user({ open: false }), { buildStarting: true })).toBe("build-start");
  });

  it("opens for a turn that turns out agentic without being a build", () => {
    expect(
      autoOpen(signals({ streaming: true, toolCallCount: 1 }), user({ open: false }), {}),
    ).toBe("tools");
  });

  it("opens when an artifact or a file appears", () => {
    expect(
      autoOpen(signals({ artifactCount: 1 }), user({ open: false }), { artifactAppeared: true }),
    ).toBe("artifact");
    expect(
      autoOpen(signals({ workspaceFileCount: 1 }), user({ open: false }), { filesAppeared: true }),
    ).toBe("files");
  });

  // Choreography up until someone disagrees, then their choice holds.
  it("respects a rail the user closed this turn", () => {
    const closed = user({ open: false, closedThisTurn: true });
    expect(autoOpen(signals(), closed, { buildStarting: true })).toBeNull();
    expect(autoOpen(signals({ artifactCount: 1 }), closed, { artifactAppeared: true })).toBeNull();
    expect(autoOpen(signals({ streaming: true, toolCallCount: 3 }), closed, {})).toBeNull();
  });

  it("does nothing when the rail is already open", () => {
    expect(autoOpen(signals(), user({ open: true }), { buildStarting: true })).toBeNull();
  });

  it("does nothing on an idle turn with nothing to show", () => {
    expect(autoOpen(signals(), user({ open: false }), {})).toBeNull();
  });
});

describe("autoTab", () => {
  it("shows the run while tools are being called", () => {
    expect(autoTab(signals({ streaming: true, toolCallCount: 1 }), user(), {})).toBe("run");
  });

  it("shows a finished artifact once the turn settles", () => {
    expect(autoTab(signals({ artifactCount: 1 }), user(), { artifactAppeared: true })).toBe(
      "preview",
    );
  });

  // An artifact recorded mid-build must not yank the panel away from the run
  // that is still producing it.
  it("does not switch to preview mid-run", () => {
    expect(
      autoTab(
        signals({ artifactCount: 1, streaming: true, toolCallCount: 2 }),
        user(),
        { artifactAppeared: true },
      ),
    ).toBe("run");
  });

  it("shows files when they appear outside a run", () => {
    expect(autoTab(signals({ producedFileCount: 1 }), user(), { filesAppeared: true })).toBe(
      "files",
    );
  });

  it("never overrides a tab the user picked", () => {
    const pinned = user({ pinnedTab: true });
    expect(autoTab(signals({ streaming: true, toolCallCount: 1 }), pinned, {})).toBeNull();
    expect(autoTab(signals({ artifactCount: 1 }), pinned, { artifactAppeared: true })).toBeNull();
  });

  // Preview with nothing in it is the empty-body bug.
  it("never chooses preview with no artifact", () => {
    expect(autoTab(signals(), user(), { artifactAppeared: true })).not.toBe("preview");
  });
});

describe("effectiveTab", () => {
  // A tab persisted from an earlier session can name a state this conversation
  // never reached; the stored default was itself the bug.
  it("falls back to run when preview has nothing to show", () => {
    expect(effectiveTab("preview", false)).toBe("run");
    expect(effectiveTab("preview", true)).toBe("preview");
  });

  it("leaves the always-valid tabs alone", () => {
    expect(effectiveTab("run", false)).toBe("run");
    expect(effectiveTab("files", false)).toBe("files");
  });
});

describe("tabEnabled / isRailTab", () => {
  it("disables only preview, and only when empty", () => {
    expect(tabEnabled("preview", false)).toBe(false);
    expect(tabEnabled("preview", true)).toBe(true);
    expect(tabEnabled("run", false)).toBe(true);
    expect(tabEnabled("files", false)).toBe(true);
  });

  it("rejects a persisted value that is not a tab", () => {
    expect(isRailTab("run")).toBe(true);
    expect(isRailTab("artifact")).toBe(false);
    expect(isRailTab(undefined)).toBe(false);
  });
});
