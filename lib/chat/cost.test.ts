import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeModel, makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import { formatUsd, messageCostUsd, sessionCostUsd } from "./cost";
import type { ChatMessage } from "./types";

// Turn pricing, with the image-output rate that P13 added.
//
// The bug worth pinning: image tokens are reported *inside* `completion_tokens`,
// so charging both the completion total at the text rate and the image count at
// the image rate bills those tokens twice. Every case below fixes the split.

/** Text-only. $1/M in, $2/M out. */
const plain = makeModel({
  id: "plain",
  pricing: { inputPerM: 1, outputPerM: 2, effectiveFrom: "2026-01-01" },
});

/** Draws. $2/M in, $10/M text out, $30/M image out — the Gemini Flash Image shape. */
const drawer = makeModel({
  id: "drawer",
  outputModalities: ["text", "image"],
  pricing: {
    inputPerM: 2,
    outputPerM: 10,
    imageOutputPerM: 30,
    effectiveFrom: "2026-01-01",
  },
});

/** Emits images but the provider published no image rate. */
const unpriced = makeModel({
  id: "unpriced",
  outputModalities: ["text", "image"],
  pricing: { inputPerM: 2, outputPerM: 10, effectiveFrom: "2026-01-01" },
});

beforeEach(() => {
  resetSnapshot();
  installSnapshot(makeSnapshot([plain, drawer, unpriced]));
});

afterEach(() => resetSnapshot());

describe("messageCostUsd", () => {
  it("prices a text turn from the token rates", () => {
    // 1M in at $1 + 0.5M out at $2.
    expect(messageCostUsd("plain", 1_000_000, 500_000)).toBeCloseTo(2, 10);
  });

  it("returns 0 for an unknown model", () => {
    expect(messageCostUsd("no-such-model", 1_000_000, 1_000_000)).toBe(0);
  });

  it("ignores an image count on a model with no image rate", () => {
    // Falls back to the text rate, so the total matches the no-image case
    // rather than dropping the tokens or inventing a price for them.
    const withImages = messageCostUsd("unpriced", 0, 100_000, 40_000);
    const without = messageCostUsd("unpriced", 0, 100_000);
    expect(withImages).toBeCloseTo(without, 10);
  });

  it("charges image tokens at the image rate and the rest at the text rate", () => {
    // 100k completion tokens, 40k of them image: 60k at $10/M + 40k at $30/M.
    expect(messageCostUsd("drawer", 0, 100_000, 40_000)).toBeCloseTo(
      0.6 + 1.2,
      10,
    );
  });

  it("does not double-charge the image tokens", () => {
    const priced = messageCostUsd("drawer", 0, 100_000, 40_000);
    // What a naive implementation would produce: the whole completion at the
    // text rate, plus the image tokens again at the image rate.
    const doubled = 100_000 / 1e6 * 10 + 40_000 / 1e6 * 30;
    expect(priced).toBeLessThan(doubled);
  });

  it("costs more than the same turn priced as plain text", () => {
    expect(messageCostUsd("drawer", 0, 100_000, 40_000)).toBeGreaterThan(
      messageCostUsd("drawer", 0, 100_000),
    );
  });

  it("clamps an image count that exceeds the completion total", () => {
    // A provider reporting them as an addition rather than a subset must not
    // drive the text portion negative.
    const all = messageCostUsd("drawer", 0, 10_000, 999_999);
    expect(all).toBeCloseTo(10_000 / 1e6 * 30, 10);
  });

  it("ignores a negative image count", () => {
    expect(messageCostUsd("drawer", 0, 10_000, -5_000)).toBeCloseTo(
      messageCostUsd("drawer", 0, 10_000),
      10,
    );
  });

  it("treats an absent image count as plain text", () => {
    expect(messageCostUsd("drawer", 1_000_000, 1_000_000)).toBeCloseTo(12, 10);
  });
});

describe("sessionCostUsd", () => {
  const msg = (over: Partial<ChatMessage>): ChatMessage => ({
    id: over.id ?? "m",
    role: "assistant",
    content: "",
    createdAt: 0,
    ...over,
  });

  it("sums assistant turns and skips user turns", () => {
    const total = sessionCostUsd([
      msg({ id: "u", role: "user", content: "hi" }),
      msg({ id: "a", model: "plain", promptTokens: 1_000_000, completionTokens: 0 }),
    ]);
    expect(total).toBeCloseTo(1, 10);
  });

  it("carries the image split into the session total", () => {
    const total = sessionCostUsd([
      msg({
        id: "a",
        model: "drawer",
        promptTokens: 0,
        completionTokens: 100_000,
        imageTokens: 40_000,
      }),
    ]);
    expect(total).toBeCloseTo(1.8, 10);
  });

  it("prefers a recorded costUsd over recomputing", () => {
    // The stored number is what the user was actually charged; recomputing
    // would silently restate it at today's catalog price.
    const total = sessionCostUsd([
      msg({ id: "a", model: "drawer", completionTokens: 100_000, costUsd: 0.42 }),
    ]);
    expect(total).toBe(0.42);
  });
});

describe("formatUsd", () => {
  it("widens precision for tiny amounts", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.0001234)).toBe("$0.0001");
    expect(formatUsd(0.5)).toBe("$0.500");
    expect(formatUsd(12.345)).toBe("$12.35");
  });
});
