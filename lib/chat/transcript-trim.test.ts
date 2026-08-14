import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRIM,
  isStub,
  stubFor,
  transcriptChars,
  trimToolTranscript,
  type TrimMessage,
} from "./transcript-trim";

/** A round: one assistant tool call plus its result. */
function round(n: number, name: string, resultChars: number): TrimMessage[] {
  const id = `call_${n}`;
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
    },
    {
      role: "tool",
      tool_call_id: id,
      content: `Wrote /workspace/f${n}.html\n${"x".repeat(Math.max(0, resultChars - 30))}`,
    },
  ];
}

/** `boundary` messages of history, then `n` rounds. */
function transcript(n: number, resultChars = 5_000, boundary = 2): TrimMessage[] {
  const head: TrimMessage[] = [
    { role: "system", content: "prompt" },
    { role: "user", content: "build it" },
  ].slice(0, boundary);
  return [...head, ...Array.from({ length: n }, (_, i) => round(i, "workspace", resultChars)).flat()];
}

const BOUNDARY = 2;

describe("trimToolTranscript — safety", () => {
  /**
   * The rule that would break a provider if it were wrong. An orphaned
   * `role:"tool"`, or a `tool_calls` with no matching result, is a 400 from
   * every provider that validates the pairing.
   */
  it("never removes a message and never orphans a tool_call_id", () => {
    for (const rounds of [1, 3, 8, 20]) {
      const convo = transcript(rounds);
      const out = trimToolTranscript(convo, BOUNDARY);
      expect(out).toHaveLength(convo.length);

      const callIds = new Set(
        out.flatMap((m) => (m.tool_calls ?? []).map((c) => c.id)),
      );
      const resultIds = out.filter((m) => m.role === "tool").map((m) => m.tool_call_id!);
      expect(resultIds.every((id) => callIds.has(id)), `${rounds} rounds`).toBe(true);
      expect(new Set(resultIds).size).toBe(callIds.size);
    }
  });

  it("never touches anything before the boundary", () => {
    const convo = transcript(12);
    const out = trimToolTranscript(convo, BOUNDARY);
    for (let i = 0; i < BOUNDARY; i++) expect(out[i]).toBe(convo[i]);
  });

  // The model has not answered the newest round yet; eliding it would elide the
  // very thing it is about to act on.
  it("never stubs the newest round", () => {
    const convo = transcript(12);
    const out = trimToolTranscript(convo, BOUNDARY);
    expect(isStub(out[out.length - 1].content)).toBe(false);
  });

  it("leaves the assistant tool_calls messages untouched", () => {
    const convo = transcript(12);
    const out = trimToolTranscript(convo, BOUNDARY);
    for (let i = 0; i < out.length; i++) {
      if (convo[i].tool_calls) expect(out[i].tool_calls).toEqual(convo[i].tool_calls);
    }
  });
});

describe("trimToolTranscript — behaviour", () => {
  it("does nothing to a short transcript, and returns it by identity", () => {
    const convo = transcript(2);
    expect(trimToolTranscript(convo, BOUNDARY)).toBe(convo);
  });

  it("leaves small results alone however old they are", () => {
    const convo = transcript(20, 100);
    expect(trimToolTranscript(convo, BOUNDARY)).toBe(convo);
  });

  it("brings a long build under the ceiling", () => {
    const convo = transcript(20, 8_000);
    expect(transcriptChars(convo, BOUNDARY)).toBeGreaterThan(DEFAULT_TRIM.maxTotalChars);
    const out = trimToolTranscript(convo, BOUNDARY);
    expect(transcriptChars(out, BOUNDARY)).toBeLessThanOrEqual(DEFAULT_TRIM.maxTotalChars);
  });

  it("keeps the most recent rounds verbatim", () => {
    const convo = transcript(12, 5_000);
    const out = trimToolTranscript(convo, BOUNDARY);
    // The last `keepRounds` results, plus the newest, are untouched.
    const results = out.filter((m) => m.role === "tool");
    const recent = results.slice(-DEFAULT_TRIM.keepRounds);
    expect(recent.every((m) => !isStub(m.content))).toBe(true);
  });

  it("elides the oldest first", () => {
    const convo = transcript(12, 5_000);
    const out = trimToolTranscript(convo, BOUNDARY);
    const results = out.filter((m) => m.role === "tool");
    const firstKept = results.findIndex((m) => !isStub(m.content));
    // Everything before the first kept result is a stub — no gaps.
    expect(results.slice(0, firstKept).every((m) => isStub(m.content))).toBe(true);
  });

  /**
   * What makes applying this in place safe. The loop mutates `convo` rather
   * than copying, so a second pass must not stub a stub or count the saving
   * twice.
   */
  it("is idempotent", () => {
    const convo = transcript(20, 8_000);
    const once = trimToolTranscript(convo, BOUNDARY);
    const twice = trimToolTranscript(once, BOUNDARY);
    expect(twice).toBe(once);
  });

  it("never grows the transcript", () => {
    for (const [rounds, size] of [
      [4, 3_000],
      [12, 5_000],
      [30, 9_000],
    ] as const) {
      const convo = transcript(rounds, size);
      const before = transcriptChars(convo, BOUNDARY);
      const after = transcriptChars(trimToolTranscript(convo, BOUNDARY), BOUNDARY);
      expect(after, `${rounds}×${size}`).toBeLessThanOrEqual(before);
    }
  });

  it("honours a custom policy", () => {
    const convo = transcript(6, 5_000);
    const out = trimToolTranscript(convo, BOUNDARY, {
      keepRounds: 1,
      maxResultChars: 100,
      maxTotalChars: 1_000,
    });
    const results = out.filter((m) => m.role === "tool");
    expect(results.filter((m) => isStub(m.content)).length).toBeGreaterThan(3);
  });

  it("handles a transcript with no tool rounds at all", () => {
    const convo: TrimMessage[] = [
      { role: "system", content: "p" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(trimToolTranscript(convo, BOUNDARY)).toBe(convo);
  });
});

describe("stubFor", () => {
  /**
   * The first line is the outcome for `workspace` and `tasks` — "Created
   * index.html", "Marked step 3 done". Discarding it turns "I already wrote
   * that" into "I have no idea whether I wrote that", and the model rewrites it.
   */
  it("preserves the first line and says how much was elided", () => {
    const stub = stubFor("workspace", "Created index.html\n" + "x".repeat(9_000));
    expect(stub).toContain("Created index.html");
    expect(stub).toContain("workspace");
    expect(stub).toMatch(/\d+ chars/);
    expect(stub).toMatch(/call it again/i);
    expect(isStub(stub)).toBe(true);
  });

  it("is much shorter than what it replaces", () => {
    const long = "line one\n" + "x".repeat(20_000);
    expect(stubFor("run_python", long).length).toBeLessThan(400);
  });

  it("survives an empty or non-string result", () => {
    expect(isStub(stubFor("t", ""))).toBe(true);
    expect(isStub(stubFor("t", undefined))).toBe(true);
  });
});

describe("transcriptChars", () => {
  it("counts content and tool-call arguments from the boundary", () => {
    const convo = transcript(3, 1_000);
    expect(transcriptChars(convo, BOUNDARY)).toBeGreaterThan(3_000);
    expect(transcriptChars(convo, convo.length)).toBe(0);
  });

  it("tolerates non-string content", () => {
    expect(transcriptChars([{ role: "assistant", content: null }])).toBe(0);
    expect(
      transcriptChars([{ role: "user", content: [{ type: "text", text: "hi" }] }]),
    ).toBeGreaterThan(0);
  });
});
