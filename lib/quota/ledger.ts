import { getSupabaseServer, isSupabaseServerConfigured } from "@/lib/supabase/server";
import type { ProviderId } from "@/lib/catalog/types";
import type { LaneUnit } from "./lanes";
import { windowEnd, windowKey, type WindowKind } from "./windows";

// Where the spend count lives.
//
// Two tiers, and the app must work with either:
//
//   * **Supabase** — durable and shared, so several server instances counting
//     against one operator key agree. This is the only tier that makes the
//     count correct rather than merely indicative.
//   * **In-process** — a plain map, per instance. What a self-hosted or
//     preview deployment gets. It under-counts across instances and forgets on
//     recycle, which is stated plainly rather than hidden: an approximate limit
//     that works everywhere beats an exact one that needs infrastructure this
//     project does not require.
//
// A failed ledger read or write never blocks a request. The ledger is a spend
// mitigation; refusing to serve because the database is unreachable would turn
// an optional dependency into a required one.

/** `${lane}:${kind}:${unit}` — one countable window. */
export type CounterKey = string;

export function counterKey(lane: ProviderId, kind: WindowKind, unit: LaneUnit): CounterKey {
  return `${lane}:${kind}:${unit}`;
}

export type UsageMap = ReadonlyMap<CounterKey, number>;

/** The window kinds every bump touches. Reads pick out the ones they need. */
const KINDS: readonly WindowKind[] = ["minute", "day", "month"];

// ── In-process tier ─────────────────────────────────────────────────────────
//
// Held on `globalThis` rather than in module scope. Next compiles each route
// handler into its own module graph, so a plain module-level Map gives every
// route a private copy — one route would meter while the next served free. The
// catalog store does the same thing for the same reason.

interface MemoryCell {
  requests: number;
  tokens: number;
  /** When this row's window rolls over, for the sweep. */
  expiresAt: number;
}

const MEMORY_KEY = Symbol.for("atlas.quota.counters");
type MemoryHost = typeof globalThis & { [MEMORY_KEY]?: Map<string, MemoryCell> };

function memory(): Map<string, MemoryCell> {
  const host = globalThis as MemoryHost;
  host[MEMORY_KEY] ??= new Map();
  return host[MEMORY_KEY];
}

function rowKey(subject: string, lane: ProviderId, kind: WindowKind, now: number): string {
  return `${subject}|${lane}|${kind}|${windowKey(kind, now)}`;
}

/**
 * Drop rows whose window has passed.
 *
 * Called on write rather than on a timer: without it the map grows once per
 * distinct (subject, lane, minute) forever, and a minute window makes that
 * fast. An expired row is indistinguishable from an absent one, so this loses
 * nothing.
 */
