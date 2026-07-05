import { describe, it, expect } from "vitest";
import { measureHealth, shouldSuggestSummarize, buildContinuationSummary } from "./health";
import type { ChatMessage } from "./types";

function msg(role: "user" | "assistant", content: string, extras?: Partial<ChatMessage>): ChatMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now(), ...extras };
}

describe("measureHealth", () => {
  it("reports ok for short conversations", () => {
    const messages = [msg("user", "hi"), msg("assistant", "hello")];
    const h = measureHealth(messages, "some-model");
    expect(h.status).toBe("ok");
    expect(h.usage).toBeLessThan(0.01);
  });

  it("reports warning when usage crosses 60%", () => {
    const longText = "x".repeat(80_000 * 4);
    const messages = [msg("user", longText)];
    const h = measureHealth(messages, "some-model");
    expect(h.status).toBe("warning");
  });

  it("reports critical when usage crosses 80%", () => {
    const longText = "x".repeat(110_000 * 4);
    const messages = [msg("user", longText)];
    const h = measureHealth(messages, "some-model");
    expect(h.status).toBe("critical");
  });
});

describe("shouldSuggestSummarize", () => {
  it("suggests summarize at 60%+ usage", () => {
    expect(shouldSuggestSummarize({ estimatedTokens: 80_000, contextWindow: 128_000, usage: 0.625, status: "warning" })).toBe(true);
  });

  it("does not suggest at low usage", () => {
    expect(shouldSuggestSummarize({ estimatedTokens: 1000, contextWindow: 128_000, usage: 0.008, status: "ok" })).toBe(false);
  });
});

describe("buildContinuationSummary", () => {
  it("includes pinned messages verbatim", () => {
    const messages = [
      msg("user", "Important context", { pinned: true }),
      msg("assistant", "Noted"),
      msg("user", "Follow up"),
      msg("assistant", "Sure"),
    ];
    const summary = buildContinuationSummary(messages);
    expect(summary).toContain("Important context");
    expect(summary).toContain("Pinned context");
  });

  it("includes recent messages", () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", `Message ${i}`),
    );
    const summary = buildContinuationSummary(messages);
    expect(summary).toContain("Message 9");
    expect(summary).toContain("Recent messages");
  });

  it("returns non-empty string for minimal input", () => {
    const messages = [msg("user", "hi")];
    const summary = buildContinuationSummary(messages);
    expect(summary.length).toBeGreaterThan(0);
  });
});
