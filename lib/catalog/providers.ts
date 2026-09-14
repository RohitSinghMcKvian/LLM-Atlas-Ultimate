import type { ProviderId } from "./types";

/**
 * Which of a provider's routes fall inside its free allowance.
 *
 * Three shapes, because the three real-world mechanisms genuinely differ:
 * a whole free tier (Groq), a marked variant of an otherwise paid model
 * (OpenRouter's `:free` suffix), or a named handful (Z.ai frees only its Flash
 * models — GLM-5.1 on the same key is billed).
 */
export type FreeScope =
  | { kind: "all" }
  | { kind: "suffix"; suffix: string }
  | { kind: "models"; ids: readonly string[] };

/**
 * The provider's own free tier — what *anyone's* key gets, operator or user.
 *
 * Distinct from `ProviderMeta.billing`, which answers the narrower question of
 * whether the operator's env key is expected to cost them nothing. A provider
 * can be `metered` overall and still have a free tier (OpenRouter), and can be
 * `operator-funded` and have per-model limits worth showing (Groq).
 */
export interface FreeTier {
  scope: FreeScope;
  quota: {
    /**
     * LOAD-BEARING for honesty.
     *
     * `"recurring"` — free forever within the limits below. Only this counts as
     * free in `routeCost`.
     * `"grant"` — a finite or expiring allowance (signup credits, a trial, a
     * one-off token grant). Surfaced as "Credits", never as "Free": a badge
     * that expires is the same class of lie the availability module exists to
     * prevent.
     */
    kind: "recurring" | "grant";
    rpm?: number;
    rpd?: number;
    tpm?: number;
    tpd?: number;
    tpMonth?: number;
    creditsUsd?: number;
  };
  /** Where a user goes to get a key. Deep-linked from the connect flow. */
  signupUrl: string;
  cardRequired: boolean;
  /** Whether the free tier is paid for with the user's data. */
  dataSharing?: "none" | "optional" | "required";
  /** One line shown verbatim in the connect UI. */
  note?: string;
}

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  short: string;
  about: string;
  /** Default OpenAI-compatible base URL. */
  defaultBaseUrl: string;
  /** Env var holding the API key (empty for keyless local). */
  apiKeyEnv: string;
  docsUrl: string;
  /** Console page where a user creates their own key, for the connect flow. */
  consoleUrl?: string;
  /** Expected prefix of a valid key, used to sanity-check a paste. */
  keyPrefix?: string;
  /** The provider's own free tier, if it has one. */
  freeTier?: FreeTier;
  /**
   * Wire protocol. Absent means `"openai"` — every provider here speaks
   * OpenAI-compatible `/chat/completions` except Anthropic, whose Messages API
   * differs in auth header, body shape and SSE frame names. See
   * `lib/router/protocol.ts`.
   */
  protocol?: "openai" | "anthropic";
  /**
   * Tint band. Names are legacy labels over the elevation ramp; with more
   * providers than bands they necessarily repeat, which is fine — the band
   * distinguishes adjacent rows, it does not identify a provider.
   */
  accent: "ridge" | "shelf" | "upland" | "blue" | "orange";
  /**
   * Who pays, at point of use.
   *
   * `"operator-funded"` — the operator's key covers it, so it is free to the
   * end user. Every provider here either has a genuinely free tier (NVIDIA NIM,
   * Google AI Studio, Groq) or runs on the user's own hardware (local).
   *
   * `"metered"` — billed per token against whoever's key is used. OpenRouter is
   * metered *as a provider*; its `:free` model variants are the exception and
   * are recognised by the route id, not by this field. See
   * `lib/catalog/availability.ts`.
   */
  billing: "operator-funded" | "metered";
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  nvidia: {
    id: "nvidia",
    name: "NVIDIA NIM",
    short: "NIM",
    about:
      "build.nvidia.com API catalog — Nemotron and a deep bench of open models on an OpenAI-compatible endpoint.",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyEnv: "NVIDIA_API_KEY",
    docsUrl: "https://build.nvidia.com/",
    consoleUrl: "https://build.nvidia.com/",
    keyPrefix: "nvapi-",
    freeTier: {
      scope: { kind: "all" },
      quota: { kind: "recurring", rpd: 1000 },
      signupUrl: "https://build.nvidia.com/",
      cardRequired: false,
      dataSharing: "none",
      note: "Free API credits on signup, no card. Hosts the widest open-model bench.",
    },
    accent: "ridge",
    billing: "operator-funded",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    short: "OR",
    about:
      "One key, hundreds of models across every major provider — ideal for multi-model fan-out.",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    docsUrl: "https://openrouter.ai/docs",
    consoleUrl: "https://openrouter.ai/keys",
    keyPrefix: "sk-or-",
    freeTier: {
      // The `:free` suffix marks a rate-limited free tier of an otherwise paid
      // model. It is an OpenRouter convention, which is why it lives here rather
      // than as a global rule — no other provider uses it.
      scope: { kind: "suffix", suffix: ":free" },
      quota: { kind: "recurring", rpm: 20, rpd: 50 },
      signupUrl: "https://openrouter.ai/keys",
      cardRequired: false,
      dataSharing: "none",
      note: "50 req/day on :free models, rising to 1 000 after a one-time $10 top-up.",
    },
    accent: "shelf",
    billing: "metered",
  },
  google: {
    id: "google",
    name: "Google AI Studio",
    short: "AIS",
    about:
      "Gemini API via Google AI Studio — the Gemini and Gemma families on Google's own OpenAI-compatible endpoint.",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GOOGLE_API_KEY",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    consoleUrl: "https://aistudio.google.com/apikey",
    freeTier: {
      scope: { kind: "all" },
      quota: { kind: "recurring", rpm: 15, rpd: 1500 },
      signupUrl: "https://aistudio.google.com/apikey",
      cardRequired: false,
      // Google trains on free-tier prompts outside the EU, UK and EEA.
      dataSharing: "required",
      note: "Free tier prompts may be used to improve Google's models outside the EU/UK/EEA.",
    },
    accent: "blue",
    billing: "operator-funded",
  },
  groq: {
    id: "groq",
    name: "Groq",
    short: "Groq",
    about:
      "LPU-accelerated inference — Llama, Qwen and GPT-OSS at extreme throughput on an OpenAI-compatible endpoint.",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    docsUrl: "https://console.groq.com/docs",
    consoleUrl: "https://console.groq.com/keys",
    keyPrefix: "gsk_",
    freeTier: {
      scope: { kind: "all" },
      quota: { kind: "recurring", rpm: 30, rpd: 1000, tpm: 30_000 },
      signupUrl: "https://console.groq.com/keys",
      cardRequired: false,
      dataSharing: "none",
      note: "Free forever, no card. The fastest free lane by a wide margin.",
    },
    accent: "orange",
    billing: "operator-funded",
  },
  local: {
    id: "local",
    name: "Local",
    short: "Local",
    about:
      "Ollama / vLLM / llama.cpp on your own machine — fully offline, no cloud key required.",
    defaultBaseUrl: "http://localhost:11434/v1",
    apiKeyEnv: "LOCAL_API_KEY",
    docsUrl: "https://ollama.com",
    accent: "upland",
    billing: "operator-funded",
  },

  // ── First-party lanes with a genuinely recurring free tier ────────────────
  zai: {
    id: "zai",
    name: "Z.ai",
    short: "Z.ai",
    about:
      "Zhipu's GLM family. The Flash models are free outright; the flagship GLM tiers are billed on the same key.",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    apiKeyEnv: "ZAI_API_KEY",
    docsUrl: "https://docs.z.ai/",
    consoleUrl: "https://z.ai/manage-apikey/apikey-list",
    freeTier: {
      // The reason `FreeScope` has a `models` variant at all: free-ness here is
      // per-model, not per-provider. GLM-5.1 on this very key is billed.
      scope: {
        kind: "models",
        ids: ["glm-4.7-flash", "glm-4.5-flash", "glm-4.6v-flash"],
      },
      quota: { kind: "recurring", rpd: 1000, rpm: 60 },
      signupUrl: "https://z.ai/manage-apikey/apikey-list",
      cardRequired: false,
      dataSharing: "none",
      note: "GLM Flash models are free with no expiry. Other GLM tiers are billed.",
    },
    accent: "shelf",
    billing: "metered",
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    short: "Mistral",
    about:
      "Mistral's own API — Mistral Large/Small, Codestral and the Magistral reasoning line.",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    docsUrl: "https://docs.mistral.ai/",
    consoleUrl: "https://console.mistral.ai/api-keys",
    freeTier: {
      scope: { kind: "all" },
      quota: { kind: "recurring", tpMonth: 1_000_000_000, rpm: 60 },
      signupUrl: "https://console.mistral.ai/api-keys",
      cardRequired: false,
      // The Experiment tier's quota is contingent on opting into training.
      dataSharing: "required",
      note: "~1B tokens/month, but only if you opt into training on your prompts.",
    },
    accent: "orange",
    billing: "metered",
  },

  // ── First-party lanes whose "free" is a finite or expiring grant ──────────
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    short: "DS",
    about:
      "DeepSeek's own API — V-series chat and the R-series reasoners, with off-peak discounts.",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    docsUrl: "https://api-docs.deepseek.com/",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    keyPrefix: "sk-",
    freeTier: {
      scope: { kind: "all" },
      // A one-off token grant on a new account. Every DeepSeek `:free` variant
      // on OpenRouter went paid mid-2026, so this is the remaining free-ish lane.
      quota: { kind: "grant", tpMonth: 5_000_000 },
      signupUrl: "https://platform.deepseek.com/api_keys",
      cardRequired: false,
      dataSharing: "none",
      note: "New accounts get a one-time token grant. Not a recurring free tier.",
    },
    accent: "blue",
    billing: "metered",
  },
  xai: {
    id: "xai",
    name: "xAI",
    short: "xAI",
    about: "Grok, direct from xAI's own OpenAI-compatible endpoint.",
    defaultBaseUrl: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    docsUrl: "https://docs.x.ai/",
    consoleUrl: "https://console.x.ai",
    keyPrefix: "xai-",
    freeTier: {
      scope: { kind: "all" },
      quota: { kind: "grant", creditsUsd: 25 },
      signupUrl: "https://console.x.ai",
      cardRequired: false,
      // The larger monthly credit is contingent on sharing API traffic for
      // training, which is a real cost to anyone handling confidential prompts.
      dataSharing: "optional",
      note: "$25 signup credit, plus a larger monthly grant if you opt into data sharing.",
    },
    accent: "ridge",
    billing: "metered",
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    short: "CB",
    about: "Wafer-scale inference — open-weight models at very high token throughput.",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    docsUrl: "https://inference-docs.cerebras.ai/",
    consoleUrl: "https://cloud.cerebras.ai",
    keyPrefix: "csk-",
    freeTier: {
      scope: { kind: "all" },
      // Was a no-card 1M tokens/day tier; it is now a card-gated expiring trial.
      // Recording that honestly is the whole point of `kind: "grant"`.
      quota: { kind: "grant", creditsUsd: 5 },
      signupUrl: "https://cloud.cerebras.ai",
      cardRequired: true,
      dataSharing: "none",
      note: "Trial credits that expire, and a card is required to activate them.",
    },
    accent: "upland",
    billing: "metered",
  },
  dashscope: {
    id: "dashscope",
    name: "Alibaba DashScope",
    short: "DASH",
    about:
      "Qwen, first-party via Alibaba Cloud's Model Studio OpenAI-compatible endpoint.",
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    docsUrl: "https://www.alibabacloud.com/help/en/model-studio/",
    consoleUrl: "https://bailian.console.alibabacloud.com/",
    keyPrefix: "sk-",
    freeTier: {
      scope: { kind: "all" },
      // Per-model free quota with a validity window — generous, but it expires,
      // so it is a grant. Qwen's own OAuth free tier was discontinued 2026-04-15;
      // this and the open-weight hosts are what remain.
      quota: { kind: "grant", tpMonth: 1_000_000 },
      signupUrl: "https://bailian.console.alibabacloud.com/",
      cardRequired: false,
      dataSharing: "none",
      note: "Per-model free quota for new accounts, valid for a limited period.",
    },
    accent: "blue",
    billing: "metered",
  },

  // ── First-party lanes with no free tier at all ────────────────────────────
  // Present so a user can bring their own paid key. They carry no `freeTier`,
  // so `routeCost` can only ever call them metered — which is the honest answer
  // and the one the picker will show.
  openai: {
    id: "openai",
    name: "OpenAI",
    short: "OAI",
    about:
      "OpenAI's own API. No free tier — the open-weight gpt-oss models are the free lane, and they run on NVIDIA, Groq and Cerebras.",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    docsUrl: "https://platform.openai.com/docs",
    consoleUrl: "https://platform.openai.com/api-keys",
    keyPrefix: "sk-",
    accent: "upland",
    billing: "metered",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    short: "ANT",
    about:
      "Claude, direct from Anthropic. No free tier exists, and routing a Claude Pro/Max subscription through a third party is not permitted — a paid API key is the only supported route.",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    docsUrl: "https://docs.anthropic.com/",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    keyPrefix: "sk-ant-",
    // The one lane that is not OpenAI-shaped.
    protocol: "anthropic",
    accent: "ridge",
    billing: "metered",
  },
};

export const PROVIDER_LIST = Object.values(PROVIDERS);

/**
 * Does this provider's free tier cover this upstream model id?
 *
 * Only a `"recurring"` allowance answers true. A `"grant"` — signup credits, a
 * card-gated trial, a one-off token bundle — is real money that runs out, so it
 * must never reach `routeCost` as "free". Grants are surfaced as "Credits" in
 * the UI instead, where an expiry can be shown alongside.
 */
export function inFreeTier(tier: FreeTier | undefined, routeModel: string): boolean {
  if (!tier || tier.quota.kind !== "recurring") return false;
  switch (tier.scope.kind) {
    case "all":
      return true;
    case "suffix":
      return routeModel.endsWith(tier.scope.suffix);
    case "models":
      return tier.scope.ids.includes(routeModel);
  }
}

/** Providers whose free tier is a finite or expiring grant, for "Credits" badges. */
export function hasCreditGrant(meta: ProviderMeta): boolean {
  return meta.freeTier?.quota.kind === "grant";
}
