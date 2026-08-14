import { describe, it, expect, vi, afterEach } from "vitest";
import {
  LEXICAL_DIMS,
  LEXICAL_MODEL,
  cosine,
  lexicalEmbed,
  lexicalEmbedder,
  providerEmbedder,
} from "./embed";

afterEach(() => vi.unstubAllGlobals());

describe("lexicalEmbed", () => {
  it("produces a normalized vector of the fixed dimension", () => {
    const e = lexicalEmbed("the quick brown fox");
    expect(e.dims).toBe(LEXICAL_DIMS);
    expect(e.vector).toHaveLength(LEXICAL_DIMS);
    expect(e.model).toBe(LEXICAL_MODEL);
    const norm = Math.sqrt(e.vector.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("is deterministic", () => {
    expect(lexicalEmbed("hello world").vector).toEqual(lexicalEmbed("hello world").vector);
  });

  it("gives an empty document a zero vector rather than NaN", () => {
    const e = lexicalEmbed("");
    expect(e.vector.every((v) => v === 0)).toBe(true);
    expect(e.vector.some(Number.isNaN)).toBe(false);
  });

  it("ignores case and punctuation", () => {
    expect(lexicalEmbed("Hello, World!").vector).toEqual(lexicalEmbed("hello world").vector);
  });
});

describe("cosine over lexical vectors", () => {
  const sim = (a: string, b: string) => cosine(lexicalEmbed(a).vector, lexicalEmbed(b).vector);

  it("scores identical text at 1", () => {
    expect(sim("machine learning models", "machine learning models")).toBeCloseTo(1, 5);
  });

  it("scores shared-term text higher than unrelated text", () => {
    const related = sim(
      "the transformer architecture uses attention",
      "attention is central to the transformer",
    );
    const unrelated = sim(
      "the transformer architecture uses attention",
      "bananas are a good source of potassium",
    );
    expect(related).toBeGreaterThan(unrelated);
  });

  it("retrieves the right passage from a small corpus", () => {
    const corpus = [
      "Our refund policy allows returns within 30 days of purchase.",
      "The office is open Monday to Friday, nine to five.",
      "Passwords must be at least twelve characters long.",
    ];
    const q = lexicalEmbed("how many days do I have to return an item for a refund");
    const ranked = corpus
      .map((t) => ({ t, s: cosine(lexicalEmbed(t).vector, q.vector) }))
      .sort((a, b) => b.s - a.s);
    expect(ranked[0].t).toContain("refund policy");
  });
});

describe("cosine edge cases", () => {
  it("returns 0 for a dimension mismatch instead of throwing", () => {
    expect(cosine([1, 0], [1, 0, 0])).toBe(0);
  });

  it("returns 0 for a zero vector", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosine([], [])).toBe(0);
  });
});

describe("lexicalEmbedder", () => {
  it("embeds a batch", async () => {
    const out = await lexicalEmbedder(["a", "b"]);
    expect(out).toHaveLength(2);
    expect(out[0].model).toBe(LEXICAL_MODEL);
  });
});

describe("providerEmbedder", () => {
  const opts = { model: "text-embedding-3-small", keyHeaders: { "x-openrouter-key": "k" } };

  it("calls the proxy and tags vectors with the model and dims", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await providerEmbedder(opts)(["one", "two"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/embeddings",
      expect.objectContaining({ method: "POST" }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ dims: 3, model: "text-embedding-3-small" });
    expect(out[0].vector).toEqual([0.1, 0.2, 0.3]);
  });

  it("forwards the BYOK key header", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ embeddings: [[1]] }) }));
    vi.stubGlobal("fetch", fetchMock);
    await providerEmbedder(opts)(["x"]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-openrouter-key"]).toBe("k");
  });

  // Degrading rather than throwing is what keeps retrieval working when the
  // embeddings provider is down or unconfigured.
  it("falls back to lexical on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    const out = await providerEmbedder(opts)(["hello world"]);
    expect(out[0].model).toBe(LEXICAL_MODEL);
    expect(out[0].dims).toBe(LEXICAL_DIMS);
  });

  it("falls back to lexical on a network throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const out = await providerEmbedder(opts)(["hello"]);
    expect(out[0].model).toBe(LEXICAL_MODEL);
  });

  it("falls back when the provider returns the wrong count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ embeddings: [[1]] }) })));
    const out = await providerEmbedder(opts)(["a", "b"]);
    expect(out.every((e) => e.model === LEXICAL_MODEL)).toBe(true);
  });
});
