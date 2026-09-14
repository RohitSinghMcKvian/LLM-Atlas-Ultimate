import type { ModelRoute } from "@/lib/catalog/types";
import type { ChatContentPart, ChatMessage, StreamParams } from "./index";

// Wire-protocol translation, so the router's streaming loop only has to know one
// shape.
//
// Every provider Atlas dials speaks OpenAI-compatible `/chat/completions` except
// Anthropic, whose Messages API differs in endpoint, auth header, body shape and
// SSE frame names. The obvious way to support it — branch inside
// `streamChatEvents` — would put a second control flow through the work queue,
// the timeout tiers, tool accumulation and the BARREN check, which is where all
// the hard-won behaviour lives.
//
// So this module translates at the two edges instead:
//
//   * `endpointFor` / `buildAnthropicBody` shape the request on the way out.
//   * `normalizeFrame` rewrites each inbound SSE frame into the OpenAI chunk
//     shape on the way in.
//
// The parsing loop is then completely unaware there is more than one protocol,
// and for OpenAI `normalizeFrame` is the identity — so the path that carries
// every existing model is byte-for-byte what it was.

export type WireProtocol = "openai" | "anthropic";

/** Anthropic pins its API shape to a dated version. */
const ANTHROPIC_VERSION = "2023-06-01";

/** The auth and versioning headers a protocol requires. */
export function protocolHeaders(
  protocol: WireProtocol,
  apiKey: string | undefined,
): Record<string, string> {
  if (protocol === "anthropic") {
    // Anthropic does not use `Authorization: Bearer`.
    return apiKey
      ? { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION }
      : { "anthropic-version": ANTHROPIC_VERSION };
  }
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/**
 * The streaming chat endpoint for a protocol.
 *
 * Anthropic's base URL is written both ways in the wild — `https://api.anthropic.com`
 * and `https://api.anthropic.com/v1` — so the version segment is normalised
 * rather than assumed. This is not hypothetical: **`ANTHROPIC_BASE_URL` is
 * already a well-known variable** (the Anthropic SDK and Claude Code both read
 * it, usually set to the bare root). Atlas resolves base URLs as
 * `process.env[`${ID}_BASE_URL`]`, so an unrelated tool's setting silently
 * becomes Atlas's, and appending `/messages` to the root yields a 404. Accepting
 * both spellings makes that collision harmless instead of mystifying.
 */
export function endpointFor(protocol: WireProtocol, baseUrl: string): string {
  if (protocol !== "anthropic") return `${baseUrl}/chat/completions`;
  const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${root}/v1/messages`;
}

/**
 * The model-listing endpoint, normalised the same way as `endpointFor`.
 *
 * The catalog sync discovers routes from these listings, so it inherits the
 * `ANTHROPIC_BASE_URL` hazard described above verbatim.
 */
export function modelsEndpointFor(protocol: WireProtocol, baseUrl: string): string {
  if (protocol !== "anthropic") return `${baseUrl}/models`;
  const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${root}/v1/models`;
}

// ── Request: OpenAI-shaped params → Anthropic Messages body ─────────────────

type AnthropicPart =
  | { type: "text"; text: string }
  | { type: "image"; source: Record<string, unknown> }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

/** `data:image/png;base64,AAA…` → Anthropic's base64 source block. */
function imageSource(url: string): Record<string, unknown> {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url);
  if (m) return { type: "base64", media_type: m[1], data: m[2] };
  // Anthropic also accepts a plain URL source.
  return { type: "url", url };
}

function toAnthropicParts(content: string | ChatContentPart[]): AnthropicPart[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const parts: AnthropicPart[] = [];
  for (const p of content) {
    if (p.type === "text" && p.text) parts.push({ type: "text", text: p.text });
    else if (p.type === "image_url" && p.image_url?.url) {
      parts.push({ type: "image", source: imageSource(p.image_url.url) });
    }
  }
  return parts;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicPart[];
}

/**
 * Fold OpenAI-shaped messages into Anthropic's.
 *
 * Three structural differences, each of which silently breaks a conversation if
 * missed:
 *
 *   1. `system` is a top-level field, not a message role.
 *   2. Tool *results* are `user` messages carrying `tool_result` blocks, not a
 *      `tool` role.
 *   3. Consecutive same-role messages must be merged — Anthropic rejects a
 *      conversation that alternates incorrectly, and splitting tool results into
 *      one message each is the easiest way to produce that.
 */
export function toAnthropicMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  const systems: string[] = [];
  const out: AnthropicMessage[] = [];

  const push = (role: "user" | "assistant", parts: AnthropicPart[]) => {
    if (parts.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...parts);
    else out.push({ role, content: parts });
  };

  for (const m of messages) {
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content : toAnthropicParts(m.content)
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      if (text) systems.push(text);
      continue;
    }
    if (m.role === "tool") {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      push("user", [
        { type: "tool_result", tool_use_id: m.tool_call_id ?? "", content: text },
      ]);
      continue;
    }
    if (m.role === "assistant") {
      const parts = toAnthropicParts(m.content);
      for (const call of m.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          // A half-streamed argument string is not worth failing the turn over;
          // an empty object at least keeps the tool_use block well-formed.
          input = {};
        }
        parts.push({ type: "tool_use", id: call.id, name: call.function.name, input });
      }
      push("assistant", parts);
      continue;
    }
    push("user", toAnthropicParts(m.content));
  }

  return { system: systems.length ? systems.join("\n\n") : undefined, messages: out };
}

