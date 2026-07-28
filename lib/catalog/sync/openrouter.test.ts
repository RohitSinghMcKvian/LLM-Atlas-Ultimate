import { describe, it, expect } from "vitest";
import { routeCost } from "../availability";
import { modelAccess } from "../stats";
import { OPENROUTER_SAMPLE } from "./__fixtures__/providers";
import { normalizeOpenRouter } from "./openrouter";
import type { ModelDraft } from "./types";

const TODAY = "2026-07-25";

function normalize(freeOpenCeilingPerM = 0): Map<string, ModelDraft> {
  const drafts = normalizeOpenRouter(OPENROUTER_SAMPLE, { today: TODAY, freeOpenCeilingPerM });
  return new Map(drafts.map((d) => [d.atlasId, d]));
}

const drafts = normalize();
const opus = drafts.get("claude-opus-5")!;
const deepseek = drafts.get("deepseek-v4-pro")!;
const llama = drafts.get("llama-3-3-70b-instruct")!;

describe("filtering", () => {
  it("drops embedding and image-output models", () => {
    expect(drafts.has("text-embedding-3-large")).toBe(false);
    expect(drafts.has("imagen-4")).toBe(false);
  });

  it("keeps every chat model exactly once", () => {
    expect([...drafts.keys()].sort()).toEqual(
      [
        "claude-opus-5",
        "deepseek-v4-pro",
        "experimental-8b",
        "gemini-4-flash-preview",
        "glm-5-turbo",
        "laguna-m-1",
        "llama-3-3-70b-instruct",
      ].sort(),
    );
  });
});

describe("identity and naming", () => {
  it("prefers the canonical slug and strips the vendor name prefix", () => {
    expect(opus.atlasId).toBe("claude-opus-5");
    expect(opus.model.name).toBe("Claude Opus 5");
    expect(llama.model.name).toBe("Llama 3.3 70B Instruct");
  });

  it("maps namespaces to catalog brand names", () => {
    expect(opus.model.provider).toBe("Anthropic");
    expect(deepseek.model.provider).toBe("DeepSeek");
    expect(llama.model.provider).toBe("Meta");
  });

  it("title-cases an unmapped vendor rather than dropping the model", () => {
    expect(drafts.get("experimental-8b")!.model.provider).toBe("Some Newvendor");
  });

  it("derives a family by trimming the version component", () => {
    expect(opus.model.family).toBe("Claude Opus");
    expect(drafts.get("gemini-4-flash-preview")!.model.family).toBeTruthy();
  });

  it("aliases the date-stamped canonical slug to the stable id", () => {
    // `anthropic/claude-opus-5-20260601` must resolve, but must never *be* the id.
    expect(opus.aliasIds).toContain("claude-opus-5-20260601");
    expect(opus.atlasId).not.toContain("2026");
  });
});

describe("capabilities and modalities", () => {
  it("reads vision and audio from input modalities", () => {
    expect(opus.model.modalities).toEqual(["text", "vision"]);
    expect(deepseek.model.modalities).toEqual(["text"]);
    expect(drafts.get("gemini-4-flash-preview")!.model.modalities).toEqual([
      "text",
      "vision",
      "audio",
    ]);
  });

  it("reads tool use and structured output from supported parameters", () => {
    expect(opus.model.capabilities.toolUse).toBe(true);
    expect(opus.model.capabilities.structuredOutput).toBe(true);
    expect(drafts.get("experimental-8b")!.model.capabilities.toolUse).toBe(false);
  });

  it("detects reasoning from either the reasoning block or the parameter list", () => {
    expect(opus.model.capabilities.reasoning).toBe(true); // reasoning block
    expect(deepseek.model.capabilities.reasoning).toBe(true); // include_reasoning
    expect(llama.model.capabilities.reasoning).toBe(false);
  });

  it("detects caching from cache pricing", () => {
    expect(opus.model.capabilities.caching).toBe(true);
    expect(llama.model.capabilities.caching).toBe(false);
  });
});

describe("context and output limits", () => {
  it("prefers top_provider context — that is what is actually served", () => {
    expect(opus.model.contextWindow).toBe(900_000);
    expect(opus.model.maxOutput).toBe(64_000);
  });

  it("falls back when top_provider is absent", () => {
    const gemini = drafts.get("gemini-4-flash-preview")!;
    expect(gemini.model.contextWindow).toBe(1_048_576);
    expect(gemini.model.maxOutput).toBe(8_192);
  });
});

describe("pricing", () => {
  it("converts per-token USD to per-million", () => {
    expect(opus.model.pricing.inputPerM).toBe(5);
    expect(opus.model.pricing.outputPerM).toBe(25);
    expect(opus.model.pricing.cachedInputPerM).toBe(0.5);
  });

  it("omits cachedInputPerM when the provider does not cache", () => {
    expect(llama.model.pricing.cachedInputPerM).toBeUndefined();
  });

  it("never produces NaN", () => {
    for (const d of drafts.values()) {
      expect(Number.isFinite(d.model.pricing.inputPerM)).toBe(true);
      expect(Number.isFinite(d.model.pricing.outputPerM)).toBe(true);
    }
  });
});

