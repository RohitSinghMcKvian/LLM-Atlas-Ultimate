import { describe, expect, it } from "vitest";
import {
  NUDGE_DELAY_MS,
  NUDGE_HOLD_MS,
  RAIL_PEEK_PX,
  RAIL_SEEN_KEY,
  markRailSeen,
  railSeen,
  shouldNudge,
} from "./rail";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    read: () => Object.fromEntries(map),
  };
}

function throwingStorage() {
  return {
    getItem: () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  };
}

describe("RAIL_PEEK_PX", () => {
  it("is at least a comfortable touch target", () => {
    // On a touch device the resting sliver is the only thing there is to tap —
    // there is no hover to draw the rail out first. Shrinking this for looks
    // makes the control unusable with a thumb.
    expect(RAIL_PEEK_PX).toBeGreaterThanOrEqual(44);
  });
});

describe("shouldNudge", () => {
  it("plays once for a browser that has not seen the rail", () => {
    expect(shouldNudge(false, false)).toBe(true);
  });

  it("declines once seen, so it cannot become a nag", () => {
    expect(shouldNudge(true, false)).toBe(false);
  });

  it("declines under reduced motion, even on a first visit", () => {
    // The rail is parked open in that case instead: the disclosure still
    // happens, it is just not made of movement.
    expect(shouldNudge(false, true)).toBe(false);
    expect(shouldNudge(true, true)).toBe(false);
  });
});

describe("nudge timing", () => {
  it("lands after the page has settled and holds long enough to read", () => {
    expect(NUDGE_DELAY_MS).toBeGreaterThanOrEqual(600);
    expect(NUDGE_HOLD_MS).toBeGreaterThanOrEqual(900);
  });

  it("is over well inside a short visit", () => {
    expect(NUDGE_DELAY_MS + NUDGE_HOLD_MS).toBeLessThan(5_000);
  });
});

describe("railSeen / markRailSeen", () => {
  it("round-trips through storage", () => {
    const s = fakeStorage();
    expect(railSeen(s)).toBe(false);
    markRailSeen(s);
    expect(railSeen(s)).toBe(true);
    expect(s.read()[RAIL_SEEN_KEY]).toBe("1");
  });

  it("treats any other stored value as not seen", () => {
    expect(railSeen(fakeStorage({ [RAIL_SEEN_KEY]: "yes" }))).toBe(false);
    expect(railSeen(fakeStorage({ [RAIL_SEEN_KEY]: "" }))).toBe(false);
  });

  it("never throws when storage is blocked", () => {
    // Safari private mode and any browser with site data blocked throw on
    // access. A decorative nudge must not be able to take a page down.
    const s = throwingStorage();
    expect(() => railSeen(s)).not.toThrow();
    expect(railSeen(s)).toBe(false);
    expect(() => markRailSeen(s)).not.toThrow();
  });

  it("reports not-seen with no storage at all, as on the server", () => {
    expect(railSeen(undefined)).toBe(false);
    expect(() => markRailSeen(undefined)).not.toThrow();
  });
});
