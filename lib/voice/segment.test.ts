import { describe, expect, it } from "vitest";
import { feed, flush, initSegmenter, isBoundary, type SegmentState } from "./segment";

/** Feed a whole string in n-character chunks, as a stream would arrive. */
function stream(text: string, chunkSize = 7): string[] {
  let state: SegmentState = initSegmenter();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    const r = feed(state, text.slice(i, i + chunkSize));
    state = r.state;
    out.push(...r.segments);
  }
  out.push(...flush(state).segments);
  return out;
}

describe("isBoundary", () => {
  it("finds the end of a sentence", () => {
    const s = "This is one. And two.";
    expect(isBoundary(s, s.indexOf(". And"))).toBe(true);
  });

  it("does not cut a decimal in half", () => {
    const s = "It costs $1.25 per million.";
    expect(isBoundary(s, s.indexOf(".25"))).toBe(false);
  });

  it("does not cut a URL or a version", () => {
    const s = "See example.com for v1.2 details.";
    expect(isBoundary(s, s.indexOf(".com"))).toBe(false);
    expect(isBoundary(s, s.indexOf(".2"))).toBe(false);
  });

  it("does not cut an abbreviation", () => {
    const s = "Cheap models, e.g. the small ones.";
    expect(isBoundary(s, s.indexOf("g.") + 1)).toBe(false);
  });

  it("only counts sentence punctuation", () => {
    const s = "a, b; c";
    expect(isBoundary(s, 1)).toBe(false);
  });
});

describe("feed", () => {
  it("emits sentence by sentence as a stream arrives", () => {
    const out = stream(
      "Summit Pro is the strongest here. It scores 91.3 on MMLU. Meridian is cheaper.",
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("Summit Pro is the strongest here.");
    expect(out[1]).toContain("91.3");
  });

  it("does not speak half of a price", () => {
    for (const piece of stream("It is $1.25 per million tokens, which is cheap for the class.")) {
      expect(piece).not.toMatch(/\$1\.$/);
    }
  });

  it("never emits inside a code fence", () => {
    const out = stream("Here it is.\n```js\nconst a = 1. Not a sentence.\n```\nThat is all.");
    expect(out[0]).toBe("Here it is.");
    // The fence and everything in it arrives as one piece, for speech-plan to
    // replace wholesale.
    expect(out.some((p) => p.includes("const a = 1"))).toBe(true);
  });

  it("does not stall on a very long sentence with no full stop", () => {
    const long = `${"a long clause, ".repeat(30)}and then it ends.`;
    const out = stream(long);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].length).toBeLessThanOrEqual(260);
  });

  it("does not emit a clipped fragment", () => {
    const out = stream("Yes. No. Absolutely certain about that one.");
    // "Yes." alone is under the floor, so it rides along with what follows.
    expect(out[0].length).toBeGreaterThanOrEqual(10);
  });

  it("flushes whatever is left when the answer ends", () => {
    let state = initSegmenter();
    state = feed(state, "No terminator here").state;
    expect(flush(state).segments).toEqual(["No terminator here"]);
  });

  it("flushing an empty buffer emits nothing", () => {
    expect(flush(initSegmenter()).segments).toEqual([]);
  });

  it("is chunk-size independent - the same text splits the same way", () => {
    const text = "One sentence here. Another one follows. And a third, finally.";
    expect(stream(text, 1)).toEqual(stream(text, 200));
  });

  it("handles an empty stream", () => {
    expect(stream("")).toEqual([]);
  });
});
