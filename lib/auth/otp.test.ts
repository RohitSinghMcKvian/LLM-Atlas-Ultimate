import { describe, expect, it } from "vitest";
import {
  OTP_LENGTH,
  applyBackspace,
  applyTyped,
  cursorFor,
  isComplete,
  parsePasted,
  sanitizeCode,
} from "./otp";

describe("sanitizeCode", () => {
  it("keeps digits only", () => {
    expect(sanitizeCode("12ab34")).toBe("1234");
    expect(sanitizeCode("1-2 3")).toBe("123");
    expect(sanitizeCode("abc")).toBe("");
  });

  it("caps at the code length", () => {
    expect(sanitizeCode("1234567890")).toBe("123456");
    expect(sanitizeCode("123456789", 4)).toBe("1234");
  });
});

describe("cursorFor", () => {
  it("points at the first empty box", () => {
    expect(cursorFor("")).toBe(0);
    expect(cursorFor("12")).toBe(2);
  });

  it("stops at the last box once full", () => {
    expect(cursorFor("123456")).toBe(OTP_LENGTH - 1);
  });
});

describe("applyTyped", () => {
  it("appends at the end", () => {
    expect(applyTyped("12", 2, "3")).toEqual({ value: "123", cursor: 3 });
  });

  it("replaces in place without shifting later digits", () => {
    // The bug a fixed-length array + join would introduce: overwriting box 1
    // must not pull "3456" left a slot.
    expect(applyTyped("123456", 1, "9")).toEqual({ value: "193456", cursor: 2 });
  });

  it("appends when the clicked box is past the end", () => {
    // Two digits entered, box 5 clicked — the third digit goes in box 3, since
    // a compact value cannot hold a gap.
    expect(applyTyped("12", 5, "7")).toEqual({ value: "127", cursor: 3 });
  });

  it("ignores non-digits", () => {
    expect(applyTyped("12", 2, "a")).toEqual({ value: "12", cursor: 2 });
  });

  it("absorbs a multi-digit burst from one keystroke", () => {
    expect(applyTyped("", 0, "4821")).toEqual({ value: "4821", cursor: 4 });
  });

  it("never exceeds the code length", () => {
    const { value, cursor } = applyTyped("123456", 6, "7");
    expect(value).toHaveLength(OTP_LENGTH);
    expect(cursor).toBeLessThanOrEqual(OTP_LENGTH);
  });
});

describe("applyBackspace", () => {
  it("drops the last digit when sitting past the end", () => {
    expect(applyBackspace("123", 3)).toEqual({ value: "12", cursor: 2 });
  });

  it("removes in place and closes the gap on a filled box", () => {
    expect(applyBackspace("123456", 2)).toEqual({ value: "12456", cursor: 2 });
  });

  it("is a no-op on an empty code", () => {
    expect(applyBackspace("", 0)).toEqual({ value: "", cursor: 0 });
    expect(applyBackspace("", 4)).toEqual({ value: "", cursor: 0 });
  });

  it("clears the whole code one box at a time when held", () => {
    let state = { value: "159260", cursor: 5 };
    for (let i = 0; i < OTP_LENGTH; i++) {
      state = applyBackspace(state.value, state.value.length);
    }
    expect(state.value).toBe("");
  });

  it("keeps the value compact through mixed editing", () => {
    // Delete from the middle, then type — the result must still have no holes.
    const cleared = applyBackspace("482913", 1);
    expect(cleared.value).toBe("42913");
    const retyped = applyTyped(cleared.value, cleared.cursor, "7");
    expect(retyped.value).toBe("47913");
    expect(retyped.value).toHaveLength(5);
  });
});

describe("parsePasted", () => {
  it("accepts a bare code", () => {
    expect(parsePasted("482913")).toBe("482913");
  });

  it("strips the formatting people actually paste", () => {
    expect(parsePasted("482-913")).toBe("482913");
    expect(parsePasted(" 482 913 ")).toBe("482913");
  });

  it("pulls the code out of a sentence lifted from the email", () => {
    expect(parsePasted("Your code is 482913")).toBe("482913");
  });

  it("returns empty for a clipboard with no digits", () => {
    expect(parsePasted("no code here")).toBe("");
  });
});

describe("isComplete", () => {
  it("is true only at full length", () => {
    expect(isComplete("12345")).toBe(false);
    expect(isComplete("123456")).toBe(true);
  });
});
