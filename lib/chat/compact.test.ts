import { describe, it, expect } from "vitest";
import {
  KEEP_RECENT,
  foldedSummary,
  foldFingerprint,
  hasFoldedContext,
  MIN_TO_COMPACT,
  ancestorsOf,
  applyFold,
  planCompaction,
  shouldAutoCompact,
  type FoldSummary,
} from "./compact";
import { activePath, treeFromList } from "./tree";
import type { ChatMessage } from "./types";

/** A linear thread of `n` alternating turns, each with a parent link. */
function thread(n: number, text = (i: number) => `message ${i}`): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: text(i),
      parentId: i === 0 ? null : `m${i - 1}`,
      createdAt: 1000 + i,
    });
  }
  return out;
}

describe("planCompaction", () => {
  it("does nothing to a short thread", () => {
    expect(planCompaction(thread(MIN_TO_COMPACT - 1))).toBeNull();
  });

  it("folds everything except the recent tail", () => {
    const msgs = thread(20);
    const plan = planCompaction(msgs)!;
    expect(plan.foldedCount).toBe(20 - KEEP_RECENT);
    expect(plan.foldIds).toEqual(msgs.slice(0, -KEEP_RECENT).map((m) => m.id));
    // The tail is untouched.
    for (const m of msgs.slice(-KEEP_RECENT)) {
      expect(plan.foldIds).not.toContain(m.id);
    }
  });

  // Pinning exists precisely so something survives this.
  it("never folds a pinned message", () => {
    const msgs = thread(20);
    msgs[2].pinned = true;
    const plan = planCompaction(msgs)!;
    expect(plan.foldIds).not.toContain("m2");
  });

  // Otherwise a second compaction summarises the first summary into mush.
  it("does not re-fold what is already folded", () => {
    const msgs = thread(20);
    for (const m of msgs.slice(0, 6)) m.folded = true;
    const plan = planCompaction(msgs)!;
    for (const id of ["m0", "m1", "m2", "m3", "m4", "m5"]) {
      expect(plan.foldIds).not.toContain(id);
    }
    expect(plan.foldedCount).toBe(20 - KEEP_RECENT - 6);
  });

  it("returns null when everything foldable is already folded", () => {
    const msgs = thread(20);
    for (const m of msgs.slice(0, -KEEP_RECENT)) m.folded = true;
    expect(planCompaction(msgs)).toBeNull();
  });

  it("says how many turns it folded, so the user can see what happened", () => {
    const summary = foldedSummary(foldAll(thread(20)));
    expect(summary).toContain("12 earlier messages");
    expect(summary).toContain("workspace");
  });

  it("keeps the summary bounded on a very long thread", () => {
    const summary = foldedSummary(foldAll(thread(400, () => "x".repeat(2000))));
    expect(summary.length).toBeLessThanOrEqual(4100);
  });
});

/** Apply a plan, so tests exercise the same transition the client performs. */
function foldAll(msgs: ChatMessage[]): ChatMessage[] {
  const plan = planCompaction(msgs);
  if (!plan) return msgs;
  return msgs.map((m) => (plan.foldIds.includes(m.id) ? { ...m, folded: true } : m));
}

describe("foldedSummary", () => {
  it("is empty when nothing is folded", () => {
    expect(foldedSummary(thread(20))).toBe("");
  });

  // The reason it is derived rather than stored: a reload must not turn a fold
  // into silent amnesia.
  it("is recomputed from the messages alone, so it survives a reload", () => {
    const folded = foldAll(thread(20));
    const reloaded = folded.map((m) => ({ ...m })); // as if read back from storage
    expect(foldedSummary(reloaded)).toBe(foldedSummary(folded));
    expect(foldedSummary(reloaded)).toContain("message 0");
  });
});

