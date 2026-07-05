// Chat → Code escalation (Depth Spec v2 C.4): promotes the current chat
// conversation (context, attachments, artifacts) into an Atlas Code workspace
// task. Stashes the payload in sessionStorage so the Code page can pick it up.

import type { ChatMessage, Attachment } from "./types";
import { compactHistory, estimateTokens } from "@/lib/engine/context";
import type { ChatMessage as RouterMsg } from "@/lib/router";

export interface EscalationPayload {
  id: string;
  brief: string;
  artifacts: EscalationArtifact[];
  attachments: Attachment[];
  conversationSummary: string;
  sourceConversationId?: string;
  createdAt: number;
}

export interface EscalationArtifact {
  filename: string;
  content: string;
  language: string;
}

const STORAGE_KEY = "atlas-escalation-payload";

function extractCodeArtifacts(messages: ChatMessage[]): EscalationArtifact[] {
  const arts: EscalationArtifact[] = [];
  const fenceRe = /```(\w+)?\s*\n([\s\S]*?)```/g;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    let match: RegExpExecArray | null;
    while ((match = fenceRe.exec(m.content)) !== null) {
      const lang = match[1] || "text";
      const code = match[2].trim();
      if (code.length < 20) continue;
      const ext = langToExt(lang);
      const filename = `artifact_${arts.length + 1}.${ext}`;
      arts.push({ filename, content: code, language: lang });
    }
  }
  return arts;
}

function langToExt(lang: string): string {
  const map: Record<string, string> = {
    typescript: "ts", javascript: "js", python: "py", html: "html",
    css: "css", json: "json", rust: "rs", go: "go", java: "java",
    tsx: "tsx", jsx: "jsx", markdown: "md", yaml: "yml", shell: "sh",
    bash: "sh", sql: "sql", text: "txt",
  };
  return map[lang.toLowerCase()] ?? (lang.toLowerCase().slice(0, 4) || "txt");
}

function buildBrief(messages: ChatMessage[]): string {
  const userMsgs = messages.filter((m) => m.role === "user");
  const lastFew = userMsgs.slice(-3);
  const goal = lastFew.map((m) => m.content).join("\n\n");
  if (goal.length <= 2000) return goal;
  return goal.slice(0, 2000) + "\n[…truncated]";
}

function buildSummary(messages: ChatMessage[]): string {
  const routerMsgs: RouterMsg[] = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  const { history } = compactHistory(routerMsgs, {
    keepLastTurns: 6,
    maxToolResultChars: 100,
    maxContentChars: 500,
  });
  return history
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content.slice(0, 300) : "[complex]"}`)
    .join("\n\n");
}

export function buildEscalationPayload(
  messages: ChatMessage[],
  conversationId?: string,
): EscalationPayload {
  const artifacts = extractCodeArtifacts(messages);
  const attachments = messages
    .flatMap((m) => m.attachments ?? [])
    .filter((a) => a.kind === "text" || a.kind === "code" || a.kind === "csv");
  const brief = buildBrief(messages);
  const conversationSummary = buildSummary(messages);

  return {
    id: crypto.randomUUID(),
    brief,
    artifacts,
    attachments: attachments.slice(0, 10),
    conversationSummary,
    sourceConversationId: conversationId,
    createdAt: Date.now(),
  };
}

export function stashEscalation(payload: EscalationPayload): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage full — silently fail, code page will start without context
  }
}

export function popEscalation(): EscalationPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw) as EscalationPayload;
  } catch {
    return null;
  }
}
