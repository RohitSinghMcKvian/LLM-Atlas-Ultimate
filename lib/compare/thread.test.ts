import { describe, it, expect } from "vitest";
import {
  CONTEXT_WARN_AT,
  contextUse,
  describeContext,
  fitLaneHistory,
  laneHistory,
  laneJoinedAt,
} from "./thread";
import { appendTurn, newSession, type CompareSession } from "./session";
import { emptyStages, type CompareRun, type LaneState } from "./types";

const lane = (id: string, text: string): LaneState => ({
  id,
  modelId: id,
  band: 0,
  fit: "stuff",
  maxTokens: 1_000,
  budgetUsd: 0.1,
  status: text ? "done" : "error",
  text,
  reasoning: "",
  meters: {},
});

const turn = (id: string, question: string, lanes: LaneState[], at = 1000): CompareRun => ({
  id,
  createdAt: at,
  updatedAt: at + 1,
  config: { question, modelIds: lanes.map((l) => l.id), depth: "standard" },
  stages: emptyStages(),
  lanes,
});

/** A session with `turns` appended in order. */
function sessionOf(turns: CompareRun[]): CompareSession {
  let s = newSession({ question: turns[0]?.config.question ?? "q", modelIds: [], depth: "standard" });
  for (const t of turns) s = appendTurn(s, t.id);
  return s;
}