describe("applyFold", () => {
  it("replaces the folded run with one summary, in its place", () => {
    const msgs = thread(20);
    const plan = planCompaction(msgs)!;
    const folded = msgs.map((m) =>
      plan.foldIds.includes(m.id) ? { ...m, folded: true } : m,
    );
    const sent = applyFold(folded);

    expect(sent).toHaveLength(KEEP_RECENT + 1);
    expect(sent[0].content).toBe(foldedSummary(folded));
    expect(sent.slice(1).map((m) => m.id)).toEqual(msgs.slice(-KEEP_RECENT).map((m) => m.id));
  });

  it("injects the summary only once", () => {
    const msgs = thread(20).map((m, i) => (i < 12 ? { ...m, folded: true } : m));
    const sent = applyFold(msgs);
    expect(sent.filter((m) => m.content.startsWith("[12 earlier messages"))).toHaveLength(1);
    expect(sent).toHaveLength(9); // 8 kept turns + the one summary
  });

  it("keeps a pinned message verbatim between the summary and the tail", () => {
    const msgs = thread(20);
    msgs[2].pinned = true;
    const plan = planCompaction(msgs)!;
    const folded = msgs.map((m) =>
      plan.foldIds.includes(m.id) ? { ...m, folded: true } : m,
    );
    const sent = applyFold(folded);
    expect(sent.map((m) => m.id)).toContain("m2");
    expect(sent.find((m) => m.id === "m2")!.content).toBe("message 2");
  });

  it("is a no-op when nothing is folded", () => {
    const msgs = thread(6);
    expect(applyFold(msgs)).toEqual(msgs);
  });
});

describe("shouldAutoCompact", () => {
  it("holds off below the critical threshold", () => {
    expect(shouldAutoCompact(0.79, thread(40))).toBe(false);
  });

  it("fires at the critical threshold", () => {
    expect(shouldAutoCompact(0.8, thread(40))).toBe(true);
  });

  it("does not fire when there is nothing left to fold", () => {
    const msgs = thread(40).map((m, i) => (i < 40 - KEEP_RECENT ? { ...m, folded: true } : m));
    expect(shouldAutoCompact(0.95, msgs)).toBe(false);
  });

  it("does not fire on a short thread however full the window is", () => {
    expect(shouldAutoCompact(0.99, thread(4))).toBe(false);
  });
});

/**
 * R6: folding must not disturb the message tree.
 *
 * `folded` is an inclusion flag. If it ever became a tree edit, branching would
 * break in ways that are hard to notice — a sibling stepper showing the wrong
 * count, or an active leaf pointing at a message no longer on the path.
 */
describe("folding and the message tree", () => {
  it("leaves activePath identical", () => {
    const msgs = thread(20);
    const before = activePath(treeFromList(msgs));

    const plan = planCompaction(msgs)!;
    const folded = msgs.map((m) =>
      plan.foldIds.includes(m.id) ? { ...m, folded: true } : m,
    );
    const after = activePath(treeFromList(folded));

    expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
  });

  it("leaves parent links untouched", () => {
    const msgs = thread(20);
    const plan = planCompaction(msgs)!;
    const folded = msgs.map((m) =>
      plan.foldIds.includes(m.id) ? { ...m, folded: true } : m,
    );
    for (let i = 1; i < folded.length; i++) {
      expect(folded[i].parentId).toBe(`m${i - 1}`);
    }
  });
});

describe("ancestorsOf", () => {
  it("walks to the root", () => {
    expect(ancestorsOf(thread(5), "m4")).toEqual(["m4", "m3", "m2", "m1", "m0"]);
  });

  it("is just the message itself for a root", () => {
    expect(ancestorsOf(thread(5), "m0")).toEqual(["m0"]);
  });

  it("returns nothing for an unknown id", () => {
    expect(ancestorsOf(thread(5), "nope")).toEqual([]);
  });

  // A cycle cannot happen through the store, but a corrupted import could
  // produce one and an unguarded walk would hang the tab.
  it("terminates on a self-referencing message", () => {
    const msgs: ChatMessage[] = [
      { id: "a", role: "user", content: "x", parentId: "a", createdAt: 1 },
    ];
    expect(() => ancestorsOf(msgs, "a")).not.toThrow();
  });
});

