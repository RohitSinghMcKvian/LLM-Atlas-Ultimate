import { describe, expect, it } from "vitest";
import { gradeText, stripFence } from "./graders";

describe("stripFence", () => {
  it("extracts the first fenced block", () => {
    expect(stripFence('prose\n```json\n{"a":1}\n```\nmore')).toBe('{"a":1}');
  });
  it("returns trimmed input when no fence", () => {
    expect(stripFence("  hello  ")).toBe("hello");
  });
});

describe("gradeText", () => {
  it("exact: full-string match, case-insensitive, trimmed", () => {
    expect(gradeText({ type: "exact", value: "ACKNOWLEDGED" }, "  acknowledged \n")).toBe(true);
    expect(gradeText({ type: "exact", value: "ACKNOWLEDGED" }, "ACKNOWLEDGED!")).toBe(false);
  });

  it("contains: case-insensitive substring (pre-v2 bench behavior)", () => {
    expect(gradeText({ type: "contains", value: "391" }, "The answer is 391.")).toBe(true);
    expect(gradeText({ type: "contains", value: "391" }, "The answer is 392.")).toBe(false);
  });

  it("regex: case-insensitive; invalid pattern fails closed", () => {
    expect(gradeText({ type: "regex", value: "^\\s*ACKNOWLEDGED\\s*$" }, "ACKNOWLEDGED")).toBe(true);
    expect(gradeText({ type: "regex", value: "((" }, "anything")).toBe(false);
  });

  it("json: parses fenced or bare JSON", () => {
    expect(gradeText({ type: "json" }, '```json\n{"name":"Atlas"}\n```')).toBe(true);
    expect(gradeText({ type: "json" }, '["red","green","blue"]')).toBe(true);
    expect(gradeText({ type: "json" }, "not json")).toBe(false);
  });

  it("wordcount: exact word count ignoring punctuation", () => {
    expect(gradeText({ type: "wordcount", value: 3 }, "vast, blue, deep.")).toBe(true);
    expect(gradeText({ type: "wordcount", value: 3 }, "the vast blue deep")).toBe(false);
  });
});
