import { describe, expect, it } from "vitest";
import { parseIntake } from "./intake";

describe("parseIntake", () => {
  it("parses a clean JSON reply", () => {
    const res = parseIntake(
      '{"classification":"complex","questions":["Which DB?"],"assumptions":["uses npm"]}',
    );
    expect(res).toEqual({
      classification: "complex",
      questions: ["Which DB?"],
      assumptions: ["uses npm"],
    });
  });

  it("extracts JSON out of surrounding prose/fences", () => {
    const res = parseIntake('Sure!\n```json\n{"classification":"trivial","questions":[]}\n```');
    expect(res.classification).toBe("trivial");
  });

  it("caps questions at 3 and drops non-strings", () => {
    const res = parseIntake(
      '{"classification":"bounded","questions":["a","b","c","d",5]}',
    );
    expect(res.questions).toEqual(["a", "b", "c"]);
  });

  it("degrades to bounded/no-questions on garbage", () => {
    expect(parseIntake("I cannot classify this.")).toEqual({
      classification: "bounded",
      questions: [],
      assumptions: [],
    });
    expect(parseIntake('{"classification":"weird"}').classification).toBe("bounded");
  });
});
