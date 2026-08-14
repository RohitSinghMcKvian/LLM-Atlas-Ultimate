"use client";

import { getSupabaseBrowser, remotePersistenceReady } from "@/lib/supabase/client";
import type { ChatMessage as RouterMsg } from "@/lib/router";
import type { UiEvent } from "@/lib/store/code-store";
import type { TraceEvent } from "@/lib/engine/types";

/**
 * Persistence for Atlas Code agent sessions (conversation timeline + model
 * history) — Supabase `code_sessions` when configured, else localStorage.
 * Same dual-driver pattern as lib/chat/repo.ts and lib/playground/repo.ts.
 *
 * Sessions capture the CONVERSATION, not the filesystem — workspace files are
 * ephemeral per browser boot (checkpoints cover in-page rollback).
 */
export interface CodeSessionMeta {
  id: string;
  name: string;
  modelId: string;
  mode: string;
  createdAt: number;
  updatedAt: number;
}

export interface CodeSessionState {
  events: UiEvent[];
  history: RouterMsg[];
  /**
   * The event-sourced trace (Depth v2). Persisted alongside the legacy
   * events projection; absent in pre-v2 sessions — the store lifts `events`
   * into a trace on load.
   */
  trace?: TraceEvent[];
}

export interface CodeSessionsRepo {
  readonly remote: boolean;
  list(): Promise<CodeSessionMeta[]>;
  load(id: string): Promise<{ meta: CodeSessionMeta; state: CodeSessionState } | null>;
  /** Upsert by meta.id. */
  save(meta: CodeSessionMeta, state: CodeSessionState): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const INDEX_KEY = "atlas-code-sessions";
const stateKey = (id: string) => `atlas-code-session:${id}`;
const MAX_SESSIONS = 20;

function readIndex(): CodeSessionMeta[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeIndex(list: CodeSessionMeta[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    /* quota — ignore */
  }
}

const localRepo: CodeSessionsRepo = {
  remote: false,
  async list() {
    return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async load(id) {
    const meta = readIndex().find((m) => m.id === id);
    if (!meta) return null;
    try {
      const raw = localStorage.getItem(stateKey(id));
      const state = raw ? JSON.parse(raw) : { events: [], history: [] };
      return { meta, state };
    } catch {
      return { meta, state: { events: [], history: [] } };
    }
  },
  async save(meta, state) {
    let list = readIndex().filter((m) => m.id !== meta.id);
    list.unshift(meta);
    // Cap stored sessions; evict the stalest (list is fresh-first).
    if (list.length > MAX_SESSIONS) {
      for (const dead of list.slice(MAX_SESSIONS)) {
        try {
          localStorage.removeItem(stateKey(dead.id));
        } catch {
          /* ignore */
        }
      }
      list = list.slice(0, MAX_SESSIONS);
    }
    writeIndex(list);
    try {
      localStorage.setItem(stateKey(meta.id), JSON.stringify(state));
    } catch {
      /* quota — meta stays listable, conversation may not restore */
    }
  },
  async rename(id, name) {
    writeIndex(readIndex().map((m) => (m.id === id ? { ...m, name } : m)));
  },
  async remove(id) {
    writeIndex(readIndex().filter((m) => m.id !== id));
    try {
      localStorage.removeItem(stateKey(id));
    } catch {
      /* ignore */
    }
  },
};

// ── Supabase driver ─────────────────────────────────────────────────────────

function makeSupabaseRepo(): CodeSessionsRepo {
  // getSupabaseBrowser lazy-loads @supabase/supabase-js on first call.
  const db = async () => {
    const c = await getSupabaseBrowser();
    if (!c) throw new Error("Supabase not configured");
    return c;
  };
  const toMeta = (r: any): CodeSessionMeta => ({
    id: r.id,
    name: r.name,
    modelId: r.model_id ?? "",
    mode: r.mode ?? "agent",
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  });

  return {
    remote: true,
    async list() {
      const { data, error } = await (await db())
        .from("code_sessions")
        .select("id,name,model_id,mode,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map(toMeta);
    },
    async load(id) {
      const { data, error } = await (await db())
        .from("code_sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const state = (data.state ?? {}) as Partial<CodeSessionState>;
      return {
        meta: toMeta(data),
        state: {
          events: state.events ?? [],
          history: state.history ?? [],
          trace: state.trace,
        },
      };
    },
    async save(meta, state) {
      // Trace rides inside the `state` jsonb — no schema change required, and
      // pre-v2 readers simply ignore the extra key.
      const { error } = await (await db()).from("code_sessions").upsert({
        id: meta.id,
        name: meta.name,
        model_id: meta.modelId || null,
        mode: meta.mode,
        state: { events: state.events, history: state.history, trace: state.trace },
      });
      if (error) throw error;
    },
    async rename(id, name) {
      const { error } = await (await db()).from("code_sessions").update({ name }).eq("id", id);
      if (error) throw error;
    },
    async remove(id) {
      const { error } = await (await db()).from("code_sessions").delete().eq("id", id);
      if (error) throw error;
    },
  };
}

let cached: Promise<CodeSessionsRepo> | null = null;

/**
 * Async because driver choice depends on being signed in: with auth-scoped RLS
 * (migration 0005) the Supabase driver drops every write for a signed-out
 * visitor. See lib/chat/repo.ts for the same pattern.
 */
export function codeSessionsRepo(): Promise<CodeSessionsRepo> {
  if (!cached) {
    cached = remotePersistenceReady().then((ready) =>
      ready ? makeSupabaseRepo() : localRepo,
    );
  }
  return cached;
}

/** Re-pick the driver after a sign-in or sign-out. */
export function resetCodeSessionsRepo(): void {
  cached = null;
}
