import { describe, it, expect } from "vitest";
import { getModelById } from "@/lib/catalog";
import {
  DEFAULT_TRIM,
  isStub,
  MAX_TOTAL_CHARS,
  transcriptChars,
  trimPolicyFor,
  trimToolTranscript,
  type TrimMessage,
} from "./transcript-trim";
import { measureHealth } from "./health";
import { KEEP_RECENT, keepRecentFor, MAX_KEEP_RECENT, planCompaction } from "./compact";
import { BUILD_LIMITS, limitsFor, MAX_BUILD_ROUNDS, roundsFor } from "./build-budget";
import { outputBudget } from "./continuation";
import { callSignature, isLooping } from "./progress";
import type { ChatMessage } from "./types";

/**
 * Long-context behaviour, measured against a real catalog entry.
 *
 * Every constant in the long-context path was chosen for a 128k window, because
 * that is what `measureHealth` falls back to and what the comments reason about.
 * The catalog now carries models an order of magnitude larger — Nemotron 3 Ultra
 * is 1,000,000 tokens — and an absolute constant that is prudent at 128k is
 * destructive at 1M: it discards context the model had ample room to hold, and
 * the agent then spends rounds re-reading what it already read.
 *
 * These drive the real modules with the real model record, so the numbers are
 * the ones the app produces. Written first as a measurement of the defect, then
 * flipped to assert the fix — the failure chain in "the build dies of it" below
 * is the one this whole file exists for.
 */

const ULTRA = "nemotron-3-ultra-550b";
/** A mid-size model, to check nothing regressed at the size things were tuned for. */
const MID = { contextWindow: 128_000 };

/** A tool round: the assistant's call plus the result it got back. */
function round(n: number, resultChars: number): TrimMessage[] {
  return [
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: `c${n}`,
          type: "function" as const,
          function: {
            name: "workspace",
            arguments: JSON.stringify({ command: "view", path: `/workspace/f${n}.ts` }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: `c${n}`,
      content: `Read /workspace/f${n}.ts\n${"x".repeat(resultChars)}`,
    },
  ];
}

function transcript(rounds: number, size: number): TrimMessage[] {
  const convo: TrimMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "Build the thing" },
  ];
  for (let i = 0; i < rounds; i++) convo.push(...round(i, size));
  return convo;
}

const BOUNDARY = 2;
const ultra = () => getModelById(ULTRA)!;
const survivors = (convo: TrimMessage[]) =>
  convo.filter((m) => m.role === "tool" && !isStub(m.content)).length;

let seq = 0;
const turn = (role: "user" | "assistant", chars: number): ChatMessage => ({
  id: `m${seq++}`,
  role,
  content: "y".repeat(chars),
  parentId: null,
  createdAt: seq,
});

describe("the model this has to work for", () => {
  it("is in the catalog, with the window everything below is measured against", () => {
    const m = ultra();
    expect(m.contextWindow).toBe(1_000_000);
    expect(m.maxOutput).toBe(32_768);
    expect(m.capabilities.toolUse).toBe(true);
  });
});

/**
 * GAP 1 — the transcript trimmer used to discard by age alone.
 *
 * Its first rule fired "regardless of total": any result older than
 * `keepRounds` and longer than `maxResultChars` was stubbed, whatever the window
 * could hold. On a 1M-token model that meant losing every file read more than
 * three rounds old while using around one percent of the context.
 */
describe("GAP 1: the trim budget follows the model's window", () => {
  it("leaves a build alone while it is a rounding error in the window", () => {
    const convo = transcript(8, 8_000);
    const policy = trimPolicyFor(ultra());
    expect(transcriptChars(convo, BOUNDARY)).toBeLessThan(policy.maxTotalChars);

    const trimmed = trimToolTranscript(convo, BOUNDARY, policy);
    // By identity: nothing needed changing, so the caller can skip the copy.
    expect(trimmed).toBe(convo);
  });

  it("keeps every file the agent read, twelve rounds in", () => {
    const convo = transcript(12, 8_000);
    const trimmed = trimToolTranscript(convo, BOUNDARY, trimPolicyFor(ultra()));
    expect(survivors(trimmed)).toBe(12);
    // The same 96k-character build under the flat 60k budget still loses
    // several. Both halves of the fix matter: dropping the age rule stopped the
    // trimmer firing when nothing was under pressure, and the window-derived
    // budget is what makes "under pressure" mean something on a 1M model.
    expect(survivors(trimToolTranscript(convo, BOUNDARY, DEFAULT_TRIM))).toBeLessThan(12);
  });

  it("still trims when the transcript genuinely threatens even a 1M window", () => {
    const policy = trimPolicyFor(ultra());
    const convo = transcript(80, 12_000);
    expect(transcriptChars(convo, BOUNDARY)).toBeGreaterThan(policy.maxTotalChars);
    const trimmed = trimToolTranscript(convo, BOUNDARY, policy);
    expect(transcriptChars(trimmed, BOUNDARY)).toBeLessThanOrEqual(policy.maxTotalChars);
  });

  it("elides the oldest first, so recent work survives longest", () => {
    const policy = trimPolicyFor(ultra());
    const trimmed = trimToolTranscript(transcript(80, 12_000), BOUNDARY, policy);
    const results = trimmed.filter((m) => m.role === "tool");
    const firstKept = results.findIndex((m) => !isStub(m.content));
    expect(firstKept).toBeGreaterThan(0);
    expect(results.slice(firstKept).every((m) => !isStub(m.content))).toBe(true);
  });

  // Money binds before context does past a certain size: the loop re-sends its
  // whole transcript every round, and Nemotron reports no caching.
  it("caps the budget so a large window cannot spend the build on re-transmission", () => {
    expect(trimPolicyFor(ultra()).maxTotalChars).toBe(MAX_TOTAL_CHARS);
  });

  it("never gives a model less than it had before", () => {
    expect(trimPolicyFor(MID).maxTotalChars).toBeGreaterThanOrEqual(DEFAULT_TRIM.maxTotalChars);
    expect(trimPolicyFor(ultra()).maxTotalChars).toBeGreaterThan(DEFAULT_TRIM.maxTotalChars);
  });

  // The floor must never exceed the share itself, or a small model would have
  // trimming effectively disabled — exactly where it is most needed.
  it("does not hand a small model a budget larger than its window", () => {
    const policy = trimPolicyFor({ contextWindow: 8_000 });
    expect(policy.maxTotalChars).toBeLessThan(8_000 * 4);
  });

  it("falls back to the flat policy for a model it knows nothing about", () => {
    expect(trimPolicyFor(null)).toEqual(DEFAULT_TRIM);
    expect(trimPolicyFor({})).toEqual(DEFAULT_TRIM);
  });
});

