import { describe, it, expect } from "vitest";
import { modelAccess } from "../stats";
import { NVIDIA_SAMPLE } from "./__fixtures__/providers";
import {
  NON_CHAT_PATTERNS,
  NON_CHAT_RULES,
  draftFromNvidiaId,
  isChatCapable,
  normalizeNvidia,
} from "./nvidia";

const TODAY = "2026-07-25";

const { chat, excluded } = normalizeNvidia(NVIDIA_SAMPLE);

describe("non-chat filtering", () => {
  it("excludes every embedding, reranker, guardrail, and speech endpoint", () => {
    expect(excluded.sort()).toEqual(
      [
        "baai/bge-m3",
        "meta/llama-guard-4-12b",
        "nvidia/embed-qa-4",
        "nvidia/llama-3.1-nemoguard-8b-content-safety",
        "nvidia/llama-3.1-nemoguard-8b-topic-control",
        "nvidia/llama-3.1-nemotron-safety-guard-8b-v3",
        "nvidia/llama-3.2-nv-embedqa-1b-v1",
        "nvidia/nemoretriever-parse",
        "nvidia/nemotron-3-embed-1b",
        "nvidia/nemotron-3.5-content-safety",
        "nvidia/nv-embedqa-e5-v5",
        "nvidia/nv-rerankqa-mistral-4b-v3",
        "nvidia/nvclip",
        "nvidia/riva-translate-4b-instruct",
        "snowflake/arctic-embed-l",
      ].sort(),
    );
  });

  it("keeps the chat models", () => {
    expect(chat.map((m) => m.id).sort()).toEqual([
      "databricks/dbrx-instruct",
      "meta/llama-3.3-70b-instruct",
      "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      "qwen/qwen2.5-vl-7b-instruct",
    ]);
  });

  it("keeps every denylist pattern load-bearing", () => {
    // A pattern that no longer matches its own documented example is dead weight
    // that will quietly stop protecting the catalog.
    for (const { pattern, example } of NON_CHAT_RULES) {
      expect(pattern.test(example), `pattern ${pattern} no longer matches ${example}`).toBe(true);
      expect(isChatCapable(example), `${example} should be excluded`).toBe(false);
    }
  });

  it("has no redundant patterns", () => {
    // Two patterns doing the same job means one of them is untested in practice.
    for (const { pattern, example } of NON_CHAT_RULES) {
      const others = NON_CHAT_PATTERNS.filter((p) => p !== pattern);
      expect(
        others.some((p) => p.test(example)),
        `${pattern} is fully covered by another pattern`,
      ).toBe(false);
    }
  });

  it("does not exclude a legitimate chat model", () => {
    for (const id of [
      "meta/llama-3.3-70b-instruct",
      "deepseek-ai/deepseek-r1",
      "nvidia/nemotron-3-ultra-550b",
      "openai/gpt-oss-120b",
      "mistralai/mistral-large-3-675b-instruct-2512",
      "qwen/qwen3-235b-a22b",
    ]) {
      expect(isChatCapable(id), id).toBe(true);
    }
  });
});

