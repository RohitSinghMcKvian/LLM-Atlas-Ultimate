"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uuid } from "@/lib/chat/types";
import type { MemoryItem } from "@/lib/chat/memory";

interface MemoryState {
  items: MemoryItem[];
  add: (content: string, source?: MemoryItem["source"]) => void;
  update: (id: string, content: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useMemoryStore = create<MemoryState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (content, source = "manual") => {
        const fact = content.trim();
        if (!fact) return;
        // De-dupe near-identical facts.
        if (get().items.some((i) => i.content.toLowerCase() === fact.toLowerCase()))
          return;
        set((s) => ({
          items: [
            { id: uuid(), content: fact, source, createdAt: Date.now() },
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
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      clear: () => set({ items: [] }),
    }),
    { name: "atlas-chat-memory" },
  ),
);
