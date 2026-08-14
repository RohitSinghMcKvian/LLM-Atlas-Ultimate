import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  clearRecallIndex,
  formatRecall,
  indexFoldedTurns,
  RECALL_MAX_CHARS,
  recallContext,
  type RecallHit,
} from "./recall";
import { lexicalEmbedder } from "./embed";
import { resetIncognito, setIncognito } from "./incognito";
import type { ChatMessage } from "./types";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetIncognito();
});
afterEach(() => resetIncognito());

let seq = 0;
function turn(role: ChatMessage["role"], content: string, folded = false): ChatMessage {
  seq += 1;
  return { id: `m${seq}`, role, content, parentId: null, createdAt: seq, folded };
}

/**
 * A thread whose folded part holds the specific facts a summary would flatten:
 * a port number, a library choice and a hard requirement in the user's words.
 */
function thread(): ChatMessage[] {
  return [
    turn(
      "user",
      "The deployment target is a Raspberry Pi on the factory floor. It has no internet " +
        "access at all, so everything has to be vendored. Bind the dashboard to port 8471.",
      true,
    ),
    turn(
      "assistant",
      "Understood. I will vendor the dependencies into a wheelhouse directory and bind " +
        "the dashboard to port 8471 rather than the usual 8080.",
      true,
    ),
    turn(
      "user",
      "Also the sensor sampling has to stay at exactly four hertz. The regulator audits " +
        "that number, so it is not something we can tune later for performance.",
      true,
    ),
    turn("assistant", "Noted — four hertz sampling, fixed and not tunable.", true),
    turn(
      "user",
      "Now add the throughput chart to the dashboard, with a rolling one-minute average.",
      false,
    ),
  ];
}

describe("indexFoldedTurns", () => {
  it("indexes only the folded turns", async () => {
    const msgs = thread();
    const count = await indexFoldedTurns("c1", msgs, lexicalEmbedder);
    expect(count).toBeGreaterThan(0);

    const hits = await recallContext("c1", "add the chart", lexicalEmbedder);
    expect(hits.every((h) => h.messageId !== msgs[4].id)).toBe(true);
  });

  it("does nothing when nothing is folded", async () => {
    expect(await indexFoldedTurns("c1", [turn("user", "hello there friend")], lexicalEmbedder)).toBe(
      0,
    );
  });

  it("is idempotent while the fold is unchanged", async () => {
    const msgs = thread();
    const first = await indexFoldedTurns("c1", msgs, lexicalEmbedder);
    const second = await indexFoldedTurns("c1", msgs, lexicalEmbedder);
    expect(second).toBe(first);
  });

  it("rebuilds when the fold grows", async () => {
    const msgs = thread();
    const before = await indexFoldedTurns("c1", msgs, lexicalEmbedder);
    const grown = msgs.map((m) => ({ ...m, folded: true }));
    const after = await indexFoldedTurns("c1", grown, lexicalEmbedder);
    expect(after).toBeGreaterThan(before);
  });

  // The index is the least obvious of the write paths, and a searchable record
  // of a temporary chat is the exact leak the mode exists to prevent.
  it("writes nothing in incognito", async () => {
    setIncognito(true);
    expect(await indexFoldedTurns("c1", thread(), lexicalEmbedder)).toBe(0);
    expect(await recallContext("c1", "port", lexicalEmbedder)).toEqual([]);
  });

  it("keeps conversations apart", async () => {
    await indexFoldedTurns("c1", thread(), lexicalEmbedder);
    expect(await recallContext("c2", "port 8471", lexicalEmbedder)).toEqual([]);
  });

  it("forgets a conversation on request", async () => {
    await indexFoldedTurns("c1", thread(), lexicalEmbedder);
    await clearRecallIndex("c1");
    expect(await recallContext("c1", "port 8471", lexicalEmbedder)).toEqual([]);
  });
});

