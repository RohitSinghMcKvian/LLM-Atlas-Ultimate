import type { ProviderId } from "./types";

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
  accent: "cyan" | "violet" | "amber" | "blue" | "orange";
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
    accent: "cyan",
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
    accent: "violet",
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
    accent: "amber",
    billing: "operator-funded",
  },
};

export const PROVIDER_LIST = Object.values(PROVIDERS);
