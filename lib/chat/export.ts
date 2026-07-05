import type { ChatMessage, Conversation } from "./types";

function stamp(ts: number): string {
  return new Date(ts).toISOString();
}

/** Render the active path as a portable Markdown transcript. */
export function toMarkdown(conv: Conversation, messages: ChatMessage[]): string {
  const lines: string[] = [`# ${conv.title}`, "", `_Exported ${stamp(Date.now())}_`, ""];
  for (const m of messages) {
    const who = m.role === "user" ? "You" : m.model || "Atlas";
    lines.push(`## ${who}`, "");
    if (m.reasoning?.trim()) {
      lines.push("> **Reasoning**", "", ...m.reasoning.trim().split("\n").map((l) => `> ${l}`), "");
    }
    lines.push(m.content || "_(empty)_", "");
    if (m.sources?.length) {
      lines.push("**Sources**", "");
      m.sources.forEach((s, i) => lines.push(`${i + 1}. [${s.title}](${s.url})`));
      lines.push("");
    }
    if (m.attachments?.length) {
      lines.push(`_Attachments: ${m.attachments.map((a) => a.name).join(", ")}_`, "");
    }
  }
  return lines.join("\n");
}

/** Serialize the conversation + active path as JSON. */
export function toJSON(conv: Conversation, messages: ChatMessage[]): string {
  return JSON.stringify(
    {
      conversation: conv,
      exportedAt: new Date().toISOString(),
      messages: messages.map((m) => ({
        role: m.role,
        model: m.model,
        content: m.content,
        reasoning: m.reasoning,
        sources: m.sources,
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        createdAt: m.createdAt,
      })),
    },
    null,
    2,
  );
}

/** Trigger a client-side download. */
export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "chat"
  );
}
