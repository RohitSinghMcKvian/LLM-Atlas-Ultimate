"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uuid } from "@/lib/chat/types";
import { isIncognito } from "@/lib/chat/incognito";
import {
  classifyMemory,
  composeMemorySummary,
  type MemoryCategory,
  type MemoryItem,
} from "@/lib/chat/memory";

interface MemoryState {
  items: MemoryItem[];
  /**
   * A user-owned prose summary of what Atlas remembers, injected into the system
   * prompt when set.
   *
   * Stored separately from `items` rather than derived from them on every render
   * because it is *editable*: the moment the user rewrites a generated draft, the
   * text is theirs, and regenerating it from the items would throw their edit
   * away. `regenerateSummary` is therefore an explicit action, never automatic.
   */
  summary: string;
  add: (content: string, source?: MemoryItem["source"], category?: MemoryCategory) => void;
  update: (id: string, content: string) => void;
  setCategory: (id: string, category: MemoryCategory) => void;
  remove: (id: string) => void;
  /** Delete every item in one category — the point of having categories. */
  clearCategory: (category: MemoryCategory) => void;
  clear: () => void;
  setSummary: (text: string) => void;
  regenerateSummary: () => void;
}

export const useMemoryStore = create<MemoryState>()(
  persist(
    (set, get) => ({
      items: [],
      summary: "",
      add: (content, source = "manual", category) => {
        const fact = content.trim();
        if (!fact) return;
        // Incognito must not leave a remembered fact behind. Checked here as well
        // as at the repo seam because zustand's `persist` writes straight to
        // localStorage and never passes through ChatRepo.
        if (isIncognito()) return;
        // De-dupe near-identical facts.
        if (get().items.some((i) => i.content.toLowerCase() === fact.toLowerCase()))
          return;
        set((s) => ({
          items: [
            {
              id: uuid(),
              content: fact,
              source,
              category: category ?? classifyMemory(fact),
              createdAt: Date.now(),
            },
            ...s.items,
          ],
        }));
      },
      update: (id, content) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? { ...i, content: content.trim() } : i,
          ),
        })),
      setCategory: (id, category) =>
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, category } : i)),
        })),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      clearCategory: (category) =>
        set((s) => ({
          items: s.items.filter((i) => (i.category ?? "fact") !== category),
        })),
      clear: () => set({ items: [], summary: "" }),
      setSummary: (text) => set({ summary: text }),
      regenerateSummary: () => set({ summary: composeMemorySummary(get().items) }),
    }),
    { name: "atlas-chat-memory" },
  ),
);