function sweepMemory(now: number): void {
  const m = memory();
  if (m.size < 512) return;
  for (const [k, cell] of m) if (cell.expiresAt <= now) m.delete(k);
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Spend recorded against `subject` for these lanes, in their current windows.
 *
 * Absent counters are simply absent from the map — the caller treats a missing
 * key as zero, which is the same thing a fresh window means.
 */
export async function readUsage(
  subject: string,
  lanes: readonly ProviderId[],
  now: number = Date.now(),
): Promise<UsageMap> {
  if (lanes.length === 0) return new Map();

  if (isSupabaseServerConfigured()) {
    const remote = await readSupabase(subject, lanes, now);
    if (remote) return remote;
  }

  const out = new Map<CounterKey, number>();
  const m = memory();
  for (const lane of lanes) {
    for (const kind of KINDS) {
      const cell = m.get(rowKey(subject, lane, kind, now));
      if (!cell) continue;
      if (cell.requests) out.set(counterKey(lane, kind, "requests"), cell.requests);
      if (cell.tokens) out.set(counterKey(lane, kind, "tokens"), cell.tokens);
    }
  }
  return out;
}

interface UsageRow {
  lane: string;
  window_kind: string;
  window_start: string;
  requests: number;
  tokens: number;
}

async function readSupabase(
  subject: string,
  lanes: readonly ProviderId[],
  now: number,
): Promise<UsageMap | null> {
  const client = getSupabaseServer();
  if (!client) return null;

  // The three current windows, so a stale row from a window that has already
  // rolled over is never counted against the caller.
  const current = new Set(KINDS.map((k) => `${k}|${windowKey(k, now)}`));

  try {
    const { data, error } = await client
      .from("usage_counters")
      .select("lane, window_kind, window_start, requests, tokens")
      .eq("subject", subject)
      .in("lane", lanes as string[])
      // Nothing older than the current month window can still be live.
      .gte("window_start", windowKey("month", now));
    if (error || !data) return null;

    const out = new Map<CounterKey, number>();
    for (const row of data as UsageRow[]) {
      const kind = row.window_kind as WindowKind;
      // Compare as instants: Postgres renders timestamptz with its own
      // formatting ("+00:00" rather than "Z"), so string equality would miss.
      const stamp = new Date(row.window_start).toISOString();
      if (!current.has(`${kind}|${stamp}`)) continue;
      if (row.requests) out.set(counterKey(row.lane as ProviderId, kind, "requests"), row.requests);
      if (row.tokens) out.set(counterKey(row.lane as ProviderId, kind, "tokens"), row.tokens);
    }
    return out;
  } catch {
    // Unreachable database: fall through to the in-process tier rather than
    // failing the request.
    return null;
  }
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Record one request (and optionally its tokens) against a lane.
 *
 * Fire-and-forget by contract: the caller is streaming a response and must not
 * wait on a counter. Errors are swallowed for the same reason — an
 * under-counted lane degrades the mitigation, a thrown error breaks the turn.
 */
export async function bumpUsage(
  subject: string,
  lane: ProviderId,
  delta: { requests?: number; tokens?: number } = {},
  now: number = Date.now(),
): Promise<void> {
  const count = (n: number | undefined, fallback: number) =>
    Number.isFinite(n) && (n as number) > 0 ? Math.round(n as number) : fallback;
  // Requests default to 1 — the overwhelmingly common call is "one request
  // happened". Tokens default to 0 because they are not known yet at that
  // moment, and arrive in a second call once the stream reports them.
  const requests = count(delta.requests, delta.requests === undefined ? 1 : 0);
  const tokens = count(delta.tokens, 0);
  if (requests === 0 && tokens === 0) return;

  if (isSupabaseServerConfigured()) {
    const ok = await bumpSupabase(subject, lane, requests, tokens, now);
    if (ok) return;
  }

  sweepMemory(now);
  const m = memory();
  for (const kind of KINDS) {
    const key = rowKey(subject, lane, kind, now);
    const cell = m.get(key) ?? { requests: 0, tokens: 0, expiresAt: windowEnd(kind, now) };
    cell.requests += requests;
    cell.tokens += tokens;
    m.set(key, cell);
  }
}

async function bumpSupabase(
  subject: string,
  lane: ProviderId,
  requests: number,
  tokens: number,
  now: number,
): Promise<boolean> {
  const client = getSupabaseServer();
  if (!client) return false;
  try {
    // Window starts are computed here rather than by the database so that the
    // app and the ledger cannot disagree about where a window begins — a
    // Postgres session on a non-UTC TimeZone would otherwise silently split
    // every month boundary. `windows.ts` is the single definition, and it is
    // tested.
    const { error } = await client.rpc("bump_usage", {
      p_subject: subject,
      p_lane: lane,
      p_requests: requests,
      p_tokens: tokens,
      p_windows: KINDS.map((kind) => ({ kind, start: windowKey(kind, now) })),
    });
    return !error;
  } catch {
    return false;
  }
}

/** One window's observed spend, as reported by the provider itself. */
export interface ObservedWindow {
  kind: WindowKind;
  requests?: number;
  tokens?: number;
}

/**
 * Reconcile counters upward to the provider's own figures.
 *
 * MONOTONE ON PURPOSE — a counter may only ever be raised. The provider knows
 * about spend Atlas cannot see (another deployment on the same key, a request
 * counted upstream but never completed here), so its numbers are authoritative
 * when they are *higher*. When they are lower it is usually because this
 * instance has just made requests the provider has not yet reflected, and
 * lowering would hand back allowance that is already gone. Two instances
 * reconciling against slightly different snapshots would also flap the counter
 * up and down forever.
 */
export async function raiseUsage(
  subject: string,
  lane: ProviderId,
  windows: readonly ObservedWindow[],
  now: number = Date.now(),
): Promise<void> {
  const clean = windows
    .map((w) => ({
      kind: w.kind,
      requests: Math.max(0, Math.round(Number.isFinite(w.requests) ? w.requests! : 0)),
      tokens: Math.max(0, Math.round(Number.isFinite(w.tokens) ? w.tokens! : 0)),
    }))
    .filter((w) => w.requests > 0 || w.tokens > 0);
  if (clean.length === 0) return;

  if (isSupabaseServerConfigured()) {
    const client = getSupabaseServer();
    if (client) {
      try {
        const { error } = await client.rpc("raise_usage", {
          p_subject: subject,
          p_lane: lane,
          p_windows: clean.map((w) => ({ ...w, start: windowKey(w.kind, now) })),
        });
        if (!error) return;
      } catch {
        // Fall through to the in-process tier.
      }
    }
  }

  const m = memory();
  for (const w of clean) {
    const key = rowKey(subject, lane, w.kind, now);
    const cell = m.get(key) ?? { requests: 0, tokens: 0, expiresAt: windowEnd(w.kind, now) };
    cell.requests = Math.max(cell.requests, w.requests);
    cell.tokens = Math.max(cell.tokens, w.tokens);
    m.set(key, cell);
  }
}

/** Test seam: drop the in-process tier. Never called in production code. */
export function resetLedgerMemory(): void {
  memory().clear();
}
