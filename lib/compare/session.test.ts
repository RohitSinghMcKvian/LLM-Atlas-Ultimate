import { describe, it, expect } from "vitest";
import {
  appendTurn,
  describeSession,
  forkSession,
  inheritedEvidence,
  newSession,
  orderedTurns,
  renameSession,
  runId,
  sessionId,
  setLanes,
  titleFrom,
  togglePinned,
  turnIndexOf,
  type CompareSession,
} from "./session";
import { EMPTY_EVIDENCE, emptyStages, type CompareRun, type EvidencePack } from "./types";

const run = (id: string, over: Partial<CompareRun> = {}): CompareRun => ({
  id,
  createdAt: 0,
  updatedAt: 0,
  config: { question: "q", modelIds: [], depth: "standard" },
  stages: emptyStages(),
  lanes: [],
  ...over,
});

const session = (over: Partial<CompareSession> = {}): CompareSession => ({
  ...newSession({ question: "What are the trade-offs?", modelIds: ["a", "b"], depth: "standard", now: 1000 }),
  ...over,
});

describe("titleFrom", () => {
  it("uses the question", () => {
    expect(titleFrom("Compare RAG and long context")).toBe("Compare RAG and long context");
  });

  it("truncates at 48 characters, matching the chat rail", () => {
    const long = "x".repeat(80);
    expect(titleFrom(long)).toHaveLength(49); // 48 plus the ellipsis
    expect(titleFrom(long).endsWith("…")).toBe(true);
  });

  it("collapses whitespace", () => {
    expect(titleFrom("  two   words  ")).toBe("two words");
  });

  it("has a name for an empty question", () => {
    expect(titleFrom("   ")).toBe("New comparison");
  });
});

describe("ids", () => {
  it("are unique even within the same millisecond", () => {
    const ids = new Set(Array.from({ length: 200 }, () => sessionId()));
    expect(ids.size).toBe(200);
  });

  it("are prefixed so a stray one is identifiable", () => {
    expect(sessionId().startsWith("cs_")).toBe(true);
    expect(runId().startsWith("cr_")).toBe(true);
  });
});

describe("newSession", () => {
  it("starts saved unless told otherwise", () => {
    expect(newSession({ question: "q", modelIds: [], depth: "quick" }).incognito).toBe(false);
  });

  it("starts with no turns", () => {
    expect(newSession({ question: "q", modelIds: [], depth: "quick" }).turnIds).toEqual([]);
  });

  it("copies the lane set rather than aliasing it", () => {
    const models = ["a"];
    const s = newSession({ question: "q", modelIds: models, depth: "quick" });
    models.push("b");
    expect(s.modelIds).toEqual(["a"]);
  });
});

describe("appendTurn", () => {
  it("records the turn in order", () => {
    let s = session();
    s = appendTurn(s, "r1", 2000);
    s = appendTurn(s, "r2", 3000);
    expect(s.turnIds).toEqual(["r1", "r2"]);
    expect(s.updatedAt).toBe(3000);
  });

  it("is idempotent, because the runtime checkpoints the same turn twice", () => {
    // A duplicated id would make `turnIndexOf` ambiguous.
    let s = appendTurn(session(), "r1", 2000);
    s = appendTurn(s, "r1", 4000);
    expect(s.turnIds).toEqual(["r1"]);
    expect(s.updatedAt).toBe(4000);
  });
});

