"use client";

import { create } from "zustand";
import type { GraphContext } from "@/lib/graph/retrieve";
import type { OrchestraRun } from "@/lib/orchestra/trace";

/**
 * What the Map is currently showing.
 *
 * A store rather than props, for one specific reason: the surveys come from two
 * places - a retrieval inside a chat turn and a question typed into the Ask
 * Atlas panel - and both want to draw the same map. Threading it through props
 * would mean routing it through `chat-client.tsx`, which is 3,948 lines and is
 * exactly where a feature goes to become untestable.
 *
 * Not persisted. A survey describes one question; restoring yesterday's map on
 * load would be showing an answer to something nobody asked.
 */
interface GraphState {
  /** The question this survey answers. Empty when nothing has been asked. */
  query: string;
  context: GraphContext | null;
  /** The orchestrated run in flight, if any. */
  run: OrchestraRun | null;
  publish: (query: string, context: GraphContext | null) => void;
  setRun: (run: OrchestraRun | null) => void;
  clear: () => void;
}

export const useGraphStore = create<GraphState>()((set) => ({
  query: "",
  context: null,
  run: null,
  publish: (query, context) => set({ query, context }),
  setRun: (run) => set({ run }),
  clear: () => set({ query: "", context: null, run: null }),
}));
