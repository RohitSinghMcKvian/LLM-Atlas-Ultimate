// Generate runnable code snippets that reproduce the current playground config
// against the Atlas Router (OpenAI-compatible SSE gateway at
// /api/v1/router/chat). Variables are rendered before export so the snippet is
// self-contained.

import type { PlaygroundConfig } from "./types";
import { parseTools } from "./types";
import { render } from "@/lib/store/prompt-store";

export interface ExportMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The exact request body the playground sends for `modelId`. */
export function buildRequestBody(
  config: PlaygroundConfig,
  modelId: string,
): Record<string, unknown> {
  const vars = config.variables;
  const messages: ExportMessage[] = [];
  if (config.system.trim())
    messages.push({ role: "system", content: render(config.system, vars) });
  for (const t of config.turns) {
    if (t.content.trim())
      messages.push({ role: t.role, content: render(t.content, vars) });
  }

  const p = config.params;
  const body: Record<string, unknown> = {
    modelId,
    messages,
    temperature: p.temperature,
    topP: p.topP,
    maxTokens: p.maxTokens,
  };
  if (p.topK > 0) body.topK = p.topK;
  if (p.stop.length) body.stop = p.stop;
  if (p.seed.trim() !== "" && !Number.isNaN(Number(p.seed)))
    body.seed = Number(p.seed);
  if (p.frequencyPenalty !== 0) body.frequencyPenalty = p.frequencyPenalty;
  if (p.presencePenalty !== 0) body.presencePenalty = p.presencePenalty;
  if (p.reasoningEffort !== "off") body.reasoningEffort = p.reasoningEffort;
  if (p.jsonMode) body.responseFormat = { type: "json_object" };
  const tools = parseTools(config.toolsJson);
  if (tools && "tools" in tools) {
    body.tools = tools.tools;
    body.toolChoice = "auto";
  }
  return body;
}

const KEY_NOTE =
  "closed/BYOK models: add your OpenRouter key header x-openrouter-key";

export function toCurl(config: PlaygroundConfig, modelId: string, origin: string): string {
  const body = buildRequestBody(config, modelId);
  const json = JSON.stringify(body, null, 2).replace(/'/g, "'\\''");
  return `# Atlas Router — streaming chat completion (SSE)
# ${KEY_NOTE}
curl -N ${origin}/api/v1/router/chat \\
  -H 'Content-Type: application/json' \\
  -d '${json}'`;
}

export function toTypeScript(
  config: PlaygroundConfig,
  modelId: string,
  origin: string,
): string {
  const body = JSON.stringify(buildRequestBody(config, modelId), null, 2);
  return `// Atlas Router — streaming chat completion (SSE)
// ${KEY_NOTE}
const res = await fetch("${origin}/api/v1/router/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(${body.replace(/\n/g, "\n  ")}),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split("\\n\\n");
  buffer = frames.pop() ?? "";
  for (const frame of frames) {
    const line = frame.split("\\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    const ev = JSON.parse(line.slice(5));
    if (ev.type === "delta") process.stdout.write(ev.text);
    else if (ev.type === "reasoning") process.stderr.write(ev.text);
    else if (ev.type === "usage") console.log("\\n[usage]", ev);
  }
}`;
}

export function toPython(
  config: PlaygroundConfig,
  modelId: string,
  origin: string,
): string {
  const body = JSON.stringify(buildRequestBody(config, modelId), null, 2)
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False")
    .replace(/\bnull\b/g, "None");
  return `# Atlas Router — streaming chat completion (SSE)
# ${KEY_NOTE}
import json, requests

body = ${body.replace(/\n/g, "\n")}

with requests.post(
    "${origin}/api/v1/router/chat",
    json=body,
    stream=True,
    timeout=300,
) as res:
    res.raise_for_status()
    for raw in res.iter_lines(decode_unicode=True):
        if not raw or not raw.startswith("data:"):
            continue
        ev = json.loads(raw[5:])
        if ev.get("type") == "delta":
            print(ev["text"], end="", flush=True)
        elif ev.get("type") == "usage":
            print("\\n[usage]", ev)`;
}