describe("foldFingerprint", () => {
  const foldAll = (msgs: ChatMessage[]) => msgs.map((m) => ({ ...m, folded: true }));

  it("is empty when nothing is folded, so no-fold can't collide with a fold", () => {
    expect(foldFingerprint(thread(20))).toBe("");
  });

  it("is stable across a reload", () => {
    const folded = foldAll(thread(20));
    const reloaded = JSON.parse(JSON.stringify(folded)) as ChatMessage[];
    expect(foldFingerprint(reloaded)).toBe(foldFingerprint(folded));
  });

  it("changes when another turn is folded", () => {
    const msgs = thread(20);
    const some = msgs.map((m, i) => (i < 8 ? { ...m, folded: true } : m));
    const more = msgs.map((m, i) => (i < 12 ? { ...m, folded: true } : m));
    expect(foldFingerprint(more)).not.toBe(foldFingerprint(some));
  });

  it("changes when a folded turn is edited", () => {
    const before = foldAll(thread(20));
    const after = before.map((m, i) => (i === 3 ? { ...m, content: `${m.content} more` } : m));
    expect(foldFingerprint(after)).not.toBe(foldFingerprint(before));
  });
});

describe("hasFoldedContext", () => {
  it("gates the recall tool on there being something to recall", () => {
    expect(hasFoldedContext(thread(20))).toBe(false);
    const folded = thread(20).map((m, i) => (i < 4 ? { ...m, folded: true } : m));
    expect(hasFoldedContext(folded)).toBe(true);
  });
});

describe("applyFold — the stored summary", () => {
  const folded = () => thread(20).map((m, i) => (i < 12 ? { ...m, folded: true } : m));
  const stored = (msgs: ChatMessage[], over: Partial<FoldSummary> = {}): FoldSummary => ({
    conversationId: "c1",
    fingerprint: foldFingerprint(msgs),
    text: "[written by a model]\n\n## Decisions\n- the good one",
    model: "gpt-x",
    createdAt: 1,
    foldedCount: 12,
    ...over,
  });

  it("prefers the model's summary over the mechanical excerpt", () => {
    const msgs = folded();
    const sent = applyFold(msgs, stored(msgs));
    expect(sent[0].content).toContain("the good one");
    expect(sent[0].content).not.toContain("mechanical excerpt");
  });

  /**
   * The dangerous case. A summary of a *different* set of turns reads as
   * authoritative while describing a conversation that has since moved on, and
   * the model has no way to tell. The derived excerpt is worse prose and always
   * true of the messages in hand.
   */
  it("ignores a summary written for a different fold", () => {
    const msgs = folded();
    const sent = applyFold(msgs, stored(msgs, { fingerprint: "stale" }));
    expect(sent[0].content).not.toContain("the good one");
    expect(sent[0].content).toBe(foldedSummary(msgs));
  });

  it("falls back when there is no summary, or an empty one", () => {
    const msgs = folded();
    expect(applyFold(msgs, null)[0].content).toBe(foldedSummary(msgs));
    expect(applyFold(msgs, stored(msgs, { text: "   " }))[0].content).toBe(foldedSummary(msgs));
  });

  it("does not inject anything into a thread with no fold", () => {
    const msgs = thread(20);
    expect(applyFold(msgs, stored(msgs, { fingerprint: "" }))).toEqual(msgs);
  });

  it("puts the summary where the folded turns were, either way", () => {
    const msgs = folded();
    for (const s of [null, stored(msgs)]) {
      const sent = applyFold(msgs, s);
      expect(sent).toHaveLength(20 - 12 + 1);
      expect(sent[1].id).toBe("m12");
    }
  });
});

// The mechanical excerpt is what a model reads when the summariser is off,
// failed, or was refused. It must not be mistakable for a written summary.
describe("foldedSummary — honesty about what it is", () => {
  it("says outright that it is an excerpt, not a summary", () => {
    const msgs = thread(20).map((m) => ({ ...m, folded: true }));
    const text = foldedSummary(msgs);
    expect(text).toContain("mechanical excerpt");
    expect(text).toContain("not a written summary");
  });
});
