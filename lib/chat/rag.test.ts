import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  clearProjectIndex,
  formatRetrieved,
  indexProject,
  isIndexed,
  resolveProjectContext,
  retrieveContext,
  retrieveLocal,
} from "./rag";
import { lexicalEmbed, lexicalEmbedder } from "./embed";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const FILES = [
  { name: "policy.md", text: "Our refund policy allows returns within 30 days of purchase. Keep the receipt." },
  { name: "hours.md", text: "The office is open Monday to Friday, from nine in the morning to five in the evening." },
  { name: "security.md", text: "Passwords must be at least twelve characters and include a number." },
];

describe("indexProject", () => {
  it("chunks, embeds and stores", async () => {
    const res = await indexProject("p1", FILES, lexicalEmbedder);
    expect(res.indexed).toBe(true);
    expect(res.chunks).toBeGreaterThanOrEqual(3);
  });

  it("is idempotent by fingerprint — a second call is a no-op", async () => {
    await indexProject("p1", FILES, lexicalEmbedder);
    const second = await indexProject("p1", FILES, lexicalEmbedder);
    expect(second.indexed).toBe(false);
  });

  it("re-indexes when the files change", async () => {
    await indexProject("p1", FILES, lexicalEmbedder);
    const changed = [...FILES, { name: "new.md", text: "A brand new document about shipping." }];
    const res = await indexProject("p1", changed, lexicalEmbedder);
    expect(res.indexed).toBe(true);
  });

  it("does not leave orphan chunks when a file shrinks", async () => {
    await indexProject("p1", [{ name: "big.md", text: "word ".repeat(4000) }], lexicalEmbedder);
    await indexProject("p1", [{ name: "big.md", text: "tiny" }], lexicalEmbedder);
    const q = lexicalEmbed("tiny");
    const hits = await retrieveLocal("p1", q, 50);
    // Only the single tiny chunk should remain.
    expect(hits.length).toBe(1);
    expect(hits[0].text).toBe("tiny");
  });
});

describe("isIndexed", () => {
  it("is false before indexing", async () => {
    expect(await isIndexed("p1", FILES)).toBe(false);
  });

  it("is true after indexing the same files", async () => {
    await indexProject("p1", FILES, lexicalEmbedder);
    expect(await isIndexed("p1", FILES)).toBe(true);
  });

  it("is false after the files change", async () => {
    await indexProject("p1", FILES, lexicalEmbedder);
    expect(await isIndexed("p1", [{ name: "x", text: "different" }])).toBe(false);
  });
});

describe("retrieveLocal", () => {
  beforeEach(async () => {
    await indexProject("p1", FILES, lexicalEmbedder);
  });

  it("returns the passage that answers the query first", async () => {
    const q = lexicalEmbed("how many days to return an item for a refund");
    const hits = await retrieveLocal("p1", q, 3);
    expect(hits[0].fileName).toBe("policy.md");
    expect(hits[0].text).toContain("refund");
  });

  it("respects k", async () => {
    const q = lexicalEmbed("office refund password");
    expect(await retrieveLocal("p1", q, 1)).toHaveLength(1);
    expect((await retrieveLocal("p1", q, 2)).length).toBeLessThanOrEqual(2);
  });

  it("returns results sorted by descending score", async () => {
    const q = lexicalEmbed("password security requirements");
    const hits = await retrieveLocal("p1", q, 3);
    for (let i = 0; i < hits.length - 1; i++) {
      expect(hits[i].score).toBeGreaterThanOrEqual(hits[i + 1].score);
    }
  });

  it("returns nothing for an unindexed project", async () => {
    expect(await retrieveLocal("other", lexicalEmbed("x"))).toEqual([]);
  });

  // A lexical query must never match a 1536-dim provider vector, or the cosine
  // would compare unrelated spaces.
  it("ignores chunks whose vector dims or model differ from the query", async () => {
    const q = { vector: new Array(1536).fill(0.1), dims: 1536, model: "text-embedding-3-small" };
    expect(await retrieveLocal("p1", q, 5)).toEqual([]);
  });
});

describe("clearProjectIndex", () => {
  it("removes a project's chunks", async () => {
    await indexProject("p1", FILES, lexicalEmbedder);
    await clearProjectIndex("p1");
    expect(await retrieveLocal("p1", lexicalEmbed("refund"))).toEqual([]);
    expect(await isIndexed("p1", FILES)).toBe(false);
  });
});

describe("formatRetrieved", () => {
  it("wraps chunks in project_file blocks with file and chunk attributes", () => {
    const out = formatRetrieved([
      { fileName: "a.md", chunkIndex: 2, text: "excerpt", score: 0.9 },
    ]);
    expect(out).toContain('<project_file name="a.md" chunk="2">');
    expect(out).toContain("excerpt");
    expect(out).toContain("</project_file>");
  });

  it("is empty for no chunks", () => {
    expect(formatRetrieved([])).toBe("");
  });
});

describe("retrieveContext (end to end, local)", () => {
  it("embeds the query, retrieves and formats", async () => {
    await indexProject("p1", FILES, lexicalEmbedder);
    const ctx = await retrieveContext("p1", "what is the refund window", lexicalEmbedder, 2);
    expect(ctx).toContain("project_file");
    expect(ctx).toContain("refund");
  });

  it("returns empty when nothing is indexed", async () => {
    expect(await retrieveContext("p1", "anything", lexicalEmbedder)).toBe("");
  });
});

describe("resolveProjectContext — threshold switch", () => {
  const small = {
    id: "p1",
    instructions: "Always answer in a formal tone.",
    files: [{ name: "faq.md", text: "The refund window is 30 days." }],
  };

  it("stuffs whole knowledge below the threshold", async () => {
    const { context, retrieved } = await resolveProjectContext(small, "refund", lexicalEmbedder, {
      thresholdTokens: 1_000_000,
    });
    expect(retrieved).toBe(false);
    expect(context).toContain("Always answer in a formal tone.");
    expect(context).toContain("The refund window is 30 days.");
    expect(context).toContain('<project_file name="faq.md">');
  });

  it("switches to retrieval above the threshold", async () => {
    const big = {
      id: "p-big",
      instructions: "Be concise.",
      files: [
        { name: "refunds.md", text: "Our refund policy: returns accepted within 30 days with a receipt. " + "filler ".repeat(200) },
        { name: "hours.md", text: "Store hours are nine to five. " + "filler ".repeat(200) },
        { name: "security.md", text: "Passwords need twelve characters. " + "filler ".repeat(200) },
      ],
    };
    const { context, retrieved } = await resolveProjectContext(
      big,
      "what is the refund window",
      lexicalEmbedder,
      { thresholdTokens: 100, k: 1 },
    );
    expect(retrieved).toBe(true);
    // The instruction override is always present...
    expect(context).toContain("Be concise.");
    // ...and retrieval surfaced the refund passage, with a chunk attribute that
    // whole-stuffing does not emit.
    expect(context).toContain("refund");
    expect(context).toContain("chunk=");
  });

  it("always includes instructions, even with no files", async () => {
    const { context } = await resolveProjectContext(
      { id: "p2", instructions: "House style: British English.", files: [] },
      "hi",
      lexicalEmbedder,
    );
    expect(context).toBe("House style: British English.");
  });

  it("returns empty context for an empty project", async () => {
    const { context, retrieved } = await resolveProjectContext(
      { id: "p3", instructions: "", files: [] },
      "hi",
      lexicalEmbedder,
    );
    expect(context).toBe("");
    expect(retrieved).toBe(false);
  });
});
