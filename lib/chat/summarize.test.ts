import { describe, it, expect } from "vitest";
import {
  ASSISTANT_CLIP,
  buildSummaryRequest,
  FOLD_HEADINGS,
  INPUT_MAX,
  parseFoldSummary,
  renderFoldSummary,
  SUMMARY_HARD_MAX,
  USER_CLIP,
} from "./summarize";
import type { ChatMessage } from "./types";

let n = 0;
const msg = (role: "user" | "assistant", content: string): ChatMessage => ({
  id: `m${n++}`,
  role,
  content,
  parentId: null,
  createdAt: 1000,
});

const good = [
  "## Decisions",
  "- Chose Postgres over SQLite for the multi-writer case.",
  "## Constraints",
  "- Must run offline. Budget $40/month.",
  "## Produced",
  "- /workspace/schema.sql",
  "## Open",
  "- Migration rollback story.",
  "## Rejected",
  "- Firebase: the user has a hard self-hosting requirement.",
].join("\n");

describe("buildSummaryRequest", () => {
  it("returns null when there is nothing to summarise", () => {
    expect(buildSummaryRequest([])).toBeNull();
    expect(buildSummaryRequest([msg("user", "   ")])).toBeNull();
  });

  it("asks for the five headings by name", () => {
    const req = buildSummaryRequest([msg("user", "hello there")])!;
    for (const h of FOLD_HEADINGS) expect(req.system).toContain(h);
  });

  // A chat model handed a chat transcript wants to reply to it. This is the one
  // instruction the whole feature depends on.
  it("tells the model not to answer the conversation", () => {
    const req = buildSummaryRequest([msg("user", "what is 2+2?")])!;
    expect(req.system.toLowerCase()).toContain("do not answer");
  });

  it("labels who said what", () => {
    const req = buildSummaryRequest([msg("user", "I want dark mode"), msg("assistant", "Done")])!;
    expect(req.user).toContain("User: I want dark mode");
    expect(req.user).toContain("Atlas: Done");
  });

  // The user states a requirement in a sentence; the assistant spends four
  // paragraphs on it. Clipping both at the same point loses the reasoning.
  it("gives assistant turns more room than user turns", () => {
    const req = buildSummaryRequest([
      msg("user", "u".repeat(5000)),
      msg("assistant", "a".repeat(5000)),
    ])!;
    expect(req.user).toContain("u".repeat(USER_CLIP));
    expect(req.user).not.toContain("u".repeat(USER_CLIP + 1));
    expect(req.user).toContain("a".repeat(ASSISTANT_CLIP));
    expect(req.user).not.toContain("a".repeat(ASSISTANT_CLIP + 1));
  });

  it("head-and-tails an over-long transcript rather than truncating it", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      msg(i % 2 ? "assistant" : "user", `turn ${i} ` + "x".repeat(1000)),
    );
    const req = buildSummaryRequest(many)!;
    expect(req.user.length).toBeLessThanOrEqual(INPUT_MAX + 200);
    expect(req.user).toContain("turn 0");
    expect(req.user).toContain("turn 59");
    expect(req.user).toContain("omitted");
  });

  it("reports what the summary would replace, so the parser has a budget", () => {
    const req = buildSummaryRequest([msg("user", "x".repeat(300))])!;
    expect(req.replacedChars).toBe(300);
  });
});

describe("parseFoldSummary", () => {
  it("accepts a summary with the headings", () => {
    const out = parseFoldSummary(good, 10_000);
    expect(out).toEqual({ ok: true, body: good });
  });

  it("accepts a partial set of headings", () => {
    const out = parseFoldSummary("## Decisions\n- one\n## Open\n- none", 10_000);
    expect(out.ok).toBe(true);
  });

  it("rejects an empty reply", () => {
    expect(parseFoldSummary("   ", 10_000)).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a refusal, using the same sentinel as plan mode", () => {
    expect(parseFoldSummary("NO PLAN", 10_000)).toEqual({ ok: false, reason: "declined" });
  });

  /**
   * The failure this whole shape exists to catch: asked to summarise a
   * conversation, the model answers it instead. The output is fluent and
   * confident and completely wrong for this slot, and without fixed headings
   * there is nothing to test it against.
   */
  it("rejects an answer to the conversation", () => {
    const answered =
      "Sure! Based on what you described, I'd suggest starting with Postgres and " +
      "adding a migration tool. Let me know if you want the schema.";
    expect(parseFoldSummary(answered, 10_000)).toEqual({ ok: false, reason: "headingless" });
  });

  it("rejects output longer than what it replaces", () => {
    expect(parseFoldSummary(good, 50)).toEqual({ ok: false, reason: "too-long" });
  });

  it("rejects a runaway even when it replaced a great deal", () => {
    const runaway = `## Decisions\n${"- x\n".repeat(3000)}`;
    expect(runaway.length).toBeGreaterThan(SUMMARY_HARD_MAX);
    expect(parseFoldSummary(runaway, 1_000_000)).toEqual({ ok: false, reason: "too-long" });
  });

  it("tolerates a different heading depth", () => {
    expect(parseFoldSummary("### Decisions\n- one", 10_000).ok).toBe(true);
  });
});

describe("renderFoldSummary", () => {
  const at = Date.UTC(2026, 0, 15);

  it("names the model and the date, and admits it may be incomplete", () => {
    const out = renderFoldSummary(good, { foldedCount: 24, model: "gpt-x", at });
    expect(out).toContain("24 earlier turns");
    expect(out).toContain("gpt-x");
    expect(out).toContain("2026-01-15");
    expect(out).toContain("may be incomplete");
    expect(out).toContain(good);
  });

  // Without this the model that notices a gap has no move except to guess.
  it("points at recall_context when the index exists", () => {
    const out = renderFoldSummary(good, { foldedCount: 3, model: "m", at, recallable: true });
    expect(out).toContain("recall_context");
  });

  it("does not offer a tool that would return nothing", () => {
    const out = renderFoldSummary(good, { foldedCount: 3, model: "m", at, recallable: false });
    expect(out).not.toContain("recall_context");
    expect(out).toContain("do not claim to remember");
  });
});
