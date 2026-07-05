"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type StyleId =
  | "default"
  | "concise"
  | "explanatory"
  | "formal"
  | "creative"
  | "code";

export interface StylePreset {
  id: StyleId;
  label: string;
  hint: string;
  /** Appended to the system prompt. Empty for "default". */
  prompt: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: "default", label: "Normal", hint: "Balanced default", prompt: "" },
  {
    id: "concise",
    label: "Concise",
    hint: "Short and direct",
    prompt:
      "Be concise. Lead with the answer, keep prose tight, and avoid filler or restating the question.",
  },
  {
    id: "explanatory",
    label: "Explanatory",
    hint: "Teach with detail",
    prompt:
      "Be thorough and educational. Explain the reasoning, define terms, and use short examples or analogies where they aid understanding.",
  },
  {
    id: "formal",
    label: "Formal",
    hint: "Professional tone",
    prompt:
      "Use a formal, professional register. Prefer precise vocabulary and complete sentences; avoid slang and contractions.",
  },
  {
    id: "creative",
    label: "Creative",
    hint: "Playful and vivid",
    prompt:
      "Be imaginative and engaging. Use vivid language and fresh framings while staying accurate.",
  },
  {
    id: "code",
    label: "Code-focused",
    hint: "Minimal prose, real code",
    prompt:
      "Optimize for engineers. Prefer runnable code over prose, include types and error handling, and keep explanations to what's necessary to use the code.",
  },
];

export const styleById = (id: StyleId): StylePreset =>
  STYLE_PRESETS.find((s) => s.id === id) ?? STYLE_PRESETS[0];

export type ReasoningEffort = "off" | "low" | "medium" | "high";

interface SettingsState {
  /** "What Atlas should know about you." */
  aboutYou: string;
  /** "How Atlas should respond." */
  responseGuidance: string;
  /** Preferred name to address the user. */
  displayName: string;
  style: StyleId;
  /** Composer toggles. */
  webSearch: boolean;
  memory: boolean;
  /** Read assistant replies aloud automatically. */
  voiceAutoRead: boolean;
  /** Reasoning effort level for models that support extended thinking. */
  reasoningEffort: ReasoningEffort;

  set: (patch: Partial<Omit<SettingsState, "set" | "toggle">>) => void;
  toggle: (key: "webSearch" | "memory" | "voiceAutoRead") => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      aboutYou: "",
      responseGuidance: "",
      displayName: "",
      style: "default",
      webSearch: false,
      memory: true,
      voiceAutoRead: false,
      reasoningEffort: "off",
      set: (patch) => set(patch),
      toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SettingsState>),
    }),
    { name: "atlas-chat-settings" },
  ),
);

export interface SystemContext {
  style: StyleId;
  aboutYou?: string;
  responseGuidance?: string;
  displayName?: string;
  /** Instructions injected from an active Project (§4.5). */
  projectInstructions?: string;
  /** Relevant recalled memories (§4.7). */
  memories?: string[];
}

const BASE =
  "You are Atlas, a helpful, precise AI assistant inside the LLM Atlas workspace. Use clean markdown. When asked to build a UI or page, return a single fenced ```html code block so it can render as an artifact.";

/** Compose the full system prompt from base + user style + custom instructions. */
export function buildSystemPrompt(ctx: SystemContext): string {
  const parts = [BASE];
  const style = styleById(ctx.style).prompt;
  if (style) parts.push(style);
  if (ctx.displayName?.trim()) parts.push(`Address the user as ${ctx.displayName.trim()}.`);
  if (ctx.aboutYou?.trim())
    parts.push(`About the user (they provided this):\n${ctx.aboutYou.trim()}`);
  if (ctx.responseGuidance?.trim())
    parts.push(`How the user wants you to respond:\n${ctx.responseGuidance.trim()}`);
  if (ctx.projectInstructions?.trim())
    parts.push(`Project context and instructions:\n${ctx.projectInstructions.trim()}`);
  if (ctx.memories && ctx.memories.length)
    parts.push(
      "Relevant things you remember about the user from past chats (use if helpful, don't force it):\n" +
        ctx.memories.map((m) => `- ${m}`).join("\n"),
    );
  return parts.join("\n\n");
}
