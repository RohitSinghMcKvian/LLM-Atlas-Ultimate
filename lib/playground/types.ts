// Atlas Playground domain types (§5). A "config" is everything needed to
// reproduce a run: conversation turns, parameters, models, tools, and template
// variable values. Runs capture real per-model metrics from the typed event
// stream (TTFT, tok/s, usage, cost, finish reason).

export interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface PlaygroundParams {
  temperature: number;
  topP: number;
  /** 0 = provider default (omitted from the request). */
  topK: number;
  maxTokens: number;
  stop: string[];
  /** Empty string = no fixed seed. */
  seed: string;
  frequencyPenalty: number;
  presencePenalty: number;
  /** "off" = omit from request. */
  reasoningEffort: "off" | "low" | "medium" | "high";
  /** response_format: json_object. */
  jsonMode: boolean;
}

export interface PlaygroundConfig {
  system: string;
  turns: Turn[];
  params: PlaygroundParams;
  models: string[];
  /** Raw JSON text of an OpenAI-style tools array; "" = none. */
  toolsJson: string;
  /** Values for {{variables}} detected in system/turns. */
  variables: Record<string, string>;
}

export interface RunMetrics {
  ttftMs?: number;
  totalMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  /** Completion tokens per second of generation (post-first-token). */
  tps?: number;
  costUsd?: number;
  finishReason?: string;
  provider?: string;
}

export interface RunToolCall {
  id: string;
  name: string;
  arguments?: string;
}

/** One saved model run (history). Mirrors playground_runs when Supabase is on. */
export interface RunRecord {
  id: string;
  modelId: string;
  output: string;
  reasoning?: string;
  toolCalls?: RunToolCall[];
  error?: string;
  metrics: RunMetrics;
  /** Config snapshot used to produce this run. */
  config: PlaygroundConfig;
  starred: boolean;
  note?: string;
  createdAt: number;
}

/** A named, reusable config. Mirrors playground_experiments when Supabase is on. */
export interface Preset {
  id: string;
  name: string;
  config: PlaygroundConfig;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_PARAMS: PlaygroundParams = {
  temperature: 0.7,
  topP: 1,
  topK: 0,
  maxTokens: 1024,
  stop: [],
  seed: "",
  frequencyPenalty: 0,
  presencePenalty: 0,
  reasoningEffort: "off",
  jsonMode: false,
};

export const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function defaultConfig(): PlaygroundConfig {
  return {
    system: "You are a concise, helpful assistant.",
    turns: [
      {
        id: uuid(),
        role: "user",
        content:
          "Explain what a context window is to a new developer, in 3 sentences.",
      },
    ],
    params: { ...DEFAULT_PARAMS },
    models: ["deepseek-v4-pro", "llama-3-3-70b"],
    toolsJson: "",
    variables: {},
  };
}

/**
 * Parse + validate the tools JSON. Returns the parsed array, or an error
 * string, or null when the field is empty.
 */
export function parseTools(
  toolsJson: string,
): { tools: any[] } | { error: string } | null {
  const raw = toolsJson.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const t of arr) {
      if (t?.type !== "function" || typeof t?.function?.name !== "string") {
        return {
          error:
            'Each tool needs {"type":"function","function":{"name":…}} (OpenAI format).',
        };
      }
    }
    return { tools: arr };
  } catch (e) {
    return { error: `Invalid JSON: ${(e as Error).message}` };
  }
}

export const EXAMPLE_TOOLS = JSON.stringify(
  [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a city.",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name" },
            unit: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["city"],
        },
      },
    },
  ],
  null,
  2,
);
