import { describe, expect, it } from "vitest";
import { normalizeSpoken, wordsToNumber } from "./normalize";

describe("wordsToNumber", () => {
  it("reads the shapes people actually say", () => {
    expect(wordsToNumber(["seventy"])).toBe(70);
    expect(wordsToNumber(["seventy", "two"])).toBe(72);
    expect(wordsToNumber(["one", "hundred", "twenty", "eight"])).toBe(128);
    expect(wordsToNumber(["ten", "thousand"])).toBe(10_000);
  });

  it("refuses a descending run, which is a name and a size, not a sum", () => {
    // "Gemma four thirty one" silently became 35 and produced a model that does
    // not exist.
    expect(wordsToNumber(["four", "thirty", "one"])).toBeNull();
    expect(wordsToNumber(["two", "seventy"])).toBeNull();
  });

  it("refuses anything that is not a number", () => {
    expect(wordsToNumber(["banana"])).toBeNull();
    expect(wordsToNumber(["seventy", "banana"])).toBeNull();
    expect(wordsToNumber([])).toBeNull();
  });
});

describe("normalizeSpoken", () => {
  it("writes prices the way the catalog does", () => {
    expect(normalizeSpoken("one point two five dollars per million tokens")).toBe("$1.25/M");
    expect(normalizeSpoken("three dollars per million")).toBe("$3/M");
    expect(normalizeSpoken("fifty cents per million")).toBe("$0.50/M");
    expect(normalizeSpoken("about twenty dollars")).toBe("about $20");
  });

  it("writes sizes and windows", () => {
    expect(normalizeSpoken("a seventy b model")).toBe("a 70B model");
    expect(normalizeSpoken("seventy billion parameters")).toBe("70B");
    expect(normalizeSpoken("one hundred twenty eight k context")).toBe("128k context");
    expect(normalizeSpoken("two million tokens a day")).toBe("2M tokens a day");
  });

  it("writes 'be' as the letter B, which is what a transcriber produces", () => {
    expect(normalizeSpoken("Meridian seventy be")).toBe("Meridian 70B");
  });

  it("writes units", () => {
    expect(normalizeSpoken("ninety tokens per second")).toBe("ninety tok/s");
    expect(normalizeSpoken("four hundred milliseconds")).toBe("four hundred ms");
    expect(normalizeSpoken("88 percent")).toBe("88%");
  });

  it("leaves a bare number alone - only units trigger a rewrite", () => {
    expect(normalizeSpoken("I want three of them")).toBe("I want three of them");
    expect(normalizeSpoken("the first one is better")).toBe("the first one is better");
  });

  it("declines rather than half-rewriting when the quantity will not parse", () => {
    // The rule matches, the number does not: leaving it alone beats emitting a
    // mangled phrase.
    expect(normalizeSpoken("Gemma four thirty one be")).toBe("Gemma four thirty one be");
  });

  it("is idempotent on text that is already written out", () => {
    for (const s of ["$1.25/M", "70B", "128k context", "tok/s", "just some prose"]) {
      expect(normalizeSpoken(s)).toBe(s);
    }
  });

  it("handles an empty transcript", () => {
    expect(normalizeSpoken("")).toBe("");
  });
});