/** Anthropic requires `max_tokens`; OpenAI treats it as optional. */
const DEFAULT_MAX_TOKENS = 4096;

export function buildAnthropicBody(
  route: ModelRoute,
  p: StreamParams,
  omitTools = false,
): Record<string, unknown> {
  const { system, messages } = toAnthropicMessages(p.messages);
  const body: Record<string, unknown> = {
    model: route.model,
    messages,
    stream: true,
    // Required by the API, so a missing value is a hard failure rather than an
    // unbounded generation.
    max_tokens: p.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  if (system) body.system = system;
  if (p.temperature !== undefined) body.temperature = p.temperature;
  if (p.topP !== undefined) body.top_p = p.topP;
  if (p.topK !== undefined) body.top_k = p.topK;
  if (p.stop?.length) body.stop_sequences = p.stop;
  if (!omitTools && p.tools?.length) {
    body.tools = p.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
  }
  return body;
}

// ── Response: Anthropic SSE frames → OpenAI chunk shape ─────────────────────

/**
 * Cross-frame state for the translation.
 *
 * Anthropic streams a block's *identity* once (`content_block_start`) and then
 * only its deltas, so whether a given delta is visible text, reasoning or tool
 * arguments is knowable only by remembering what block index it belongs to.
 */
export interface FrameState {
  blocks: Record<number, { type: string; id?: string; name?: string }>;
}

export function newFrameState(): FrameState {
  return { blocks: {} };
}

/** The `[DONE]` sentinel the OpenAI loop terminates on. */
const DONE = "[DONE]";

/**
 * Rewrite one SSE `data:` payload into the OpenAI chunk shape.
 *
 * Returns the payload to feed the parser, `null` to skip the frame entirely
 * (keepalives and structural frames that carry nothing), or `DONE`.
 *
 * For `"openai"` this is the identity function — the existing path is untouched.
 */
export function normalizeFrame(
  protocol: WireProtocol,
  data: string,
  state: FrameState,
): string | null {
  if (protocol !== "anthropic") return data;
  if (data === DONE) return DONE;

  let f: Record<string, unknown>;
  try {
    f = JSON.parse(data) as Record<string, unknown>;
  } catch {
    // Partial JSON across a chunk boundary. Returning the raw payload lets the
    // parser's own try/catch swallow it, exactly as it does for OpenAI.
    return data;
  }

  const type = f.type as string | undefined;

  switch (type) {
    case "ping":
    case "content_block_stop":
      return null;

    case "error":
      // Shaped so the loop's existing mid-stream error branch picks it up.
      return JSON.stringify({ error: f.error ?? { message: "Anthropic stream error" } });

    case "message_start": {
      const usage = (f.message as { usage?: { input_tokens?: number } } | undefined)?.usage;
      if (!usage?.input_tokens) return null;
      return JSON.stringify({
        choices: [{ delta: {} }],
        usage: { prompt_tokens: usage.input_tokens },
      });
    }

    case "content_block_start": {
      const idx = (f.index as number) ?? 0;
      const block = (f.content_block ?? {}) as { type?: string; id?: string; name?: string };
      state.blocks[idx] = { type: block.type ?? "text", id: block.id, name: block.name };
      if (block.type === "tool_use") {
        // Announce the call so the loop's accumulator has an id and a name
        // before any argument fragment arrives.
        return JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: idx,
                    id: block.id ?? "",
                    function: { name: block.name ?? "", arguments: "" },
                  },
                ],
              },
            },
          ],
        });
      }
      return null;
    }

    case "content_block_delta": {
      const idx = (f.index as number) ?? 0;
      const delta = (f.delta ?? {}) as Record<string, unknown>;
      const dType = delta.type as string | undefined;

      if (dType === "text_delta") {
        const text = delta.text as string;
        if (!text) return null;
        return JSON.stringify({ choices: [{ delta: { content: text } }] });
      }
      if (dType === "thinking_delta") {
        const text = delta.thinking as string;
        if (!text) return null;
        // The loop already reads `reasoning_content` as a separate stream.
        return JSON.stringify({ choices: [{ delta: { reasoning_content: text } }] });
      }
      if (dType === "input_json_delta") {
        const frag = delta.partial_json as string;
        if (!frag) return null;
        const block = state.blocks[idx];
        return JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: idx,
                    id: block?.id ?? "",
                    function: { name: block?.name ?? "", arguments: frag },
                  },
                ],
              },
            },
          ],
        });
      }
      return null;
    }

    case "message_delta": {
      const delta = (f.delta ?? {}) as { stop_reason?: string };
      const usage = f.usage as { output_tokens?: number } | undefined;
      const chunk: Record<string, unknown> = {
        choices: [{ delta: {}, finish_reason: delta.stop_reason ?? null }],
      };
      if (usage?.output_tokens) chunk.usage = { completion_tokens: usage.output_tokens };
      return JSON.stringify(chunk);
    }

    case "message_stop":
      // Anthropic never sends `[DONE]`; synthesising it here means the loop
      // terminates through its normal path rather than by the body running out.
      return DONE;

    default:
      return null;
  }
}
