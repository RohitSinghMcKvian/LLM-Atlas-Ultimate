import { describe, it, expect } from "vitest";
import { requestChars, searchContextBlock, toRouterMessages } from "./request";
import { ACTIONS_BUDGET } from "./turn-actions";
import type { Attachment, ChatMessage, StoredToolCall } from "./types";

let n = 0;
const msg = (role: "user" | "assistant", content: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${n++}`,
  role,
  content,
  parentId: null,
  createdAt: 1000,
  ...over,
});

const image = (name: string): Attachment => ({
  id: `a${n++}`,
  name,
  kind: "image",
  mime: "image/png",
  size: 100,
  dataUrl: "data:image/png;base64,AAAA",
});

const call = (name: string, args: unknown, result = "ok"): StoredToolCall => ({
  id: `c${n++}`,
  name,
  arguments: JSON.stringify(args),
  result,
});

const base = { system: "SYS", vision: false } as const;

describe("toRouterMessages", () => {
  it("puts the system prompt first", () => {
    const out = toRouterMessages([msg("user", "hi")], base);
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(out[1].role).toBe("user");
  });

  it("emits the search block as a second system message, once", () => {
    const out = toRouterMessages([msg("user", "hi")], {
      ...base,
      searchSources: [{ title: "T", url: "https://a.test", snippet: "s" }],
    });
    expect(out.filter((m) => m.role === "system")).toHaveLength(2);
    expect(out[1].content).toContain("https://a.test");
  });

  it("inlines attachment text into the user turn", () => {
    const out = toRouterMessages(
      [
        msg("user", "look", {
          attachments: [
            { id: "a", name: "spec.md", kind: "text", mime: "text/plain", size: 1, text: "BODY" },
          ],
        }),
      ],
      base,
    );
    expect(out[1].content).toContain("BODY");
    expect(out[1].content).toContain("spec.md");
  });

  it("sends the last turn's images as parts when the model has vision", () => {
    const out = toRouterMessages([msg("user", "what is this?", { attachments: [image("a.png")] })], {
      ...base,
      vision: true,
    });
    expect(Array.isArray(out[1].content)).toBe(true);
    expect(out[1].content[1].type).toBe("image_url");
  });

  /**
   * Older images are not re-sent — six screenshots would be megabytes of base64
   * on every request. But they used to vanish with nothing in their place, so
   * the model would state that no image had ever been provided.
   */
  it("leaves a note where an earlier image was", () => {
    const out = toRouterMessages(
      [
        msg("user", "here", { attachments: [image("chart.png")] }),
        msg("assistant", "I see it"),
        msg("user", "and now?"),
      ],
      { ...base, vision: true },
    );
    expect(out[1].content).toContain("chart.png");
    expect(out[1].content).toContain("not re-sent");
    expect(Array.isArray(out[1].content)).toBe(false);
  });

  it("does not send images at all to a model without vision", () => {
    const out = toRouterMessages([msg("user", "x", { attachments: [image("a.png")] })], base);
    expect(Array.isArray(out[1].content)).toBe(false);
    expect(out[1].content).toContain("a.png");
  });
});

/**
 * Across turns the model could not see what it had previously done: assistant
 * turns went out as `{role, content}` and its only durable record of a build was
 * the 2400-character workspace block.
 */
describe("toRouterMessages — turn actions", () => {
  const withCalls = () => [
    msg("user", "build it"),
    msg("assistant", "Done.", {
      toolCalls: [
        call("workspace", { command: "create", path: "/workspace/index.html" }),
        call("run_python", { code: "x" }),
      ],
    }),
    msg("user", "add a footer"),
  ];

  it("is off unless asked for, so the wire is unchanged by default", () => {
    const out = toRouterMessages(withCalls(), base);
    expect(out.find((m) => m.role === "assistant")!.content).toBe("Done.");
  });

  it("appends what the turn did", () => {
    const out = toRouterMessages(withCalls(), { ...base, actions: ACTIONS_BUDGET });
    const assistant = out.find((m) => m.role === "assistant")!.content as string;
    expect(assistant).toContain("Done.");
    expect(assistant).toContain("Actions this turn");
    expect(assistant).toContain("/workspace/index.html");
    expect(assistant).toContain("Python");
  });

  it("leaves user turns alone", () => {
    const out = toRouterMessages(withCalls(), { ...base, actions: ACTIONS_BUDGET });
    for (const m of out.filter((m) => m.role === "user")) {
      expect(String(m.content)).not.toContain("Actions this turn");
    }
  });

  it("says nothing for a turn that called nothing", () => {
    const out = toRouterMessages([msg("user", "hi"), msg("assistant", "hello")], {
      ...base,
      actions: ACTIONS_BUDGET,
    });
    expect(out.find((m) => m.role === "assistant")!.content).toBe("hello");
  });

  it("stays inside its total across many turns", () => {
    const many: ChatMessage[] = [];
    for (let i = 0; i < 30; i++) {
      many.push(msg("user", `ask ${i}`));
      many.push(
        msg("assistant", `reply ${i}`, {
          toolCalls: [call("workspace", { command: "create", path: `/workspace/f${i}.html` })],
        }),
      );
    }
    const plain = requestChars(toRouterMessages(many, base));
    const withActions = requestChars(toRouterMessages(many, { ...base, actions: ACTIONS_BUDGET }));
    expect(withActions - plain).toBeLessThanOrEqual(ACTIONS_BUDGET.total);
  });
});

describe("searchContextBlock", () => {
  it("numbers results so inline citations line up", () => {
    const block = searchContextBlock([
      { title: "First", url: "https://a.test", snippet: "one" },
      { title: "Second", url: "https://b.test", snippet: "two" },
    ]);
    expect(block).toContain("[1] First");
    expect(block).toContain("[2] Second");
  });
});

describe("requestChars", () => {
  // The meter has to measure the request rather than re-derive an estimate of
  // it, which is how it came to count neither the search block nor the tool
  // transcript.
  it("counts the whole built request, including the system messages", () => {
    const plain = requestChars(toRouterMessages([msg("user", "hi")], base));
    const searched = requestChars(
      toRouterMessages([msg("user", "hi")], {
        ...base,
        searchSources: [{ title: "T", url: "https://a.test", snippet: "s".repeat(500) }],
      }),
    );
    expect(searched).toBeGreaterThan(plain + 400);
  });

  it("counts multimodal parts", () => {
    const out = toRouterMessages([msg("user", "x", { attachments: [image("a.png")] })], {
      ...base,
      vision: true,
    });
    expect(requestChars(out)).toBeGreaterThan(0);
  });
});
