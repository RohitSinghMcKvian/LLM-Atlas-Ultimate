import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildEscalationPayload,
  stashEscalation,
  popEscalation,
  type EscalationPayload,
} from "./escalate";
import type { ChatMessage } from "./types";

const storage = new Map<string, string>();
const mockSessionStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
  get length() { return storage.size; },
  key: () => null,
};
Object.defineProperty(globalThis, "sessionStorage", { value: mockSessionStorage, writable: true });

function msg(role: "user" | "assistant", content: string, extras?: Partial<ChatMessage>): ChatMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now(), ...extras };
}

describe("buildEscalationPayload", () => {
  it("extracts code artifacts from assistant fenced blocks", () => {
    const messages: ChatMessage[] = [
      msg("user", "Build a counter component"),
      msg("assistant", "Here:\n```tsx\nexport function Counter() { return <div>0</div>; }\n```\nDone."),
    ];
    const payload = buildEscalationPayload(messages);
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.artifacts[0].language).toBe("tsx");
    expect(payload.artifacts[0].filename).toBe("artifact_1.tsx");
    expect(payload.artifacts[0].content).toContain("Counter");
  });

  it("builds a brief from recent user messages", () => {
    const messages: ChatMessage[] = [
      msg("user", "First question"),
      msg("assistant", "First answer"),
      msg("user", "Second question"),
      msg("assistant", "Second answer"),
    ];
    const payload = buildEscalationPayload(messages);
    expect(payload.brief).toContain("First question");
    expect(payload.brief).toContain("Second question");
  });

  it("collects text/code attachments from all messages", () => {
    const messages: ChatMessage[] = [
      msg("user", "Here is my file", {
        attachments: [
          { id: "a1", name: "data.csv", kind: "csv", mime: "text/csv", size: 100, text: "a,b\n1,2" },
          { id: "a2", name: "photo.jpg", kind: "image", mime: "image/jpeg", size: 5000 },
        ],
      }),
      msg("assistant", "Got it"),
    ];
    const payload = buildEscalationPayload(messages);
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].name).toBe("data.csv");
  });

  it("includes a conversation summary", () => {
    const messages: ChatMessage[] = [
      msg("user", "Hello"),
      msg("assistant", "Hi there"),
    ];
    const payload = buildEscalationPayload(messages);
    expect(payload.conversationSummary.length).toBeGreaterThan(0);
  });

  it("generates a unique id", () => {
    const p1 = buildEscalationPayload([msg("user", "a")]);
    const p2 = buildEscalationPayload([msg("user", "b")]);
    expect(p1.id).not.toBe(p2.id);
  });

  it("skips tiny code blocks", () => {
    const messages: ChatMessage[] = [
      msg("assistant", "Use `npm i` or:\n```bash\nnpm i\n```\nDone."),
    ];
    const payload = buildEscalationPayload(messages);
    expect(payload.artifacts).toHaveLength(0);
  });
});

describe("stash/pop escalation", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a payload through sessionStorage", () => {
    const payload: EscalationPayload = {
      id: "test-id",
      brief: "test brief",
      artifacts: [],
      attachments: [],
      conversationSummary: "summary",
      createdAt: Date.now(),
    };
    stashEscalation(payload);
    const result = popEscalation();
    expect(result).toEqual(payload);
  });

  it("returns null and clears after pop", () => {
    const payload: EscalationPayload = {
      id: "test-id",
      brief: "brief",
      artifacts: [],
      attachments: [],
      conversationSummary: "sum",
      createdAt: Date.now(),
    };
    stashEscalation(payload);
    popEscalation();
    expect(popEscalation()).toBeNull();
  });

  it("returns null when nothing stashed", () => {
    expect(popEscalation()).toBeNull();
  });
});