describe("laneHistory", () => {
  const turns = [
    turn("r1", "First question", [lane("gpt", "GPT first answer"), lane("claude", "Claude first answer")]),
    turn("r2", "Second question", [lane("gpt", "GPT second answer"), lane("claude", "Claude second answer")]),
  ];
  const session = sessionOf(turns);

  it("gives a lane only its own answers", () => {
    // The whole point: no other model's text may enter this lane's context, or
    // the comparison stops being a comparison.
    const history = laneHistory(session, turns, "gpt");
    const text = history.map((m) => m.content).join("\n");
    expect(text).toContain("GPT first answer");
    expect(text).toContain("GPT second answer");
    expect(text).not.toContain("Claude");
  });

  it("alternates question and answer, oldest first", () => {
    expect(laneHistory(session, turns, "gpt").map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("uses the brief's restated task when there is one", () => {
    const withBrief = [
      {
        ...turns[0],
        brief: {
          task: "The restated question",
          shape: "answer" as const,
          rubric: { criteria: [], groundRules: [] },
          researchQueries: [],
        },
      },
    ];
    const history = laneHistory(sessionOf(withBrief), withBrief, "gpt");
    expect(history[0].content).toBe("The restated question");
  });

  it("skips a turn the lane did not answer", () => {
    // A user turn with no reply teaches the model that questions can be ignored.
    const mixed = [
      turn("r1", "First", [lane("gpt", "answered")]),
      turn("r2", "Second", [lane("gpt", "")]),
      turn("r3", "Third", [lane("gpt", "answered again")]),
    ];
    const history = laneHistory(sessionOf(mixed), mixed, "gpt");
    expect(history).toHaveLength(4);
    expect(history.map((m) => m.content)).not.toContain("Second");
  });

  it("is empty for a lane that never ran", () => {
    expect(laneHistory(session, turns, "never-here")).toEqual([]);
  });

  it("does not carry the evidence pack — that is sent once, separately", () => {
    const withEvidence = [
      {
        ...turns[0],
        evidence: {
          sources: [{ title: "Src", url: "https://a", snippet: "body" }],
          documents: [],
          queriesRun: [],
          rounds: 1,
          failedQueries: 0,
          stoppedBy: null,
        },
      },
    ];
    const history = laneHistory(sessionOf(withEvidence), withEvidence, "gpt");
    expect(history.map((m) => m.content).join("")).not.toContain("Src");
  });
});

describe("laneJoinedAt", () => {
  const turns = [
    turn("r1", "One", [lane("early", "yes")]),
    turn("r2", "Two", [lane("early", "yes"), lane("late", "first words")]),
  ];
  const session = sessionOf(turns);

  it("is 0 for a lane present from the start", () => {
    expect(laneJoinedAt(session, turns, "early")).toBe(0);
  });

  it("is the turn a late lane first answered on", () => {
    expect(laneJoinedAt(session, turns, "late")).toBe(1);
  });

  it("is -1 for a lane that never answered", () => {
    expect(laneJoinedAt(session, turns, "ghost")).toBe(-1);
  });
});

describe("fitLaneHistory", () => {
  const wide = { contextWindow: 200_000 };
  const narrow = { contextWindow: 8_000 };

  /** `n` exchanges of roughly `chars` characters each. */
  function history(n: number, chars = 200) {
    const turns = Array.from({ length: n }, (_, i) =>
      turn(`r${i}`, `Question ${i} ${"q".repeat(chars)}`, [lane("m", `Answer ${i} ${"a".repeat(chars)}`)]),
    );
    return laneHistory(sessionOf(turns), turns, "m");
  }

  it("sends a short history untouched", () => {
    const h = history(2);
    const fitted = fitLaneHistory(h, wide, 2_000);
    expect(fitted.messages).toEqual(h);
    expect(fitted.foldedCount).toBe(0);
  });

  it("is a no-op for an empty history", () => {
    expect(fitLaneHistory([], wide, 0)).toEqual({ messages: [], foldedCount: 0, tokens: 0 });
  });

  it("folds when the thread outgrows the window", () => {
    const fitted = fitLaneHistory(history(30, 900), narrow, 2_000);
    expect(fitted.foldedCount).toBeGreaterThan(0);
    expect(fitted.messages.length).toBeLessThan(40);
  });

  it("keeps the newest turns rather than the oldest", () => {
    const h = history(30, 900);
    const fitted = fitLaneHistory(h, narrow, 2_000);
    const text = fitted.messages.map((m) => m.content).join("\n");
    expect(text).toContain("Answer 29");
  });

  it("reports fewer tokens than it was given", () => {
    const h = history(30, 900);
    const fitted = fitLaneHistory(h, narrow, 2_000);
    expect(fitted.tokens).toBeGreaterThan(0);
    expect(fitted.tokens).toBeLessThan(
      h.map((m) => String(m.content)).join("\n").length / 4,
    );
  });

  it("drops the oldest exchange when there are too few turns to fold", () => {
    // `planCompaction` refuses below its minimum, and a request that overflows
    // is rejected outright by the provider — losing the start beats losing all.
    const h = history(2, 20_000);
    const fitted = fitLaneHistory(h, { contextWindow: 4_000 }, 500);
    expect(fitted.messages.length).toBeLessThan(h.length);
    expect(fitted.foldedCount).toBeGreaterThan(0);
  });

  it("sends what it has when the window is unknown", () => {
    const h = history(3);
    expect(fitLaneHistory(h, undefined, 0).messages).toEqual(h);
  });
});

describe("contextUse", () => {
  const model = { contextWindow: 10_000 };

  it("is empty for a fresh lane", () => {
    expect(contextUse([], model, 0).used).toBe(0);
  });

  it("measures against the usable window, not the raw one", () => {
    // The raw number shows comfortable headroom right up to the rejection.
    const bare = contextUse([], model, 0);
    const reserved = contextUse([], model, 5_000);
    expect(reserved.usable).toBeLessThan(bare.usable);
  });

  it("grows with the thread", () => {
    const turns = [turn("r1", "q", [lane("m", "a".repeat(4_000))])];
    const h = laneHistory(sessionOf(turns), turns, "m");
    expect(contextUse(h, model, 0).fraction).toBeGreaterThan(0);
  });

  it("does not divide by zero on an unknown window", () => {
    expect(contextUse([], undefined, 0).fraction).toBe(0);
  });
});

describe("describeContext", () => {
  it("says what it folded", () => {
    expect(describeContext({ used: 0, usable: 10, fraction: 0 }, 3)).toContain("3 earlier turns");
  });

  it("warns before folding becomes necessary", () => {
    const use = { used: 90, usable: 100, fraction: 0.9 };
    expect(describeContext(use, 0)).toContain("90%");
  });

  it("says nothing when there is room", () => {
    expect(describeContext({ used: 1, usable: 100, fraction: 0.01 }, 0)).toBeNull();
  });

  it("stays quiet just under the warning threshold", () => {
    const use = { used: 1, usable: 100, fraction: CONTEXT_WARN_AT - 0.01 };
    expect(describeContext(use, 0)).toBeNull();
  });
});