describe("license and access", () => {
  it("treats a hugging_face_id as open weights", () => {
    expect(deepseek.model.license).toBe("open");
    expect(opus.model.license).toBe("proprietary");
  });

  // The adapter no longer stamps `access` — freeness is derived from the routes
  // by `lib/catalog/availability.ts`, so these assert the derivation instead.
  it("never writes the legacy access field", () => {
    for (const d of drafts.values()) expect(d.model.access).toBeUndefined();
  });

  it("is strict by default: a paid model is byok even with open weights", () => {
    expect(modelAccess(opus.model)).toBe("byok");
    expect(drafts.get("glm-5-turbo")!.model.license).toBe("open");
    expect(modelAccess(drafts.get("glm-5-turbo")!.model)).toBe("byok");
  });

  it("treats a genuinely zero-priced model as free", () => {
    expect(modelAccess(llama.model)).toBe("free");
  });

  it("honours the open-weight price ceiling when the operator raises it", () => {
    // The ceiling is now a read-time input (`RouteEnv.freeCeilingPerM`) rather
        // than something baked into the draft, so raising it needs no resync.
    const glm = drafts.get("glm-5-turbo")!.model;
    const env = { configured: ["openrouter"] as const, freeCeilingPerM: 1.5 };
    // GLM Turbo blends to (0.6*3 + 2.2)/4 = 1.0 /Mtok — under the ceiling.
    expect(routeCost(glm.routes[0], glm, env)).toBe("free");
    // Opus blends to 10 /Mtok and is closed weights — still metered.
    const opusModel = drafts.get("claude-opus-5")!.model;
    expect(routeCost(opusModel.routes[0], opusModel, env)).toBe("metered");
  });
});

describe(":free variant folding", () => {
  it("does not create a second catalog entry", () => {
    expect([...drafts.keys()].filter((id) => id.includes("deepseek"))).toEqual(["deepseek-v4-pro"]);
  });

  it("prepends the free route so failover prefers it", () => {
    expect(deepseek.model.routes).toEqual([
      { provider: "openrouter", model: "deepseek/deepseek-v4-pro:free" },
      { provider: "openrouter", model: "deepseek/deepseek-v4-pro" },
    ]);
  });

  it("derives free access from the :free route while keeping the paid list price", () => {
    expect(modelAccess(deepseek.model)).toBe("free");
    expect(deepseek.model.pricing.inputPerM).toBe(0.4);
  });
});

describe("status", () => {
  it("marks a near-term expiration_date as deprecated", () => {
    expect(drafts.get("laguna-m-1")!.model.status).toBe("deprecated");
  });

  it("ignores a far-future sentinel expiry", () => {
    expect(drafts.get("glm-5-turbo")!.model.status).toBe("ga");
  });

  it("marks preview builds", () => {
    expect(drafts.get("gemini-4-flash-preview")!.model.status).toBe("preview");
  });

  it("never synthesizes upcoming — a listed model is by definition servable", () => {
    for (const d of drafts.values()) {
      expect(d.model.status).not.toBe("upcoming");
    }
  });
});

describe("benchmarks", () => {
  it("maps the Artificial Analysis indices", () => {
    const byKey = new Map(opus.model.benchmarks.map((b) => [b.key, b.score]));
    expect(byKey.get("aa-intelligence")).toBe(60.7);
    expect(byKey.get("aa-coding")).toBe(78);
    expect(byKey.get("aa-agentic")).toBe(55.3);
  });

  it("keeps Design Arena Elo out of the LMSYS arena key", () => {
    const byKey = new Map(opus.model.benchmarks.map((b) => [b.key, b.score]));
    // Highest of the two arena rows.
    expect(byKey.get("design-arena")).toBe(1390);
    expect(byKey.has("arena")).toBe(false);
  });

  it("attributes every score", () => {
    for (const b of opus.model.benchmarks) {
      expect(b.source).toBeTruthy();
      expect(b.sourceUrl).toMatch(/^https:\/\//);
      expect(b.measuredAt).toBe(TODAY);
    }
  });

  it("emits nothing when the provider reports nothing", () => {
    expect(llama.model.benchmarks).toEqual([]);
  });
});

describe("blurb and tags", () => {
  it("clamps the description and unwraps links", () => {
    expect(opus.model.blurb).not.toContain("[");
    expect(opus.model.blurb.length).toBeLessThanOrEqual(181);
  });

  it("falls back when the provider gives no description", () => {
    expect(drafts.get("experimental-8b")!.model.blurb).toContain("Experimental 8B");
  });

  it("derives tags from capabilities and benchmark strength", () => {
    expect(opus.model.tags).toContain("reasoning");
    expect(opus.model.tags).toContain("vision");
    expect(opus.model.tags).toContain("tools");
    expect(opus.model.tags).toContain("coding"); // coding_index 78 ≥ 50
    expect(opus.model.tags).toContain("agentic"); // agentic_index 55.3 ≥ 50
    expect(deepseek.model.tags).toContain("open");
  });
});

describe("draft shape", () => {
  it("marks OpenRouter metadata as verified", () => {
    for (const d of drafts.values()) {
      expect(d.model.metaConfidence).toBe("verified");
      expect(d.sourceProviders).toEqual(["openrouter"]);
    }
  });

  it("always produces at least one route", () => {
    for (const d of drafts.values()) {
      expect(d.model.routes.length).toBeGreaterThan(0);
      for (const r of d.model.routes) expect(r.model).toBeTruthy();
    }
  });
});
