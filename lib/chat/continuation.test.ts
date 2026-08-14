import { describe, it, expect } from "vitest";
import {
  DEFAULT_OUTPUT_BUDGET,
  MAX_CONTINUATIONS,
  MAX_OUTPUT_BUDGET,
  outputBudget,
  shouldContinue,
  stitch,
} from "./continuation";

describe("outputBudget", () => {
  it("falls back when the catalog has no ceiling for the model", () => {
    expect(outputBudget(undefined)).toBe(DEFAULT_OUTPUT_BUDGET);
    expect(outputBudget(0)).toBe(DEFAULT_OUTPUT_BUDGET);
  });

  it("uses the model's own ceiling when it is the smaller of the two", () => {
    expect(outputBudget(4096)).toBe(4096);
  });

  it("caps a very large ceiling", () => {
    expect(outputBudget(128000)).toBe(MAX_OUTPUT_BUDGET);
  });
});

describe("shouldContinue", () => {
  it("resumes a length-truncated answer up to the cap", () => {
    expect(shouldContinue("length", 0)).toBe(true);
    expect(shouldContinue("length", MAX_CONTINUATIONS - 1)).toBe(true);
    expect(shouldContinue("length", MAX_CONTINUATIONS)).toBe(false);
  });

  it("does not resume anything else", () => {
    for (const reason of ["stop", "tool_calls", "stalled", "content_filter", undefined])
      expect(shouldContinue(reason, 0)).toBe(false);
  });

  it("honours an explicit cap of zero", () => {
    expect(shouldContinue("length", 0, 0)).toBe(false);
  });
});

describe("stitch", () => {
  it("joins mid-token, with no separator inserted", () => {
    expect(stitch('<div cla', 'ss="hero">')).toBe('<div class="hero">');
  });

  it("drops a repeated tail", () => {
    const prev = "line one\nline two\nline three is a fairly long line";
    const next = "line three is a fairly long line\nline four";
    expect(stitch(prev, next)).toBe(`${prev}\nline four`);
  });

  it("drops a re-opened code fence", () => {
    expect(stitch("<p>a</p>\n", "```html\n<p>b</p>")).toBe("<p>a</p>\n<p>b</p>");
    expect(stitch("<p>a</p>\n", "```\n<p>b</p>")).toBe("<p>a</p>\n<p>b</p>");
  });

  it("drops a re-opened fence and a repeated tail together", () => {
    const prev = "<section class=\"pricing\">\n  <h2>Plans</h2>";
    expect(stitch(prev, "```html\n  <h2>Plans</h2>\n</section>")).toBe(`${prev}\n</section>`);
  });

  // A one- or two-character match is a coincidence — every HTML line ends in
  // ">" — and treating it as a repeat would eat real output.
  it("ignores an overlap too short to be a real repeat", () => {
    expect(stitch("<p>a</p>", ">b")).toBe("<p>a</p>>b");
  });

  it("returns the other side when one is empty", () => {
    expect(stitch("abc", "")).toBe("abc");
    expect(stitch("", "abc")).toBe("abc");
  });
});
