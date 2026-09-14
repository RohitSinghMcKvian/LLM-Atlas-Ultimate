import { describe, expect, it } from "vitest";
import { makeModel } from "../__fixtures__/snapshots";
import type { CatalogModel, ProviderId } from "../types";
import {
  FIRST_PARTY_PROVIDERS,
  FIRST_PARTY_VENDORS,
  attachFirstPartyRoutes,
  firstPartyIdFor,
  type ProviderListings,
} from "./first-party";

// The rule this module exists to enforce: a first-party route is only ever added
// when the vendor's own /models listing confirms the id. Everything else here is
// in service of that — a derived id that the vendor does not list must not
// produce a route, however plausible it looks.

const claude = makeModel({
  id: "claude-sonnet-4-6",
  routes: [{ provider: "openrouter", model: "anthropic/claude-sonnet-4.6" }],
});
const glm = makeModel({
  id: "glm-4-6",
  routes: [{ provider: "openrouter", model: "z-ai/glm-4.6" }],
});

const listing = (ids: string[]) => new Set(ids);

describe("firstPartyIdFor", () => {
  it("strips the vendor namespace", () => {
    expect(firstPartyIdFor("anthropic", "anthropic/claude-sonnet-4.6")).toBe("claude-sonnet-4.6");
    expect(firstPartyIdFor("zai", "z-ai/glm-4.6")).toBe("glm-4.6");
    expect(firstPartyIdFor("xai", "x-ai/grok-4.3")).toBe("grok-4.3");
  });

  it("strips OpenRouter's own variant suffixes", () => {
    // `:free` / `:nitro` are OpenRouter routing directives, not part of the
    // upstream id — sending one to the vendor is a 404.
    expect(firstPartyIdFor("deepseek", "deepseek/deepseek-v3.2:free")).toBe("deepseek-v3.2");
  });

  it("returns undefined for another vendor's namespace", () => {
    expect(firstPartyIdFor("anthropic", "openai/gpt-5.5")).toBeUndefined();
    expect(firstPartyIdFor("zai", "meta-llama/llama-3.3-70b")).toBeUndefined();
  });

  it("has no mapping for providers that only host other vendors' weights", () => {
    // Groq, Cerebras and NVIDIA serve open weights, so there is no namespace that
    // implies a first-party id for them.
    for (const id of ["groq", "cerebras", "nvidia", "local"] as ProviderId[]) {
      expect(FIRST_PARTY_VENDORS[id]).toBeUndefined();
      expect(firstPartyIdFor(id, "anything/at-all")).toBeUndefined();
    }
  });
});

describe("attachFirstPartyRoutes", () => {
  it("adds a route the vendor confirms it serves", () => {
    const { models, added } = attachFirstPartyRoutes([claude], {
      anthropic: listing(["claude-sonnet-4.6", "claude-opus-4.8"]),
    });
    expect(models[0].routes).toContainEqual({
      provider: "anthropic",
      model: "claude-sonnet-4.6",
    });
    expect(added).toEqual([
      { id: "claude-sonnet-4-6", provider: "anthropic", model: "claude-sonnet-4.6" },
    ]);
  });

  // THE test. A derived id is a hypothesis; the vendor's listing is the evidence.
  it("adds nothing when the vendor does not list the derived id", () => {
    const { models, added } = attachFirstPartyRoutes([claude], {
      anthropic: listing(["claude-opus-4.8"]),
    });
    expect(models[0].routes).toEqual(claude.routes);
    expect(added).toEqual([]);
  });

  it("adds nothing for a provider that returned no listing at all", () => {
    // An unreachable or unkeyed provider must not silently produce routes.
    expect(attachFirstPartyRoutes([claude], {}).added).toEqual([]);
    expect(attachFirstPartyRoutes([claude], { anthropic: listing([]) }).added).toEqual([]);
  });

  it("never adds a second route for a provider the model already reaches", () => {
    const already = makeModel({
      id: "glm-4-6",
      routes: [
        { provider: "openrouter", model: "z-ai/glm-4.6" },
        { provider: "zai", model: "glm-4.6" },
      ],
    });
    const { added } = attachFirstPartyRoutes([already], { zai: listing(["glm-4.6"]) });
    expect(added).toEqual([]);
  });

  it("leaves models with no OpenRouter route untouched", () => {
    // A first-party id can only be derived from a namespaced OpenRouter id, so a
    // Groq-only or NVIDIA-only model has nothing to derive from.
    const groqOnly = makeModel({
      id: "gpt-oss-120b",
      routes: [{ provider: "groq", model: "openai/gpt-oss-120b" }],
    });
    const { models, added } = attachFirstPartyRoutes([groqOnly], {
      openai: listing(["gpt-oss-120b"]),
    });
    expect(models[0]).toBe(groqOnly);
    expect(added).toEqual([]);
  });

  it("appends rather than reorders, leaving priority to mergeSnapshot", () => {
    const { models } = attachFirstPartyRoutes([glm], { zai: listing(["glm-4.6"]) });
    expect(models[0].routes[0]).toEqual({ provider: "openrouter", model: "z-ai/glm-4.6" });
    expect(models[0].routes[1]).toEqual({ provider: "zai", model: "glm-4.6" });
  });

  it("does not mutate the models it was given", () => {
    const input: CatalogModel[] = [claude];
    const before = JSON.stringify(input);
    attachFirstPartyRoutes(input, { anthropic: listing(["claude-sonnet-4.6"]) });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("attaches several providers across a catalog in one pass", () => {
    const listings: ProviderListings = {
      anthropic: listing(["claude-sonnet-4.6"]),
      zai: listing(["glm-4.6"]),
    };
    const { added } = attachFirstPartyRoutes([claude, glm], listings);
    expect(added.map((a) => a.provider).sort()).toEqual(["anthropic", "zai"]);
  });

  it("only claims providers that actually have a vendor mapping", () => {
    expect(FIRST_PARTY_PROVIDERS.every((p) => FIRST_PARTY_VENDORS[p])).toBe(true);
  });
});