describe("draftFromNvidiaId", () => {
  const nemotron = draftFromNvidiaId(
    { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5", owned_by: "nvidia", created: 735_790_403 },
    { today: TODAY },
  )!;
  const vision = draftFromNvidiaId(
    { id: "qwen/qwen2.5-vl-7b-instruct", owned_by: "qwen", created: 735_790_403 },
    { today: TODAY },
  )!;
  const unknown = draftFromNvidiaId(
    { id: "databricks/dbrx-instruct", owned_by: "databricks", created: 735_790_403 },
    { today: TODAY },
  )!;

  it("is free, open, and NIM-routed — the zero-config backbone", () => {
    for (const d of [nemotron, vision, unknown]) {
      expect(d.model.license).toBe("open");
      // Derived from the nvidia route, not stamped on the draft.
      expect(d.model.access).toBeUndefined();
      expect(modelAccess(d.model)).toBe("free");
      expect(d.model.pricing.inputPerM).toBe(0);
      expect(d.model.pricing.outputPerM).toBe(0);
      expect(d.model.routes).toEqual([{ provider: "nvidia", model: d.model.routes[0].model }]);
      expect(d.model.routes[0].provider).toBe("nvidia");
      expect(d.sourceProviders).toEqual(["nvidia"]);
    }
  });

  it("labels reconstructed metadata as derived, never verified", () => {
    // NIM returns only {id, object, created, owned_by} — presenting a guessed
    // context window as a measurement would be dishonest.
    for (const d of [nemotron, vision, unknown]) {
      expect(d.model.metaConfidence).toBe("derived");
    }
  });

  it("maps the brand from owned_by", () => {
    expect(nemotron.model.provider).toBe("NVIDIA");
    expect(vision.model.provider).toBe("Alibaba");
    expect(unknown.model.provider).toBe("Databricks");
  });

  it("reconstructs a readable name from the id", () => {
    expect(nemotron.model.name).toBe("Llama 3.3 Nemotron Super 49B V1.5");
    expect(unknown.model.name).toBe("Dbrx Instruct");
  });

  it("derives a context window from the family table, with a floor", () => {
    expect(nemotron.model.contextWindow).toBe(131_072);
    expect(vision.model.contextWindow).toBe(32_768);
    // Unknown family falls back rather than claiming zero.
    expect(unknown.model.contextWindow).toBe(32_768);
    for (const d of [nemotron, vision, unknown]) {
      expect(d.model.contextWindow).toBeGreaterThan(0);
      expect(d.model.maxOutput).toBeGreaterThan(0);
      expect(d.model.maxOutput).toBeLessThanOrEqual(d.model.contextWindow);
    }
  });

  it("detects vision from the id", () => {
    expect(vision.model.modalities).toEqual(["text", "vision"]);
    expect(nemotron.model.modalities).toEqual(["text"]);
  });

  it("detects reasoning models from the id", () => {
    const r1 = draftFromNvidiaId({ id: "deepseek-ai/deepseek-r1", owned_by: "deepseek-ai" }, { today: TODAY })!;
    const qwq = draftFromNvidiaId({ id: "qwen/qwq-32b", owned_by: "qwen" }, { today: TODAY })!;
    expect(r1.model.capabilities.reasoning).toBe(true);
    expect(qwq.model.capabilities.reasoning).toBe(true);
    expect(unknown.model.capabilities.reasoning).toBe(false);
  });

  it("claims no capability it cannot confirm or infer", () => {
    expect(nemotron.model.capabilities.structuredOutput).toBe(false);
    expect(nemotron.model.capabilities.caching).toBe(false);
  });

  // `toolUse` used to be a flat `false` here, on the grounds that NIM does not
  // report per-model tool support. That was honest about the badge and wrong
  // about everything downstream: the chat client read the same field as a gate,
  // so every NIM-synced model without a hand-curated twin ran as a single-shot
  // completion with the agent loop off — the default path for the free catalog.
  //
  // It is now a family hint. `metaConfidence` stays "derived", so a curated
  // entry still wins in merge.ts, and a wrong optimistic guess costs one
  // downgraded round trip that lib/router/index.ts recovers from.
  it("infers tool use for instruction-tuned families that support it", () => {
    for (const id of [
      "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      "meta/llama-3.1-8b-instruct",
      "qwen/qwen2.5-7b-instruct",
      "mistralai/mixtral-8x22b-instruct-v0.1",
      "deepseek-ai/deepseek-v3",
      "openai/gpt-oss-120b",
      "google/gemma-3-27b-it",
    ]) {
      const d = draftFromNvidiaId({ id, owned_by: id.split("/")[0] }, { today: TODAY })!;
      expect(d.model.capabilities.toolUse, id).toBe(true);
    }
  });

  // The optimistic guess must not reach models that have no chat template at
  // all, or heads that are not chat models. The deny list is checked first, so
  // `llama-guard` does not inherit the `llama-3.1` verdict.
  it("withholds tool use from models that cannot have it", () => {
    for (const id of [
      "meta/llama-guard-3-8b",
      "nvidia/nv-embedqa-e5-v5",
      "nvidia/nemoretriever-parse",
      "baai/bge-reranker",
      "qwen/qwen2.5-vl-7b-instruct",
      "databricks/dbrx-instruct",
    ]) {
      const d = draftFromNvidiaId({ id, owned_by: id.split("/")[0] }, { today: TODAY })!;
      expect(d.model.capabilities.toolUse, id).toBe(false);
    }
  });

  it("ignores NIM's nonsense created timestamp", () => {
    // Every NIM entry reports created ≈ 1993.
    expect(nemotron.model.releaseDate).toBe(TODAY);
  });

  it("produces url-safe ids", () => {
    for (const d of [nemotron, vision, unknown]) {
      expect(d.atlasId).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it("returns null for an unusable id", () => {
    expect(draftFromNvidiaId({ id: "///" }, { today: TODAY })).toBeNull();
  });
});

describe("normalizeNvidia", () => {
  it("skips malformed entries", () => {
    const { chat: out } = normalizeNvidia([
      { id: "" },
      { id: "meta/llama-3.3-70b-instruct" },
    ] as Parameters<typeof normalizeNvidia>[0]);
    expect(out.map((m) => m.id)).toEqual(["meta/llama-3.3-70b-instruct"]);
  });
});
