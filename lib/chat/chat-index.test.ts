import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  clearConversationIndex,
  clearPastChatIndex,
  formatPastChats,
  indexConversation,
  indexedConversationCount,
  searchPastChats,
  transcriptFingerprint,
  transcriptOf,
} from "./chat-index";
import { lexicalEmbedder } from "./embed";
import { resetIncognito, setIncognito } from "./incognito";
import type { ChatMessage } from "./types";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetIncognito();
});
afterEach(() => resetIncognito());

let seq = 0;
function turn(role: ChatMessage["role"], content: string): ChatMessage {
  seq += 1;
  return { id: `m${seq}`, role, content, parentId: null, createdAt: seq };
}

/** A thread long enough to clear MIN_INDEXABLE_CHARS, about deployment. */
const DEPLOY_CHAT: ChatMessage[] = [
  turn("user", "We need to pick a hosting target for the API. What are the options?"),
  turn(
    "assistant",
    "The realistic options are Oracle Cloud Always Free, a small VPS, or a serverless " +
      "platform. Oracle's free tier gives you an ARM instance with four cores and " +
      "twenty-four gigabytes of memory at no cost, which is unusually generous.",
  ),
  turn("user", "Let's go with Oracle Cloud then. Remember that decision."),
  turn(
    "assistant",
    "Noted — the API will be deployed to Oracle Cloud Always Free, on the ARM instance.",
  ),
];

/** A second, unrelated thread so retrieval has to actually discriminate. */
const CAKE_CHAT: ChatMessage[] = [
  turn("user", "How long should I bake a lemon drizzle cake and at what temperature?"),
  turn(
    "assistant",
    "Bake it at one hundred and eighty degrees celsius for about forty-five minutes, " +
      "then pour the sugar and lemon juice syrup over the sponge while it is still warm " +
      "so it soaks all the way through the crumb.",
  ),
];

describe("transcriptOf", () => {
  it("labels speakers, because who said a thing is part of the fact", () => {
    const t = transcriptOf([turn("user", "I prefer tea"), turn("assistant", "Noted")]);
    expect(t).toContain("User: I prefer tea");
    expect(t).toContain("Assistant: Noted");
  });

  // A streaming placeholder is mechanism, not conversation.
  it("drops empty turns", () => {
    const t = transcriptOf([
      turn("user", "real"),
      turn("assistant", "   "),
      turn("assistant", ""),
    ]);
    expect(t).toBe("User: real");
  });

  // An indexed failure notice can surface as a search hit and get cited back to
  // the user as something they discussed.
  it("drops errored turns", () => {
    const t = transcriptOf([
      turn("user", "real"),
      { ...turn("assistant", "The provider did not respond on any route."), error: true },
    ]);
    expect(t).toBe("User: real");
  });
});

describe("transcriptFingerprint", () => {
  it("is stable for the same thread", () => {
    expect(transcriptFingerprint(DEPLOY_CHAT)).toBe(transcriptFingerprint(DEPLOY_CHAT));
  });

  it("changes when a turn is appended", () => {
    const before = transcriptFingerprint(DEPLOY_CHAT);
    expect(transcriptFingerprint([...DEPLOY_CHAT, turn("user", "one more")])).not.toBe(before);
  });

  it("changes when a turn is edited", () => {
    const edited = DEPLOY_CHAT.map((m, i) =>
      i === 0 ? { ...m, content: `${m.content} and the database too` } : m,
    );
    expect(transcriptFingerprint(edited)).not.toBe(transcriptFingerprint(DEPLOY_CHAT));
  });
});

describe("indexConversation", () => {
  it("indexes a substantial thread", async () => {
    const r = await indexConversation(
      { id: "c1", title: "Hosting" },
      DEPLOY_CHAT,
      lexicalEmbedder,
    );
    expect(r.indexed).toBe(true);
    expect(r.chunks).toBeGreaterThan(0);
  });

  it("skips a thread too short to be worth recalling", async () => {
    const r = await indexConversation({ id: "c1", title: "Hi" }, [turn("user", "hi")], lexicalEmbedder);
    expect(r).toEqual({ indexed: false, chunks: 0 });
    expect(await indexedConversationCount()).toBe(0);
  });

  it("is idempotent by fingerprint", async () => {
    await indexConversation({ id: "c1", title: "Hosting" }, DEPLOY_CHAT, lexicalEmbedder);
    const second = await indexConversation(
      { id: "c1", title: "Hosting" },
      DEPLOY_CHAT,
      lexicalEmbedder,
    );
    expect(second.indexed).toBe(false);
  });

  it("re-indexes when the thread grows", async () => {
    await indexConversation({ id: "c1", title: "Hosting" }, DEPLOY_CHAT, lexicalEmbedder);
    const grown = [...DEPLOY_CHAT, turn("user", "Also add a note about the database choice.")];
    const r = await indexConversation({ id: "c1", title: "Hosting" }, grown, lexicalEmbedder);
    expect(r.indexed).toBe(true);
  });

  it("leaves no orphan chunks when a thread is re-indexed shorter", async () => {
    const long = [
      ...DEPLOY_CHAT,
      turn("user", "One extra paragraph about kubernetes and container orchestration entirely."),
    ];
    await indexConversation({ id: "c1", title: "Hosting" }, long, lexicalEmbedder);
    await indexConversation({ id: "c1", title: "Hosting" }, DEPLOY_CHAT, lexicalEmbedder);
    const hits = await searchPastChats("kubernetes container orchestration", lexicalEmbedder, {
      minScore: 0,
    });
    for (const h of hits) expect(h.text).not.toContain("kubernetes");
  });

  // The mode's whole promise. The index is the least obvious write path, which is
  // exactly why it needs its own test.
  it("writes nothing in incognito", async () => {
    setIncognito(true);
    const r = await indexConversation(
      { id: "c1", title: "Secret" },
      DEPLOY_CHAT,
      lexicalEmbedder,
    );
    expect(r).toEqual({ indexed: false, chunks: 0 });
    expect(await indexedConversationCount()).toBe(0);
    expect(await searchPastChats("Oracle Cloud", lexicalEmbedder, { minScore: 0 })).toEqual([]);
  });
});

