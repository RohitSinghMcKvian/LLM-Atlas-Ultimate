import { describe, it, expect } from "vitest";
import { healSentence, type HealNotice } from "./use-healed-models";

// The sentence a surface prints when the catalog moved under it.
//
// Worth pinning on its own because it is the *whole* user-visible half of the
// repair: the substitution itself is `resolveModelIds`, which is already tested,
// and the thing that was missing before was anyone being told. A silent swap in
// a model comparison is worse than a dead id — the reader keeps reading numbers
// they think came from a model that was never asked.

describe("healSentence", () => {
  const empty: HealNotice = { dropped: [], replaced: [] };

  it("says nothing when nothing changed", () => {
    expect(healSentence(null)).toBeUndefined();
    expect(healSentence(empty)).toBeUndefined();
  });

  it("names both sides of a substitution", () => {
    expect(
      healSentence({ dropped: [], replaced: [{ from: "llama-3-1-8b", to: "Llama 3.3 70B" }] }),
    ).toBe("llama-3-1-8b was retired by its provider — switched to Llama 3.3 70B.");
  });

  it("names a single dropped model rather than counting it", () => {
    expect(healSentence({ dropped: ["kimi-k2-5"], replaced: [] })).toBe(
      "kimi-k2-5 was retired by its provider and removed.",
    );
  });

  it("counts rather than lists once several go at once", () => {
    // A resync that retires eight models must not print eight ids into a chip row.
    expect(healSentence({ dropped: ["a", "b", "c"], replaced: [] })).toBe(
      "3 models were retired by their providers and removed.",
    );
  });

  it("reports substitutions and removals together", () => {
    expect(
      healSentence({
        dropped: ["gone-1", "gone-2"],
        replaced: [{ from: "old", to: "New Model" }],
      }),
    ).toBe(
      "old was retired by its provider — switched to New Model. " +
        "2 models were retired by their providers and removed.",
    );
  });
});
