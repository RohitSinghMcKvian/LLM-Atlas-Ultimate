import { describe, it, expect, vi } from "vitest";
import { runFoldSummary, SUMMARIZE_LIMITS, type SummarizePorts } from "./summarize-run";
import { foldFingerprint, type FoldSummary } from "./compact";
import type { ChatMessage } from "./types";

let n = 0;
const msg = (
  role: "user" | "assistant",
  content: string,
  folded = false,
): ChatMessage => ({
  id: `m${n++}`,
  role,
  content,
  parentId: null,
  createdAt: 1000,
  folded,
});

const thread = () => [
  msg("user", "Build me a budgeting app. It must work offline.", true),
  msg("assistant", "I will use IndexedDB and a service worker.", true),
  msg("user", "And keep it under 200KB.", true),
  msg("assistant", "Understood.", false),
];

const SUMMARY = "## Decisions\n- IndexedDB, offline-first.\n## Constraints\n- Under 200KB.";

function ports(over: Partial<SummarizePorts> = {}) {
  const saved: FoldSummary[] = [];
  const p: SummarizePorts = {
    complete: async () => SUMMARY,
    estimateUsd: () => 0.001,
    save: async (s) => void saved.push(s),
    now: () => Date.UTC(2026, 0, 15),
    ...over,
  };
  return { p, saved };
}

describe("runFoldSummary", () => {
  it("writes a summary pinned to the fold it came from", async () => {
    const msgs = thread();
    const { p, saved } = ports();
    const out = await runFoldSummary({ conversationId: "c1", model: "gpt-x", messages: msgs }, p);

    expect(out.status).toBe("saved");
    expect(saved).toHaveLength(1);
    expect(saved[0].fingerprint).toBe(foldFingerprint(msgs));
    expect(saved[0].foldedCount).toBe(3);
    expect(saved[0].text).toContain("IndexedDB");
    expect(saved[0].text).toContain("gpt-x");
  });

  it("does nothing when nothing is folded", async () => {
    const { p, saved } = ports();
    const out = await runFoldSummary(
      { conversationId: "c1", model: "m", messages: [msg("user", "hi")] },
      p,
    );
    expect(out.status).toBe("skipped");
    expect(saved).toHaveLength(0);
  });

  /**
   * The cap has to be enforceable *before* the call. A ceiling you can only
   * measure afterwards is not a ceiling — and folding fires automatically,
   * without the user asking for anything.
   */
  it("refuses to call an expensive model, and does not call it", async () => {
    const complete = vi.fn(async () => SUMMARY);
    const { p, saved } = ports({ complete, estimateUsd: () => 0.9 });
    const out = await runFoldSummary({ conversationId: "c1", model: "m", messages: thread() }, p);

    expect(out.status).toBe("too-expensive");
    expect(out.estimatedUsd).toBe(0.9);
    expect(complete).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("prices the request it is actually going to send", async () => {
    const estimateUsd = vi.fn(() => 0.001);
    const { p } = ports({ estimateUsd });
    await runFoldSummary({ conversationId: "c1", model: "m", messages: thread() }, p);
    const [inputChars, outputChars] = estimateUsd.mock.calls[0] as unknown as [number, number];
    expect(inputChars).toBeGreaterThan(100);
    expect(outputChars).toBe(SUMMARIZE_LIMITS.maxOutputChars);
  });

  it("keeps the fallback when the model answers instead of summarising", async () => {
    const { p, saved } = ports({ complete: async () => "Sure! Here is your budgeting app." });
    const out = await runFoldSummary({ conversationId: "c1", model: "m", messages: thread() }, p);
    expect(out.status).toBe("rejected");
    expect(out.reason).toBe("headingless");
    expect(saved).toHaveLength(0);
  });

  it("survives a failed call without writing anything", async () => {
    const { p, saved } = ports({
      complete: async () => {
        throw new Error("network");
      },
    });
    const out = await runFoldSummary({ conversationId: "c1", model: "m", messages: thread() }, p);
    expect(out.status).toBe("errored");
    expect(saved).toHaveLength(0);
  });

  it("reports a failed save rather than claiming success", async () => {
    const { p } = ports({
      save: async () => {
        throw new Error("quota");
      },
    });
    const out = await runFoldSummary({ conversationId: "c1", model: "m", messages: thread() }, p);
    expect(out.status).toBe("errored");
  });
});

describe("runFoldSummary — abandoning", () => {
  it("does not start once the user has moved on", async () => {
    const complete = vi.fn(async () => SUMMARY);
    const { p, saved } = ports({ complete, shouldStop: () => true });
    const out = await runFoldSummary({ conversationId: "c1", model: "m", messages: thread() }, p);
    expect(out.status).toBe("aborted");
    expect(complete).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  // A summary takes seconds. Writing one into a conversation the user has since
  // left is the same class of bug as filing an aborted turn's artifacts into
  // whichever conversation happens to be open.
  it("throws away a summary that arrived after the user left", async () => {
    let left = false;
    const { p, saved } = ports({
      complete: async () => {
        left = true;
        return SUMMARY;
      },
      shouldStop: () => left,
    });
    const out = await runFoldSummary({ conversationId: "c1", model: "m", messages: thread() }, p);
    expect(out.status).toBe("aborted");
    expect(saved).toHaveLength(0);
  });
});

describe("runFoldSummary — the recall index", () => {
  it("builds the index before spending anything, and says so in the header", async () => {
    const order: string[] = [];
    const { p, saved } = ports({
      index: async () => {
        order.push("index");
        return 7;
      },
      complete: async () => {
        order.push("complete");
        return SUMMARY;
      },
    });
    const out = await runFoldSummary({ conversationId: "c1", model: "m", messages: thread() }, p);

    expect(order).toEqual(["index", "complete"]);
    expect(out.indexed).toBe(7);
    expect(saved[0].text).toContain("recall_context");
  });

  // The index is local and free, and it matters most in exactly the case where
  // the summary failed — so a failed summary must not take it down with it.
  it("still indexes when the model refuses", async () => {
    const index = vi.fn(async () => 4);
    const { p } = ports({ index, complete: async () => "NO PLAN" });
    const out = await runFoldSummary({ conversationId: "c1", model: "m", messages: thread() }, p);
    expect(out.status).toBe("rejected");
    expect(out.reason).toBe("declined");
    expect(index).toHaveBeenCalled();
  });

  it("still writes the summary when indexing fails", async () => {
    const { p, saved } = ports({
      index: async () => {
        throw new Error("idb");
      },
    });
    const out = await runFoldSummary({ conversationId: "c1", model: "m", messages: thread() }, p);
    expect(out.status).toBe("saved");
    // And does not promise a tool that would come back empty.
    expect(saved[0].text).not.toContain("recall_context");
  });

  it("indexes against the whole thread, so turn numbers mean something", async () => {
    const msgs = thread();
    const index = vi.fn(async () => 3);
    const { p } = ports({ index });
    await runFoldSummary({ conversationId: "c1", model: "m", messages: msgs }, p);
    expect(index).toHaveBeenCalledWith(msgs, foldFingerprint(msgs));
  });
});
