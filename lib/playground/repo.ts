"use client";

import { getSupabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Preset, RunRecord } from "./types";

/**
 * Persistence for Playground presets (named configs) and run history. Backed
 * by Supabase (playground_experiments / playground_runs) when configured, else
 * localStorage — same dual-driver pattern as lib/chat/repo.ts.
 */
export interface PlaygroundRepo {
  readonly remote: boolean;
  listPresets(): Promise<Preset[]>;
  /** Upsert by id. */
  savePreset(p: Preset): Promise<void>;
  deletePreset(id: string): Promise<void>;
  listRuns(): Promise<RunRecord[]>;
  addRun(r: RunRecord): Promise<void>;
  updateRun(id: string, patch: Partial<Pick<RunRecord, "starred" | "note">>): Promise<void>;
  deleteRun(id: string): Promise<void>;
  clearRuns(): Promise<void>;
}

const PRESETS_KEY = "atlas-playground-presets";
const RUNS_KEY = "atlas-playground-runs";
const MAX_RUNS = 100;

function read<T>(key: string): T[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}

function write(key: string, value: unknown) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — ignore */
  }
}

const localRepo: PlaygroundRepo = {
  remote: false,
  async listPresets() {
    return read<Preset>(PRESETS_KEY).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async savePreset(p) {
    const list = read<Preset>(PRESETS_KEY);
    const idx = list.findIndex((x) => x.id === p.id);
    if (idx >= 0) list[idx] = p;
    else list.unshift(p);
    write(PRESETS_KEY, list);
  },
  async deletePreset(id) {
    write(PRESETS_KEY, read<Preset>(PRESETS_KEY).filter((p) => p.id !== id));
  },
  async listRuns() {
    return read<RunRecord>(RUNS_KEY).sort((a, b) => b.createdAt - a.createdAt);
  },
  async addRun(r) {
    const list = read<RunRecord>(RUNS_KEY);
    list.unshift(r);
    // Cap history, but never evict starred runs.
    if (list.length > MAX_RUNS) {
      const starred = list.filter((x) => x.starred);
      const rest = list.filter((x) => !x.starred).slice(0, MAX_RUNS - starred.length);
      write(
        RUNS_KEY,
        [...starred, ...rest].sort((a, b) => b.createdAt - a.createdAt),
      );
      return;
    }
    write(RUNS_KEY, list);
  },
  async updateRun(id, patch) {
    write(
      RUNS_KEY,
      read<RunRecord>(RUNS_KEY).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  },
  async deleteRun(id) {
    write(RUNS_KEY, read<RunRecord>(RUNS_KEY).filter((r) => r.id !== id));
  },
  async clearRuns() {
    // Keep starred runs on clear — matches the UI affordance ("Clear unstarred").
    write(RUNS_KEY, read<RunRecord>(RUNS_KEY).filter((r) => r.starred));
  },
};

// ── Supabase driver ─────────────────────────────────────────────────────────

function makeSupabaseRepo(): PlaygroundRepo {
  // getSupabaseBrowser lazy-loads @supabase/supabase-js on first call.
  const db = async () => {
    const c = await getSupabaseBrowser();
    if (!c) throw new Error("Supabase not configured");
    return c;
  };

  return {
    remote: true,
    async listPresets() {
      const { data, error } = await (await db())
        .from("playground_experiments")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        config: r.config,
        createdAt: new Date(r.created_at).getTime(),
        updatedAt: new Date(r.updated_at).getTime(),
      }));
    },
    async savePreset(p) {
      const { error } = await (await db())
        .from("playground_experiments")
        .upsert({ id: p.id, name: p.name, config: p.config });
      if (error) throw error;
    },
    async deletePreset(id) {
      const { error } = await (await db())
        .from("playground_experiments")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    async listRuns() {
      const { data, error } = await (await db())
        .from("playground_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(MAX_RUNS);
      if (error) throw error;
      return (data ?? []).map((r: any) => {
        const metrics = r.metrics ?? {};
        return {
          id: r.id,
          modelId: r.model_id,
          output: r.output ?? "",
          reasoning: metrics.reasoning ?? undefined,
          toolCalls: metrics.toolCalls ?? undefined,
          error: metrics.error ?? undefined,
          metrics,
          config: r.input ?? {},
          starred: r.starred ?? false,
          note: r.note ?? undefined,
          createdAt: new Date(r.created_at).getTime(),
        } as RunRecord;
      });
    },
    async addRun(r) {
      const { error } = await (await db()).from("playground_runs").insert({
        id: r.id,
        experiment_id: null,
        model_id: r.modelId,
        input: r.config,
        output: r.output,
        // Content-ish extras ride in the metrics jsonb to keep the schema lean.
        metrics: { ...r.metrics, reasoning: r.reasoning, toolCalls: r.toolCalls, error: r.error },
        starred: r.starred,
        note: r.note ?? null,
      });
      if (error) throw error;
    },
    async updateRun(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.starred !== undefined) row.starred = patch.starred;
      if (patch.note !== undefined) row.note = patch.note;
      if (Object.keys(row).length === 0) return;
      const { error } = await (await db()).from("playground_runs").update(row).eq("id", id);
      if (error) throw error;
    },
    async deleteRun(id) {
      const { error } = await (await db()).from("playground_runs").delete().eq("id", id);
      if (error) throw error;
    },
    async clearRuns() {
      const { error } = await (await db())
        .from("playground_runs")
        .delete()
        .eq("starred", false);
      if (error) throw error;
    },
  };
}

let cached: PlaygroundRepo | null = null;

export function playgroundRepo(): PlaygroundRepo {
  if (!cached) cached = isSupabaseConfigured() ? makeSupabaseRepo() : localRepo;
  return cached;
}
