"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PromptVersion {
  v: number;
  body: string;
  note: string;
  date: string;
}

export interface Prompt {
  id: string;
  title: string;
  tags: string[];
  versions: PromptVersion[];
}

const SEED: Prompt[] = [
  {
    id: "summarize",
    title: "Neutral summary",
    tags: ["summary", "rag"],
    versions: [
      {
        v: 1,
        body:
          "Summarize the following text in {{sentences}} neutral sentences. Do not editorialize.\n\nText:\n{{text}}",
        note: "Initial",
        date: "2026-06-20",
      },
    ],
  },
  {
    id: "extract-json",
    title: "Extract to JSON",
    tags: ["extraction", "format"],
    versions: [
      {
        v: 1,
        body:
          "Extract the following fields as JSON: {{fields}}. Return ONLY valid JSON, no prose.\n\nInput:\n{{input}}",
        note: "Initial",
        date: "2026-06-21",
      },
    ],
  },
  {
    id: "code-review",
    title: "Code reviewer",
    tags: ["code", "review"],
    versions: [
      {
        v: 1,
        body:
          "You are a senior engineer. Review this {{language}} code for bugs, edge cases, and clarity. Be specific.\n\n```\n{{code}}\n```",
        note: "Initial",
        date: "2026-06-22",
      },
      {
        v: 2,
        body:
          "You are a meticulous staff engineer. Review this {{language}} code for correctness bugs first, then clarity. Cite line-level issues and suggest concrete fixes.\n\n```\n{{code}}\n```",
        note: "Sharper rubric; bugs before style",
        date: "2026-06-26",
      },
    ],
  },
  {
    id: "socratic",
    title: "Socratic tutor",
    tags: ["learn"],
    versions: [
      {
        v: 1,
        body:
          "Act as a Socratic tutor for {{topic}}. Ask one guiding question at a time and wait for my answer before continuing.",
        note: "Initial",
        date: "2026-06-24",
      },
    ],
  },
];

interface PromptState {
  prompts: Prompt[];
  add: (p: Omit<Prompt, "versions"> & { body: string }) => void;
  saveVersion: (id: string, body: string, note: string) => void;
  updateMeta: (id: string, patch: Partial<Pick<Prompt, "title" | "tags">>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => string | null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export const usePromptStore = create<PromptState>()(
  persist(
    (set, get) => ({
      prompts: SEED,
      add: ({ id, title, tags, body }) =>
        set((s) => ({
          prompts: [
            { id, title, tags, versions: [{ v: 1, body, note: "Initial", date: today() }] },
            ...s.prompts,
          ],
        })),
      saveVersion: (id, body, note) =>
        set((s) => ({
          prompts: s.prompts.map((p) =>
            p.id === id
              ? {
                  ...p,
                  versions: [
                    ...p.versions,
                    {
                      v: p.versions[p.versions.length - 1].v + 1,
                      body,
                      note: note || "Updated",
                      date: today(),
                    },
                  ],
                }
              : p,
          ),
        })),
      updateMeta: (id, patch) =>
        set((s) => ({
          prompts: s.prompts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      remove: (id) =>
        set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),
      duplicate: (id) => {
        const src = get().prompts.find((p) => p.id === id);
        if (!src) return null;
        const nid = `${id}-copy-${Date.now()}`;
        set((s) => ({
          prompts: [
            {
              ...src,
              id: nid,
              title: `${src.title} (copy)`,
              versions: [...src.versions],
            },
            ...s.prompts,
          ],
        }));
        return nid;
      },
    }),
    { name: "atlas-prompts" },
  ),
);

export function latest(p: Prompt): PromptVersion {
  return p.versions[p.versions.length - 1];
}

export function extractVars(body: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) set.add(m[1]);
  return [...set];
}

export function render(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] || `{{${k}}}`);
}