describe("recallContext", () => {
  it("finds the exact wording a summary would have flattened", async () => {
    await indexFoldedTurns("c1", thread(), lexicalEmbedder);
    const hits = await recallContext("c1", "sensor sampling hertz regulator", lexicalEmbedder);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.text).join(" ")).toContain("four hertz");
  });

  it("carries the turn it came from, so the model can attribute it", async () => {
    const msgs = thread();
    await indexFoldedTurns("c1", msgs, lexicalEmbedder);
    const hits = await recallContext("c1", "raspberry pi factory floor internet", lexicalEmbedder);
    expect(hits[0].messageId).toBe(msgs[0].id);
    // 1-based position in the whole thread, which is what the user can count.
    expect(hits[0].turnIndex).toBe(1);
    expect(hits[0].role).toBe("user");
  });

  /**
   * The floor is what stops a query with no real match returning the k
   * least-bad chunks, which the model then cites as if they were answers. A
   * confident wrong citation is worse than "nothing found".
   */
  it("returns nothing rather than the least-bad chunk", async () => {
    await indexFoldedTurns("c1", thread(), lexicalEmbedder);
    expect(
      await recallContext("c1", "zzzz quixotic bandersnatch", lexicalEmbedder, { minScore: 0.5 }),
    ).toEqual([]);
  });

  /**
   * Why that floor cannot simply be raised: `lexicalEmbedder` is a bag of hashed
   * tokens over 512 dimensions, so an unrelated query still collides into shared
   * buckets and scores non-zero — here around 0.1, above the 0.05 the rest of
   * the codebase uses. The separation is real and large, but it is a ratio, not
   * an absolute threshold, and picking a cutoff from one sample would be tuning
   * to noise. Recorded rather than papered over: this is the known limit of
   * lexical recall, and the reason the tool result tells the model to say so
   * plainly instead of guessing.
   */
  it("scores a real match far above an unrelated one", async () => {
    await indexFoldedTurns("c1", thread(), lexicalEmbedder);
    const real = await recallContext("c1", "sensor sampling hertz regulator", lexicalEmbedder);
    const noise = await recallContext("c1", "zzzz quixotic bandersnatch", lexicalEmbedder);
    expect(real[0].score).toBeGreaterThan((noise[0]?.score ?? 0) * 3);
  });

  it("reads back in the order things were said", async () => {
    const msgs = thread();
    await indexFoldedTurns("c1", msgs, lexicalEmbedder);
    const hits = await recallContext("c1", "port 8471 hertz sampling dashboard", lexicalEmbedder, {
      k: 4,
    });
    expect(hits.length).toBeGreaterThan(1);
    const idx = hits.map((h) => h.turnIndex);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("spreads across turns rather than mining one of them", async () => {
    const long = [
      turn("assistant", ("alpha beta gamma delta epsilon ".repeat(120)).trim(), true),
      turn("user", "alpha beta gamma delta epsilon zeta", true),
    ];
    await indexFoldedTurns("c1", long, lexicalEmbedder);
    const hits = await recallContext("c1", "alpha beta gamma", lexicalEmbedder, { k: 4 });
    expect(new Set(hits.map((h) => h.messageId)).size).toBe(hits.length);
  });

  it("survives a missing database", async () => {
    // @ts-expect-error deliberately removing the global the module probes for
    delete globalThis.indexedDB;
    expect(await indexFoldedTurns("c1", thread(), lexicalEmbedder)).toBe(0);
    expect(await recallContext("c1", "anything", lexicalEmbedder)).toEqual([]);
  });
});

describe("formatRecall", () => {
  const hit = (over: Partial<RecallHit> = {}): RecallHit => ({
    messageId: "m1",
    turnIndex: 12,
    role: "user",
    text: "Bind the dashboard to port 8471.",
    score: 0.4,
    ...over,
  });

  it("attributes each excerpt to a speaker and a turn", () => {
    const out = formatRecall([hit()]);
    expect(out).toContain("turn 12");
    expect(out).toContain("The user said");
    expect(out).toContain("port 8471");
  });

  it("distinguishes what the user said from what Atlas said", () => {
    expect(formatRecall([hit({ role: "assistant" })])).toContain("You said");
  });

  // A model told "no results" as if it were a failure retries the query. Told
  // there is nothing, it can say there is nothing.
  it("tells the model to admit the gap when nothing matched", () => {
    const out = formatRecall([]);
    expect(out.toLowerCase()).toContain("nothing");
    expect(out).toContain("do not fill the gap");
  });

  /**
   * The point of a fold is that those turns are not in the request. A recall
   * that can pull twenty thousand characters of them back re-creates the problem
   * it was invented to solve, one call at a time.
   */
  it("stays inside its budget", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      hit({ messageId: `m${i}`, turnIndex: i, text: "x".repeat(1500) }),
    );
    const out = formatRecall(many);
    expect(out.length).toBeLessThanOrEqual(RECALL_MAX_CHARS + 200);
    expect(out).toContain("omitted to stay within budget");
  });

  it("drops whole excerpts, never half of one", () => {
    const out = formatRecall([
      hit({ messageId: "a", turnIndex: 1, text: "A".repeat(4000) }),
      hit({ messageId: "b", turnIndex: 2, text: "B".repeat(4000) }),
    ]);
    expect(out).toContain("A".repeat(4000));
    expect(out).not.toContain("B".repeat(10));
  });

  it("clips and says so when even the best hit is over budget", () => {
    const out = formatRecall([hit({ text: "x".repeat(20_000) })], 500);
    expect(out).toContain("clipped");
    expect(out.length).toBeLessThan(1_000);
  });
});