/**
 * The failure chain this whole file exists for.
 *
 * Trimming by age stubbed a file read at round four. The agent, needing it
 * again, re-read it. `callSignature` is stable, so the third identical read
 * tripped `isLooping`, `BuildBudget` stopped with "looping", and a build that
 * was going well died — on a model using 2% of its context window.
 */
describe("the build used to die of it", () => {
  const read = (path: string) =>
    callSignature({ id: "x", name: "workspace", arguments: JSON.stringify({ command: "view", path }) });

  it("three forced re-reads of one file is a loop stop", () => {
    expect(isLooping([read("/workspace/a.ts"), read("/workspace/a.ts"), read("/workspace/a.ts")])).toBe(
      true,
    );
  });

  it("and the agent no longer has to re-read anything", () => {
    const convo = transcript(12, 8_000);
    const trimmed = trimToolTranscript(convo, BOUNDARY, trimPolicyFor(ultra()));
    // Nothing was elided, so nothing has to be fetched twice, so the loop
    // detector never sees a repeat it caused.
    expect(trimmed.some((m) => isStub(m.content))).toBe(false);
  });
});

/**
 * GAP 2 — the fold threshold scaled with the window but the keep window did not.
 *
 * Unlike a trimmed tool result, a folded turn cannot be re-fetched — only
 * recalled through a lossy index — so keeping too few is the more expensive of
 * the two mistakes.
 */
describe("GAP 2: the keep window follows the model too", () => {
  it("keeps far more of the conversation on a 1M model", () => {
    expect(keepRecentFor(ultra().contextWindow)).toBe(MAX_KEEP_RECENT);
    expect(keepRecentFor(128_000)).toBe(KEEP_RECENT);
  });

  it("never folds more aggressively than it did before", () => {
    for (const w of [1_000, 8_000, 32_000, 128_000, 200_000, 1_000_000]) {
      expect(keepRecentFor(w)).toBeGreaterThanOrEqual(KEEP_RECENT);
    }
    expect(keepRecentFor(undefined)).toBe(KEEP_RECENT);
  });

  it("folds a 200-turn thread down to 48 turns rather than 8", () => {
    const msgs = Array.from({ length: 200 }, (_, i) => turn(i % 2 ? "assistant" : "user", 400));
    const plan = planCompaction(msgs, keepRecentFor(ultra().contextWindow))!;
    expect(plan.foldedCount).toBe(200 - MAX_KEEP_RECENT);
  });

  it("still folds nothing when there is not enough to be worth folding", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => turn(i % 2 ? "assistant" : "user", 400));
    expect(planCompaction(msgs, keepRecentFor(ultra().contextWindow))).toBeNull();
  });

  it("leaves the meter honest on a huge window", () => {
    const msgs = Array.from({ length: 400 }, (_, i) => turn(i % 2 ? "assistant" : "user", 2_000));
    expect(measureHealth(msgs, ULTRA).status).toBe("ok");
  });
});

/**
 * GAP 3 — the round cap did not know the window either.
 *
 * With the window no longer the binding constraint, twenty rounds became the
 * first thing to stop a build that had room to finish.
 */
describe("GAP 3: the round cap follows the model", () => {
  it("gives a 1M model more rounds than a 128k one", () => {
    expect(roundsFor(128_000)).toBe(BUILD_LIMITS.maxRounds);
    expect(roundsFor(ultra().contextWindow)).toBe(MAX_BUILD_ROUNDS);
    expect(roundsFor(ultra().contextWindow)).toBeGreaterThan(roundsFor(128_000));
  });

  it("never gives fewer rounds than before, whatever the window", () => {
    for (const w of [0, 1_000, 8_000, 128_000, 1_000_000]) {
      expect(roundsFor(w)).toBeGreaterThanOrEqual(BUILD_LIMITS.maxRounds);
    }
    expect(roundsFor(undefined)).toBe(BUILD_LIMITS.maxRounds);
  });

  // Rounds cost money whatever the window is. `maxUsd` stays the real ceiling.
  it("is bounded, so only the budget can run away", () => {
    expect(roundsFor(100_000_000)).toBe(MAX_BUILD_ROUNDS);
    expect(limitsFor(true).maxUsd).toBe(2);
  });

  it("uses the model's full output allowance", () => {
    expect(outputBudget(ultra().maxOutput, limitsFor(true).outputCeiling)).toBe(32_768);
  });
});
