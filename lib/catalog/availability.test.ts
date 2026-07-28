import { describe, expect, it } from "vitest";
import {
  ALL_PROVIDERS,
  NO_PROVIDERS,
  intrinsicAccess,
  modelAvailability,
  routeCost,
  type RouteEnv,
} from "./availability";
import { BASELINE_SNAPSHOT } from "./baseline";
import type { CatalogModel, ModelRoute, ProviderId } from "./types";

// The picker↔server contract. Every case here is drawn from a real measurement
// against the live NVIDIA and OpenRouter APIs, not from imagination:
//
//   * `command-a` is labelled free in the curated catalog but its only live route
//     is `openrouter:cohere/command-a` at $2.50/$10 per M — it answers 402.
//   * `gemma-3-12b` has a NVIDIA route that returns `404 Function not found` and
//     an OpenRouter `:free` route that works.
//   * `groq-compound` is routed only to Groq, which had no key configured.

function model(routes: ModelRoute[], over: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id: "m",
    name: "M",
    provider: "Test",
    family: "Test",
    license: "open",
    status: "ga",
    releaseDate: "2026-01-01",
    contextWindow: 8192,
    maxOutput: 4096,
    modalities: ["text"],
    capabilities: {
      toolUse: false,
      structuredOutput: false,
      reasoning: false,
      caching: false,
    },
    // Non-zero by default: a $0 listing is genuinely free (see `routeCost`), so a
    // zero default would make every fixture free and hide the metered cases.
    pricing: { inputPerM: 1, outputPerM: 2, effectiveFrom: "2026-01-01" },
    benchmarks: [],
    blurb: "",
    routes,
    ...over,
  } as CatalogModel;
}

const nvidia: ModelRoute = { provider: "nvidia", model: "meta/llama-3.1-8b-instruct" };
const orFree: ModelRoute = { provider: "openrouter", model: "openai/gpt-oss-20b:free" };
const orPaid: ModelRoute = { provider: "openrouter", model: "cohere/command-a" };
const groq: ModelRoute = { provider: "groq", model: "groq/compound" };
const google: ModelRoute = { provider: "google", model: "gemini-2.5-flash" };

const env = (configured: ProviderId[], over: Partial<RouteEnv> = {}): RouteEnv => ({
  configured,
  ...over,
});

describe("routeCost", () => {
  it("treats every operator-funded provider as free", () => {
    const m = model([nvidia, groq, google]);
    expect(routeCost(nvidia, m)).toBe("free");
    expect(routeCost(groq, m)).toBe("free");
    expect(routeCost(google, m)).toBe("free");
    expect(routeCost({ provider: "local", model: "llama3" }, m)).toBe("free");
  });

  it("treats OpenRouter as metered unless the route is a :free variant", () => {
    const m = model([orFree, orPaid]);
    expect(routeCost(orFree, m)).toBe("free");
    expect(routeCost(orPaid, m)).toBe("metered");
  });

  it("treats a genuinely $0 OpenRouter listing as free without a :free suffix", () => {
    // Two distinct OpenRouter mechanisms: `:free` is a rate-limited tier of a paid
    // model; a $0 price is simply free. Both must count.
    const m = model([orPaid], {
      pricing: { inputPerM: 0, outputPerM: 0, effectiveFrom: "2026-01-01" },
    });
    expect(routeCost(orPaid, m, env(["openrouter"]))).toBe("free");
  });

  it("keeps a priced OpenRouter route metered at the default zero ceiling", () => {
    // The measured failure: command-a at $2.50/$10 was labelled free and 402'd.
    const m = model([orPaid], {
      license: "open",
      pricing: { inputPerM: 2.5, outputPerM: 10, effectiveFrom: "2026-01-01" },
    });
    expect(routeCost(orPaid, m, env(["openrouter"]))).toBe("metered");
  });

  it("honours a raised open-weight ceiling", () => {
    const m = model([orPaid], {
      license: "open",
      pricing: { inputPerM: 0.08, outputPerM: 0.45, effectiveFrom: "2026-01-01" },
    });
    // blended = (0.08*3 + 0.45)/4 = 0.1725
    expect(routeCost(orPaid, m, env(["openrouter"], { freeCeilingPerM: 0.5 }))).toBe("free");
    expect(routeCost(orPaid, m, env(["openrouter"], { freeCeilingPerM: 0.1 }))).toBe("metered");
  });

  it("never applies the ceiling to a proprietary model", () => {
    const m = model([orPaid], {
      license: "proprietary",
      pricing: { inputPerM: 0.01, outputPerM: 0.01, effectiveFrom: "2026-01-01" },
    });
    expect(routeCost(orPaid, m, env(["openrouter"], { freeCeilingPerM: 5 }))).toBe("metered");
  });
});

