import { describe, it, expect } from "vitest";
import { buildLedger, consensusTrend, describeLedger } from "./session-ledger";
import { appendTurn, newSession, type CompareSession } from "./session";
import { emptyStages, type CompareRun, type JudgeScore, type LaneState } from "./types";

const lane = (id: string, over: Partial<LaneState> = {}): LaneState => ({
  id,
  modelId: id,
  band: 0,
  fit: "stuff",
  maxTokens: 1_000,
  budgetUsd: 0.1,
  status: "done",
  text: "an answer",
  reasoning: "",
  meters: {},
  ...over,
});

const score = (laneId: string, total: number): JudgeScore => ({
  laneId,
  scores: {},
  total,
  justification: "",
  unsupported: [],
});

const turn = (id: string, lanes: LaneState[], over: Partial<CompareRun> = {}): CompareRun => ({
  id,
  createdAt: 0,
  updatedAt: 0,
  config: { question: "q", modelIds: lanes.map((l) => l.id), depth: "standard" },
  stages: emptyStages(),
  lanes,
  ...over,
});

function sessionOf(turns: CompareRun[]): CompareSession {
  let s = newSession({ question: "q", modelIds: [], depth: "standard" });
  for (const t of turns) s = appendTurn(s, t.id);
  return s;
}

describe("buildLedger", () => {
  it("is empty for a session with no turns", () => {
    const s = newSession({ question: "q", modelIds: [], depth: "quick" });
    expect(buildLedger(s, []).turns).toBe(0);
  });

  it("counts turns and the lanes that answered", () => {
    const turns = [turn("r1", [lane("a"), lane("b")]), turn("r2", [lane("a"), lane("b")])];
    const l = buildLedger(sessionOf(turns), turns);
    expect(l.turns).toBe(2);
    expect(l.answeredTurns).toBe(2);
    expect(l.lanes.find((x) => x.laneId === "a")?.answered).toBe(2);
  });

  it("charges nothing for a lane that failed", () => {
    // A blocked lane never opened a connection; charging for it would make
    // connecting a key look like it saved money.
    const turns = [turn("r1", [lane("a"), lane("dead", { status: "error", text: "" })])];
    const l = buildLedger(sessionOf(turns), turns);
    const dead = l.lanes.find((x) => x.laneId === "dead")!;
    expect(dead.failed).toBe(1);
    expect(dead.costUsd).toBe(0);
  });

  it("counts a turn nobody answered as unanswered", () => {
    const turns = [turn("r1", [lane("a", { status: "error", text: "" })])];
    expect(buildLedger(sessionOf(turns), turns).answeredTurns).toBe(0);
  });

  it("adds the stage costs, not only the lanes", () => {
    const stages = emptyStages();
    stages.synthesis = { status: "done", costUsd: 0.02, promptTokens: 100, completionTokens: 50 };
    const turns = [turn("r1", [lane("a")], { stages })];
    const l = buildLedger(sessionOf(turns), turns);
    expect(l.costUsd).toBeCloseTo(0.02, 10);
    expect(l.promptTokens).toBe(100);
  });

  it("counts a turn's wall time as its slowest lane, not the sum", () => {
    // The lanes ran at the same time; summing them reports one minute of
    // waiting as three.
    const turns = [
      turn("r1", [
        lane("a", { meters: { totalMs: 1_000 } }),
        lane("b", { meters: { totalMs: 5_000 } }),
      ]),
    ];
    expect(buildLedger(sessionOf(turns), turns).totalMs).toBe(5_000);
  });

  it("keeps the judge's wins and the user's apart", () => {
    // The turns where they disagree are the interesting ones.
    const turns = [
      turn("r1", [lane("a"), lane("b")], {
        verdict: { bestOverall: "a", reasons: {} },
        kept: "b",
      }),
    ];
    const l = buildLedger(sessionOf(turns), turns);
    expect(l.lanes.find((x) => x.laneId === "a")?.judgeWins).toBe(1);
    expect(l.lanes.find((x) => x.laneId === "a")?.keptWins).toBe(0);
    expect(l.lanes.find((x) => x.laneId === "b")?.keptWins).toBe(1);
  });

  it("means the scores across the turns a lane was scored on", () => {
    const turns = [
      turn("r1", [lane("a")], { scores: [score("a", 6)] }),
      turn("r2", [lane("a")], { scores: [score("a", 8)] }),
    ];
    expect(buildLedger(sessionOf(turns), turns).lanes[0].meanScore).toBe(7);
  });

  it("leaves the mean null for a lane nobody scored", () => {
    const turns = [turn("r1", [lane("a")])];
    expect(buildLedger(sessionOf(turns), turns).lanes[0].meanScore).toBeNull();
  });

  it("ranks lanes by mean score, then by what the user kept", () => {
    const turns = [
      turn("r1", [lane("weak"), lane("strong")], { scores: [score("weak", 3), score("strong", 9)] }),
    ];
    expect(buildLedger(sessionOf(turns), turns).lanes[0].laneId).toBe("strong");
  });

  it("flags that a cost is incomplete rather than reporting it as free", () => {
    const turns = [turn("r1", [lane("a")])]; // no usage reported
    expect(buildLedger(sessionOf(turns), turns).costIncomplete).toBe(true);
  });

  it("records one consensus point per turn that measured it", () => {
    const withConsensus = (id: string, consensus: number): CompareRun =>
      turn(id, [lane("a"), lane("b")], {
        analysis: {
          lanes: {},
          similarity: {
            pairs: [{ a: "a", b: "b", score: consensus }],
            matrix: {},
            clusters: [],
            consensus,
          },
          coverage: { usage: [], unused: [], universal: [], coverage: 0 },
          frontier: [],
          computedAt: 0,
        },
      });
    const turns = [withConsensus("r1", 0.4), withConsensus("r2", 0.7)];
    expect(buildLedger(sessionOf(turns), turns).consensusDrift).toEqual([
      { turn: 0, consensus: 0.4 },
      { turn: 1, consensus: 0.7 },
    ]);
  });

  it("ignores a turn with only one answer, which has no consensus to measure", () => {
    const turns = [
      turn("r1", [lane("a")], {
        analysis: {
          lanes: {},
          similarity: { pairs: [], matrix: {}, clusters: [], consensus: 0 },
          coverage: { usage: [], unused: [], universal: [], coverage: 0 },
          frontier: [],
          computedAt: 0,
        },
      }),
    ];
    expect(buildLedger(sessionOf(turns), turns).consensusDrift).toEqual([]);
  });
});

