import { describe, expect, it } from "vitest";
import { CONFIRM_TIMEOUT_MS, confirmQuestion, parseConfirm } from "./confirm";

describe("parseConfirm", () => {
  it.each(["yes", "yeah", "sure", "go ahead", "do it", "okay", "confirm", "yes please"])(
    "reads %s as approval",
    (text) => {
      expect(parseConfirm(text)).toBe("yes");
    },
  );

  it.each(["no", "nope", "cancel", "stop", "never mind", "don't", "no thanks"])(
    "reads %s as refusal",
    (text) => {
      expect(parseConfirm(text)).toBe("no");
    },
  );

  it("takes the leading word when a reason follows it", () => {
    expect(parseConfirm("yes, open it")).toBe("yes");
    expect(parseConfirm("no, leave that alone")).toBe("no");
  });

  it("refuses to guess at anything else", () => {
    // The whole safety property: only a clear yes is a yes.
    for (const text of ["maybe", "what", "hold on", "I think so", "in a minute", "the second one"]) {
      expect(parseConfirm(text)).toBe("unclear");
    }
  });

  it("treats silence as unclear, never as approval", () => {
    expect(parseConfirm("")).toBe("unclear");
    expect(parseConfirm("   ")).toBe("unclear");
  });

  it("does not let a no hiding inside a sentence read as yes", () => {
    expect(parseConfirm("no thank you")).toBe("no");
  });
});

describe("confirmQuestion", () => {
  it("says the action back and asks", () => {
    expect(confirmQuestion("Save that as a prompt called Cost check")).toBe(
      "Save that as a prompt called Cost check. Should I go ahead?",
    );
  });

  it("does not double up punctuation the caller already added", () => {
    expect(confirmQuestion("Open Compare.")).toBe("Open Compare. Should I go ahead?");
  });

  it("still asks something when there is no description", () => {
    expect(confirmQuestion("")).toBe("Should I go ahead?");
  });

  it("always ends in a question", () => {
    for (const d of ["", "do a thing", "Open Compare?"]) {
      expect(confirmQuestion(d).endsWith("?")).toBe(true);
    }
  });
});

describe("timeout", () => {
  it("is long enough to answer and short enough not to strand the turn", () => {
    expect(CONFIRM_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(CONFIRM_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});