describe("searchPastChats", () => {
  beforeEach(async () => {
    await indexConversation({ id: "c1", title: "Hosting decision" }, DEPLOY_CHAT, lexicalEmbedder);
    await indexConversation({ id: "c2", title: "Lemon drizzle" }, CAKE_CHAT, lexicalEmbedder);
  });

  // The P4 acceptance criterion: "what did we discuss about X" must find the
  // right past chat, and must carry the citation with it.
  it("finds the relevant conversation and cites it", async () => {
    const hits = await searchPastChats("what did we decide about hosting the API", lexicalEmbedder);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].conversationId).toBe("c1");
    expect(hits[0].title).toBe("Hosting decision");
  });

  it("discriminates between unrelated threads", async () => {
    const cake = await searchPastChats("baking temperature for the cake", lexicalEmbedder);
    expect(cake[0].conversationId).toBe("c2");
  });

  it("excludes the current conversation", async () => {
    const hits = await searchPastChats("hosting the API", lexicalEmbedder, {
      excludeConversationId: "c1",
    });
    expect(hits.every((h) => h.conversationId !== "c1")).toBe(true);
  });

  it("returns at most one excerpt per conversation", async () => {
    const hits = await searchPastChats("Oracle Cloud ARM instance", lexicalEmbedder, {
      minScore: 0,
      k: 8,
    });
    expect(new Set(hits.map((h) => h.conversationId)).size).toBe(hits.length);
  });

  it("respects k", async () => {
    const hits = await searchPastChats("the", lexicalEmbedder, { minScore: 0, k: 1 });
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  // Without a floor, a nonsense query still returns the k least-bad chunks and
  // the model cites them as if they answered the question.
  it("returns nothing for a query with no lexical overlap", async () => {
    const hits = await searchPastChats("xylophone quokka zeppelin", lexicalEmbedder);
    expect(hits).toEqual([]);
  });

  it("sorts by score, best first", async () => {
    const hits = await searchPastChats("Oracle Cloud hosting cake baking", lexicalEmbedder, {
      minScore: 0,
    });
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  it("ignores vectors built by a different embedder", async () => {
    // A 1536-dim provider query must never be scored against lexical vectors.
    const fake = async () => [{ vector: new Array(1536).fill(0.01), dims: 1536, model: "provider" }];
    expect(await searchPastChats("hosting", fake)).toEqual([]);
  });
});

describe("index maintenance", () => {
  beforeEach(async () => {
    await indexConversation({ id: "c1", title: "Hosting decision" }, DEPLOY_CHAT, lexicalEmbedder);
    await indexConversation({ id: "c2", title: "Lemon drizzle" }, CAKE_CHAT, lexicalEmbedder);
  });

  it("counts indexed conversations", async () => {
    expect(await indexedConversationCount()).toBe(2);
  });

  it("clears one conversation without touching the others", async () => {
    await clearConversationIndex("c1");
    expect(await indexedConversationCount()).toBe(1);
    const hits = await searchPastChats("cake baking", lexicalEmbedder);
    expect(hits[0].conversationId).toBe("c2");
  });

  it("clears the whole index", async () => {
    await clearPastChatIndex();
    expect(await indexedConversationCount()).toBe(0);
  });
});

describe("formatPastChats", () => {
  it("says nothing matched rather than returning an empty block", () => {
    expect(formatPastChats([])).toContain("No past conversations matched");
  });

  it("numbers excerpts and names the source conversation", () => {
    const block = formatPastChats([
      {
        conversationId: "c1",
        title: "Hosting decision",
        chunkIndex: 0,
        text: "We chose Oracle Cloud.",
        score: 0.4,
        updatedAt: Date.UTC(2026, 0, 15),
      },
    ]);
    expect(block).toContain("[1]");
    expect(block).toContain("Hosting decision");
    expect(block).toContain("c1");
    expect(block).toContain("2026-01-15");
    expect(block).toContain("We chose Oracle Cloud.");
  });
});