describe("orderedTurns", () => {
  it("returns runs in turn order, not storage order", () => {
    const s = { ...session(), turnIds: ["r2", "r1"] };
    expect(orderedTurns(s, [run("r1"), run("r2")]).map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("skips ids the store no longer has", () => {
    const s = { ...session(), turnIds: ["r1", "gone", "r2"] };
    expect(orderedTurns(s, [run("r1"), run("r2")]).map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("finds a turn's index", () => {
    const s = { ...session(), turnIds: ["r1", "r2"] };
    expect(turnIndexOf(s, "r2")).toBe(1);
    expect(turnIndexOf(s, "nope")).toBe(-1);
  });
});

describe("setLanes / renameSession / togglePinned", () => {
  it("replaces the lane set and touches the session", () => {
    const s = setLanes(session(), ["x", "y", "z"], 5000);
    expect(s.modelIds).toEqual(["x", "y", "z"]);
    expect(s.updatedAt).toBe(5000);
  });

  it("names an empty rename rather than blanking the title", () => {
    expect(renameSession(session(), "   ").title).toBe("Untitled");
  });

  it("toggles the pin both ways", () => {
    const on = togglePinned(session());
    expect(on.pinned).toBe(true);
    expect(togglePinned(on).pinned).toBe(false);
  });
});

describe("forkSession", () => {
  const base = { ...session(), turnIds: ["r1", "r2", "r3"] };
  const runs = [run("r1"), run("r2"), run("r3")];

  it("copies the prefix up to and including the chosen turn", () => {
    const fork = forkSession(base, runs, 1, 9000)!;
    expect(fork.runs).toHaveLength(2);
    expect(fork.session.turnIds).toHaveLength(2);
  });

  it("regenerates run ids, so editing the fork cannot mutate the original", () => {
    const fork = forkSession(base, runs, 1)!;
    expect(fork.runs.map((r) => r.id)).not.toContain("r1");
    expect(fork.runs.every((r) => r.sessionId === fork.session.id)).toBe(true);
  });

  it("renumbers the copied turns from zero", () => {
    expect(forkSession(base, runs, 2)!.runs.map((r) => r.turnIndex)).toEqual([0, 1, 2]);
  });

  it("records where it came from", () => {
    expect(forkSession(base, runs, 1)!.session.forkedFrom).toEqual({
      sessionId: base.id,
      turnIndex: 1,
    });
  });

  it("inherits incognito — a fork must not become the copy the user declined", () => {
    const temp = { ...base, incognito: true };
    expect(forkSession(temp, runs, 0)!.session.incognito).toBe(true);
  });

  it("does not inherit the pin", () => {
    expect(forkSession({ ...base, pinned: true }, runs, 0)!.session.pinned).toBe(false);
  });

  it("refuses a turn index that does not exist", () => {
    expect(forkSession(base, runs, 9)).toBeNull();
    expect(forkSession(base, runs, -1)).toBeNull();
  });
});

describe("inheritedEvidence", () => {
  const pack = (n: number): EvidencePack => ({
    ...EMPTY_EVIDENCE,
    sources: Array.from({ length: n }, (_, i) => ({
      title: `S${i}`,
      url: `https://x/${i}`,
      snippet: "",
    })),
  });

  it("is undefined when no turn gathered anything", () => {
    expect(inheritedEvidence([run("r1"), run("r2")])).toBeUndefined();
  });

  it("keeps the first real pack, so citation numbers stay stable", () => {
    const runs = [run("r1", { evidence: pack(3) }), run("r2", { evidence: EMPTY_EVIDENCE })];
    expect(inheritedEvidence(runs)?.sources).toHaveLength(3);
  });

  it("ignores an empty pack from a turn that skipped research", () => {
    const runs = [run("r1", { evidence: EMPTY_EVIDENCE }), run("r2", { evidence: pack(2) })];
    expect(inheritedEvidence(runs)?.sources).toHaveLength(2);
  });

  it("is replaced by a turn that researched again", () => {
    const runs = [
      run("r1", { evidence: pack(3) }),
      run("r2", { evidence: pack(7), refreshedEvidence: true }),
    ];
    expect(inheritedEvidence(runs)?.sources).toHaveLength(7);
  });

  it("does not let a later ordinary turn replace the pack", () => {
    const runs = [run("r1", { evidence: pack(3) }), run("r2", { evidence: pack(9) })];
    expect(inheritedEvidence(runs)?.sources).toHaveLength(3);
  });
});

describe("describeSession", () => {
  it("counts turns and models", () => {
    const s = { ...session(), turnIds: ["a", "b", "c"] };
    expect(describeSession(s)).toBe("3 turns · 2 models");
  });

  it("uses the singular for one of each", () => {
    const s = { ...session({ modelIds: ["only"] }), turnIds: ["a"] };
    expect(describeSession(s)).toBe("1 turn · 1 model");
  });
});
