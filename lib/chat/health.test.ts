import { describe, it, expect } from "vitest";
import {
  measureHealth,
  messageChars,
  shouldSuggestSummarize,
} from "./health";
import { estimateTokens } from "@/lib/engine/context";
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

  it("returns zero tokens for an empty conversation", () => {
    expect(measureHealth([], "some-model").estimatedTokens).toBe(0);
  });

  // measureHealth computes its token count arithmetically instead of building
  // the joined conversation string (that allocation ran on every chat render).
  // These cases pin the arithmetic to estimateTokens(joined) so the two can
  // never silently diverge — if estimateTokens ever stops being chars/4,
  // this fails instead of the number quietly drifting.
  describe("matches estimateTokens over the joined conversation", () => {
    const cases: Record<string, ChatMessage[]> = {
      empty: [],
      single: [msg("user", "hello world")],
      pair: [msg("user", "hi"), msg("assistant", "hello")],
      "empty contents": [msg("user", ""), msg("assistant", ""), msg("user", "")],
      "mixed lengths": [
        msg("user", "a"),
        msg("assistant", "b".repeat(1234)),
        msg("user", "c".repeat(7)),
        msg("assistant", ""),
      ],
      "multiline content": [
        msg("user", "line one\nline two\nline three"),
        msg("assistant", "reply\nwith\nnewlines"),
      ],
      "non-multiple-of-four lengths": [
        msg("user", "x".repeat(1)),
        msg("assistant", "y".repeat(2)),
        msg("user", "z".repeat(3)),
      ],
    };

    for (const [name, messages] of Object.entries(cases)) {
      it(name, () => {
        const joined = messages.map((m) => m.content).join("\n");
        expect(measureHealth(messages, "some-model").estimatedTokens).toBe(
          estimateTokens(joined),
        );
      });
    }
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

/**
 * What the meter counts, and what it deliberately does not.
 *
 * The rule is "whatever `toRouterMessages` puts in the request" — narrower than
 * a `ChatMessage` carries. Getting this wrong is invisible in both directions:
 * counting too little overflows the window, counting too much folds a
 * conversation that had room left.
 */
describe("what counts toward the window", () => {
  const attach = (over: Partial<{ kind: string; text: string; name: string }>) => ({
    id: "a1",
    name: "notes.txt",
    kind: "text",
    mime: "text/plain",
    size: 10,
    ...over,
  }) as NonNullable<ChatMessage["attachments"]>[number];

  it("counts attachment text, which is inlined into the user turn", () => {
    // A 200KB PDF is 200KB of context. The meter could not see it before.
    const body = "z".repeat(4000);
    const bare = messageChars(msg("user", "hi"));
    const withFile = messageChars(msg("user", "hi", { attachments: [attach({ text: body })] }));
    expect(withFile - bare).toBeGreaterThan(body.length);
  });

  it("ignores an image attachment, whose cost is tiles and not characters", () => {
    const withImage = msg("user", "hi", {
      attachments: [attach({ kind: "image", text: "z".repeat(4000) })],
    });
    expect(messageChars(withImage)).toBe(messageChars(msg("user", "hi")));
  });

  it("ignores reasoning and tool calls, which are never re-sent", () => {
    // An assistant turn goes back as `{ role, content }` alone. Counting the
    // thinking and the tool traffic would inflate every agentic conversation.
    const noisy = msg("assistant", "done", {
      reasoning: "r".repeat(50_000),
      toolCalls: [{ id: "t1", name: "web_search", arguments: "{}", result: "x".repeat(50_000) }],
    });
    expect(messageChars(noisy)).toBe(messageChars(msg("assistant", "done")));
  });

  it("counts the system prompt", () => {
    const messages = [msg("user", "hi")];
    const without = measureHealth(messages, "some-model").estimatedTokens;
    const withSystem = measureHealth(messages, "some-model", 24_000).estimatedTokens;
    expect(withSystem - without).toBe(6_000);
  });

  it("can move a conversation from ok into warning on its own", () => {
    // The point of the change: an 8k model with a full prompt has most of its
    // window already spent before the first message.
    const messages = [msg("user", "x".repeat(2_000))];
    expect(measureHealth(messages, "tiny", 0).usage).toBeLessThan(
      measureHealth(messages, "tiny", 24_000).usage,
    );
  });

  it("defaults the system prompt to zero so existing callers are unchanged", () => {
    const messages = [msg("user", "hello")];
    expect(measureHealth(messages, "some-model").estimatedTokens).toBe(
      measureHealth(messages, "some-model", 0).estimatedTokens,
    );
  });
});