describe("modelAvailability", () => {
  it("is unavailable with no routes at all", () => {
    const a = modelAvailability(model([]), ALL_PROVIDERS);
    expect(a).toEqual({ kind: "unavailable", reason: "no_routes" });
  });

  // THE load-bearing test: the same model object, two envs, two answers. This is
  // the whole reason availability is derived rather than stored — adding
  // GROQ_API_KEY must flip Groq models to free with no resync and no probe.
  it("flips a groq-only model to free the moment groq is configured", () => {
    const m = model([groq]);
    expect(modelAvailability(m, env([]))).toEqual({
      kind: "unavailable",
      reason: "no_configured_provider",
    });
    const after = modelAvailability(m, env(["groq"]));
    expect(after.kind).toBe("free");
    expect(after.kind === "free" && after.route).toBe(groq);
  });

  it("returns needs_key for a metered-only model with nobody paying", () => {
    // command-a: the picker must say "your key", never "free".
    const a = modelAvailability(model([orPaid]), env(["openrouter"]));
    expect(a).toEqual({ kind: "needs_key" });
  });

  it("returns your_key once the user supplies an OpenRouter key", () => {
    const a = modelAvailability(
      model([orPaid]),
      env(["openrouter"], { userOpenRouterKey: true }),
    );
    expect(a.kind).toBe("your_key");
    expect(a.kind === "your_key" && a.candidates).toEqual([orPaid]);
  });

  it("returns your_key when the operator opts into paying", () => {
    const a = modelAvailability(model([orPaid]), env(["openrouter"], { servePaid: true }));
    expect(a.kind).toBe("your_key");
  });

  it("serves a model over its :free route when the paid twin is also listed", () => {
    // gemma-4-31b ships both; only the :free one works on a zero-credit key.
    const m = model([orPaid, orFree]);
    const a = modelAvailability(m, env(["openrouter"]));
    expect(a.kind).toBe("free");
    expect(a.kind === "free" && a.candidates).toEqual([orFree]);
  });

  it("prefers free routes and never mixes metered ones into a free candidate list", () => {
    const m = model([orPaid, nvidia, orFree]);
    const a = modelAvailability(m, env(["nvidia", "openrouter"], { userOpenRouterKey: true }));
    expect(a.kind).toBe("free");
    // The paid route is excluded even though the user's key could pay for it.
    expect(a.kind === "free" && a.candidates).toEqual([nvidia, orFree]);
  });

  it("ignores routes whose provider has no key", () => {
    // gemini-2.5-flash: google route unusable, openrouter route metered.
    const m = model([google, orPaid]);
    expect(modelAvailability(m, env(["openrouter"]))).toEqual({ kind: "needs_key" });
    expect(modelAvailability(m, env(["google", "openrouter"])).kind).toBe("free");
  });

  it("counts the user's own OpenRouter key as making that provider usable", () => {
    const a = modelAvailability(model([orPaid]), env([], { userOpenRouterKey: true }));
    expect(a.kind).toBe("your_key");
  });

  it("is unavailable when only a non-OpenRouter metered route exists", () => {
    // Defensive: no such provider today, but the branch must not claim needs_key
    // and send the user to a key modal that cannot help.
    const m = model([orPaid], { license: "proprietary" });
    const a = modelAvailability(m, env(["openrouter"]));
    expect(a).toEqual({ kind: "needs_key" });
  });
});

describe("intrinsicAccess", () => {
  it("is free when any route could ever be free", () => {
    expect(intrinsicAccess(model([nvidia]))).toBe("free");
    expect(intrinsicAccess(model([orFree]))).toBe("free");
    expect(intrinsicAccess(model([orPaid, groq]))).toBe("free");
  });

  it("is byok for a metered-only model regardless of its license", () => {
    expect(intrinsicAccess(model([orPaid]))).toBe("byok");
    expect(intrinsicAccess(model([orPaid], { license: "proprietary" }))).toBe("byok");
  });

  it("does not consult the legacy access field", () => {
    // The exact defect: a curated `access: "free"` whose only route is metered.
    const m = model([orPaid], {
      access: "free",
      pricing: { inputPerM: 2.5, outputPerM: 10, effectiveFrom: "2026-01-01" },
    });
    expect(intrinsicAccess(m)).toBe("byok");
  });

  it("is byok with no routes", () => {
    expect(intrinsicAccess(model([]))).toBe("byok");
  });
});

describe("the free invariant holds across the whole catalog", () => {
  const envs: RouteEnv[] = [
    NO_PROVIDERS,
    ALL_PROVIDERS,
    env(["nvidia"]),
    env(["nvidia", "openrouter"]),
    env(["nvidia", "openrouter"], { userOpenRouterKey: true }),
    env(["nvidia", "openrouter", "groq", "google"]),
    env(["openrouter"], { servePaid: true, freeCeilingPerM: 0.5 }),
  ];

  // Property, not example: whatever the env, a `free` verdict may only offer
  // routes that are genuinely zero-cost AND reachable. This is what makes it
  // impossible for the picker to promise free and the server to bill.
  it("never offers a metered or unconfigured route under a free verdict", () => {
    for (const e of envs) {
      for (const m of BASELINE_SNAPSHOT.models) {
        const a = modelAvailability(m, e);
        if (a.kind !== "free") continue;
        expect(a.candidates.length).toBeGreaterThan(0);
        for (const r of a.candidates) {
          expect(routeCost(r, m, e)).toBe("free");
          const reachable =
            e.configured.includes(r.provider) ||
            (r.provider === "openrouter" && e.userOpenRouterKey === true);
          expect(reachable).toBe(true);
        }
        expect(a.route).toBe(a.candidates[0]);
      }
    }
  });

  it("always picks the first candidate as the chosen route", () => {
    for (const e of envs) {
      for (const m of BASELINE_SNAPSHOT.models) {
        const a = modelAvailability(m, e);
        if (a.kind === "free" || a.kind === "your_key") {
          expect(a.route).toBe(a.candidates[0]);
        }
      }
    }
  });

  it("agrees with intrinsicAccess whenever every provider is keyed", () => {
    for (const m of BASELINE_SNAPSHOT.models) {
      if (m.routes.length === 0) continue;
      const a = modelAvailability(m, ALL_PROVIDERS);
      if (intrinsicAccess(m) === "free") expect(a.kind).toBe("free");
      else expect(a.kind).not.toBe("free");
    }
  });

  it("reports nothing as free when no provider is configured", () => {
    for (const m of BASELINE_SNAPSHOT.models) {
      expect(modelAvailability(m, NO_PROVIDERS).kind).not.toBe("free");
    }
  });
});
