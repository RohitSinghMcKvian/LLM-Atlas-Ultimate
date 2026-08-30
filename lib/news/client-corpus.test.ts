import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cachedNewsCorpus, clearNewsCorpus, primeNewsCorpus } from "./client-corpus";

/**
 * The corpus cache.
 *
 * Two properties are load-bearing and neither is obvious. `cachedNewsCorpus`
 * must never fetch — it is called from inside a tool call, and a synchronous
 * port that reaches the network is a port that returns `undefined` and lies.
 * And a failed prime must be indistinguishable from "not primed yet": this runs
 * on the mount of a page whose job is not news.
 */
const article = (id: string) => ({ id, title: id });

beforeEach(() => clearNewsCorpus());
afterEach(() => {
  vi.unstubAllGlobals();
  clearNewsCorpus();
});

const stubFetch = (impl: () => Promise<unknown>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (await impl()) as Response),
  );

describe("cachedNewsCorpus", () => {
  it("is null before anything is primed, and never fetches to find out", () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(cachedNewsCorpus()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("primeNewsCorpus", () => {
  it("loads once and serves the rest from memory", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ articles: [article("a")], clusters: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await primeNewsCorpus();
    await primeNewsCorpus();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedNewsCorpus()?.articles).toHaveLength(1);
  });

  it("shares one request between concurrent callers", async () => {
    // The chat page and the dock can both be mounted; two requests for a body
    // neither of them renders is pure waste.
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ articles: [article("a")], clusters: [] }),
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([primeNewsCorpus(), primeNewsCorpus()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays null when the feed is down, rather than throwing into a chat page", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    await expect(primeNewsCorpus()).resolves.toBeNull();
    expect(cachedNewsCorpus()).toBeNull();
  });

  it("stays null on a non-200, and can be retried afterwards", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ articles: [article("a")], clusters: [] }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    expect(await primeNewsCorpus()).toBeNull();
    // A failure must not be cached as an answer — the feed comes back.
    expect(await primeNewsCorpus()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a body that is not a corpus", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ error: "nope" }) }));
    expect(await primeNewsCorpus()).toBeNull();
  });
});