describe("consensusTrend", () => {
  const ledgerWith = (values: number[]) =>
    ({ consensusDrift: values.map((consensus, turn) => ({ turn, consensus })) }) as ReturnType<
      typeof buildLedger
    >;

  it("has no direction from a single point", () => {
    expect(consensusTrend(ledgerWith([0.5]))).toBeNull();
  });

  it("reads a rise as converging", () => {
    expect(consensusTrend(ledgerWith([0.3, 0.8]))).toBe("rising");
  });

  it("reads a fall as the question opening up", () => {
    expect(consensusTrend(ledgerWith([0.8, 0.3]))).toBe("falling");
  });

  it("calls a small change flat rather than a trend", () => {
    expect(consensusTrend(ledgerWith([0.5, 0.52]))).toBe("flat");
  });
});

describe("describeLedger", () => {
  it("says so when nothing has run", () => {
    const s = newSession({ question: "q", modelIds: [], depth: "quick" });
    expect(describeLedger(buildLedger(s, []))).toBe("Nothing yet");
  });

  it("counts turns and seconds", () => {
    const turns = [turn("r1", [lane("a", { meters: { totalMs: 3_000 } })])];
    expect(describeLedger(buildLedger(sessionOf(turns), turns))).toBe("1 turn · 3s");
  });
});
