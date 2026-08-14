/**
 * Building the request that goes on the wire.
 *
 * Extracted from `chat-client.tsx` for two reasons, and the second is the real
 * one. It is the prerequisite for carrying tool history across turns — and it is
 * the only way the context meter and the actual request cannot drift, because
 * they now call the same function. `measureHealth` used to re-derive its own
 * estimate from the message list, so it counted neither the search block nor a
 * single character of the in-turn tool transcript, and a build could report "ok"
 * while overflowing.
 *
 * Pure. No React, no fetch, no catalog lookups beyond what the caller passes in.
 */

import { attachmentsToPromptText } from "./attachments";
import { budgetActions, type ActionsBudget } from "./turn-actions";
import type { ChatMessage, WebSource } from "./types";

export interface RouterMsg {
  role: "system" | "user" | "assistant" | "tool";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- multimodal parts
  content: any;
  /** Set on an assistant turn that requested tools, echoed so the model sees it. */
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  /** Set on a tool result, linking it to the call it answers. */
  tool_call_id?: string;
}

export interface RequestOptions {
  system: string;
  /** Whether the model can take image parts. */
  vision: boolean;
  searchSources?: WebSource[];
  /**
   * Append a one-line record of what each recent turn did.
   *
   * Off by default so the wire is unchanged until the flag is on.
   */
  actions?: ActionsBudget | false;
}

export function searchContextBlock(sources: WebSource[]): string {
  const body = sources
    .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${s.snippet}`)
    .join("\n\n");
  return (
    "Web search results for the user's latest message. Use them to answer with current " +
    "information and cite the ones you rely on inline as [1], [2], etc.\n\n" +
    body
  );
}

/**
 * An image the model was shown earlier but is not being shown again.
 *
 * Only the last turn's images are re-sent — a conversation with six screenshots
 * would otherwise carry six megabytes of base64 on every request. But they used
 * to vanish with nothing in their place, so the model would state that no image
 * had ever been provided. One line fixes that.
 */
function imagePlaceholder(names: string[]): string {
  const list = names.join(", ");
  return `[image${names.length === 1 ? "" : "s"} attached earlier: ${list} — not re-sent]`;
}

export function toRouterMessages(msgs: ChatMessage[], opts: RequestOptions): RouterMsg[] {
  const out: RouterMsg[] = [{ role: "system", content: opts.system }];
  if (opts.searchSources?.length) {
    out.push({ role: "system", content: searchContextBlock(opts.searchSources) });
  }

  const actions =
    opts.actions === false || opts.actions === undefined
      ? new Map<string, string>()
      : budgetActions(
          msgs
            .filter((m) => m.role === "assistant" && m.toolCalls?.length)
            .map((m) => ({ id: m.id, calls: m.toolCalls ?? [] })),
          opts.actions,
        );

  msgs.forEach((m, i) => {
    if (m.role === "assistant") {
      const line = actions.get(m.id);
      out.push({
        role: "assistant",
        content: line ? (m.content ? `${m.content}\n\n${line}` : line) : m.content,
      });
      return;
    }

    const textual = m.attachments ? attachmentsToPromptText(m.attachments) : "";
    const images = (m.attachments ?? []).filter((a) => a.kind === "image" && a.dataUrl);
    const isLast = i === msgs.length - 1;

    if (opts.vision && images.length && isLast) {
      const baseText = [m.content, textual].filter(Boolean).join("\n\n");
      out.push({
        role: "user",
        content: [
          { type: "text", text: baseText || "(see attached image)" },
          ...images.map((im) => ({ type: "image_url", image_url: { url: im.dataUrl } })),
        ],
      });
      return;
    }

    // Not re-sent, but not silently gone either.
    const note = images.length ? imagePlaceholder(images.map((a) => a.name)) : "";
    out.push({
      role: "user",
      content: [m.content, textual, note].filter(Boolean).join("\n\n"),
    });
  });

  return out;
}

/** Characters a built request carries. What the meter should be counting. */
export function requestChars(msgs: RouterMsg[]): number {
  let n = 0;
  for (const m of msgs) {
    n += typeof m.content === "string" ? m.content.length : jsonChars(m.content);
    for (const c of m.tool_calls ?? []) n += c.function.name.length + c.function.arguments.length;
  }
  return n;
}

function jsonChars(v: unknown): number {
  if (v == null) return 0;
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
}
