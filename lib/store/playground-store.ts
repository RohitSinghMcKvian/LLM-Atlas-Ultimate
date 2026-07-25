"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { debouncedLocalStorage } from "@/lib/store/debounced-storage";
import { playgroundRepo } from "@/lib/playground/repo";
import {
  defaultConfig,
  uuid,
  type PlaygroundConfig,
  type PlaygroundParams,
  type Preset,
  type RunRecord,
  type Turn,
} from "@/lib/playground/types";

interface PlaygroundState {
  /** The working config (persisted to localStorage across visits). */
  config: PlaygroundConfig;
  presets: Preset[];
  runs: RunRecord[];
  hydrated: boolean;
  remote: boolean;

  init: () => Promise<void>;
  setConfig: (patch: Partial<PlaygroundConfig>) => void;
  setParams: (patch: Partial<PlaygroundParams>) => void;
  resetParams: () => void;

  addTurn: () => void;
  updateTurn: (id: string, patch: Partial<Omit<Turn, "id">>) => void;
  removeTurn: (id: string) => void;
  setVariable: (name: string, value: string) => void;
  toggleModel: (id: string) => void;

  saveAsPreset: (name: string) => Promise<void>;
  applyPreset: (id: string) => void;
  deletePreset: (id: string) => Promise<void>;

  recordRun: (r: RunRecord) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  setNote: (id: string, note: string) => Promise<void>;
  deleteRun: (id: string) => Promise<void>;
  clearRuns: () => Promise<void>;
  /** Load a past run's config back into the editor. */
  restoreRun: (id: string) => void;
}

const repo = () => playgroundRepo();

export const usePlaygroundStore = create<PlaygroundState>()(
  persist(
    (set, get) => ({
      config: defaultConfig(),
      presets: [],
      runs: [],
      hydrated: false,
      remote: false,

      async init() {
        if (get().hydrated) return;
        try {
          const [presets, runs] = await Promise.all([
            repo().listPresets(),
            repo().listRuns(),
          ]);
          set({ presets, runs, hydrated: true, remote: repo().remote });
        } catch (e) {
          console.warn("[playground] failed to load presets/runs", e);
          set({ hydrated: true, remote: repo().remote });
        }
      },

      setConfig(patch) {
        set((s) => ({ config: { ...s.config, ...patch } }));
      },

      setParams(patch) {
        set((s) => ({
          config: { ...s.config, params: { ...s.config.params, ...patch } },
        }));
      },

      resetParams() {
        set((s) => ({
          config: { ...s.config, params: { ...defaultConfig().params } },
        }));
      },

      addTurn() {
        set((s) => {
          const last = s.config.turns[s.config.turns.length - 1];
          const role: Turn["role"] = last?.role === "user" ? "assistant" : "user";
          return {
            config: {
              ...s.config,
              turns: [...s.config.turns, { id: uuid(), role, content: "" }],
            },
          };
        });
      },

      updateTurn(id, patch) {
        set((s) => ({
          config: {
            ...s.config,
            turns: s.config.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          },
        }));
      },

      removeTurn(id) {
        set((s) => ({
          config: {
            ...s.config,
            turns: s.config.turns.filter((t) => t.id !== id),
          },
        }));
      },

      setVariable(name, value) {
        set((s) => ({
          config: {
            ...s.config,
            variables: { ...s.config.variables, [name]: value },
          },
        }));
      },

      toggleModel(id) {
        set((s) => ({
          config: {
            ...s.config,
            models: s.config.models.includes(id)
              ? s.config.models.filter((m) => m !== id)
              : [...s.config.models, id],
          },
        }));
      },

      async saveAsPreset(name) {
        const now = Date.now();
        const preset: Preset = {
          id: uuid(),
          name: name.trim() || "Untitled preset",
          config: JSON.parse(JSON.stringify(get().config)),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ presets: [preset, ...s.presets] }));
        try {
          await repo().savePreset(preset);
        } catch (e) {
          console.warn("[playground] failed to save preset", e);
        }
      },

      applyPreset(id) {
        const p = get().presets.find((x) => x.id === id);
        if (!p) return;
        set({ config: JSON.parse(JSON.stringify(p.config)) });
      },

      async deletePreset(id) {
        set((s) => ({ presets: s.presets.filter((p) => p.id !== id) }));
        try {
          await repo().deletePreset(id);
        } catch (e) {
          console.warn("[playground] failed to delete preset", e);
        }
      },

      async recordRun(r) {
        set((s) => ({ runs: [r, ...s.runs].slice(0, 200) }));
        try {
          await repo().addRun(r);
        } catch (e) {
          console.warn("[playground] failed to record run", e);
        }
      },

      async toggleStar(id) {
        const run = get().runs.find((r) => r.id === id);
        if (!run) return;
        const starred = !run.starred;
        set((s) => ({
          runs: s.runs.map((r) => (r.id === id ? { ...r, starred } : r)),
        }));
        try {
          await repo().updateRun(id, { starred });
        } catch (e) {
          console.warn("[playground] failed to star run", e);
        }
      },

      async setNote(id, note) {
        set((s) => ({
          runs: s.runs.map((r) => (r.id === id ? { ...r, note } : r)),
        }));
        try {
          await repo().updateRun(id, { note });
        } catch (e) {
          console.warn("[playground] failed to set note", e);
        }
      },

      async deleteRun(id) {
        set((s) => ({ runs: s.runs.filter((r) => r.id !== id) }));
        try {
          await repo().deleteRun(id);
        } catch (e) {
          console.warn("[playground] failed to delete run", e);
        }
      },

      async clearRuns() {
        set((s) => ({ runs: s.runs.filter((r) => r.starred) }));
        try {
          await repo().clearRuns();
        } catch (e) {
          console.warn("[playground] failed to clear runs", e);
        }
      },

      restoreRun(id) {
        const run = get().runs.find((r) => r.id === id);
        if (!run?.config?.turns) return;
        set({ config: JSON.parse(JSON.stringify(run.config)) });
      },
    }),
    {
      name: "atlas-playground-config",
      partialize: (s) => ({ config: s.config }),
      // The config is edited keystroke by keystroke (system prompt, turn
      // bodies, tool JSON), and persist writes on every set(). Coalesce the
      // writes; reads stay synchronous so rehydration is unchanged.
      storage: debouncedLocalStorage(),
    },
  ),
);
