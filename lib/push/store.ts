import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseServer } from "@/lib/supabase/server";
import { base64UrlEncode } from "./crypto";
import {
  DEFAULT_PUSH_PREFERENCES,
  normalisePreferences,
  type PushPreferences,
  type PushSubscriptionJson,
  type StoredPushSubscription,
} from "./types";

// Where subscriptions live.
//
// Two tiers, the same shape as `lib/news/store.ts`: Supabase when configured,
// and an in-process map on `globalThis` when it is not.
//
// THE ASYMMETRY WORTH KNOWING
//
// For the news corpus, the memory tier is a genuine fallback — a single instance
// syncs, serves, and is completely functional without a database. For push
// subscriptions it is much weaker, and the difference is the cron. The digest
// dispatcher runs in its own serverless invocation, which shares no memory with
// the invocation that took the subscription; without Supabase it finds an empty
// map and sends nothing. So the memory tier here is for local development and
// for long-lived single-process deployments, and `isPushDurable()` exists so the
// UI can be honest about it instead of promising a brief that will never arrive.

const MEMORY_KEY = Symbol.for("atlas.push.subscriptions");

type MemoryHost = typeof globalThis & {
  [MEMORY_KEY]?: Map<string, StoredPushSubscription>;
};

function memory(): Map<string, StoredPushSubscription> {
  const host = globalThis as MemoryHost;
  if (!host[MEMORY_KEY]) host[MEMORY_KEY] = new Map();
  return host[MEMORY_KEY];
}

/**
 * Consecutive ambiguous failures before a subscription is dropped.
 *
 * Seven hourly-eligible runs is at least a week for a daily subscriber. A phone
 * that has been off for a week is a phone; one that has answered nothing in a
 * month is a tombstone.
 */
const MAX_FAILURES = 7;

/**
 * The primary key: SHA-256 of the endpoint.
 *
 * Derived rather than random for two reasons. It makes re-subscription
 * idempotent — a browser that hands back the same endpoint upserts onto its own
 * row instead of leaving a duplicate behind on every visit — and it keeps the
 * raw endpoint, which is a bearer credential, out of every place a primary key
 * ends up being printed.
 */
export function subscriptionId(endpoint: string): string {
  return base64UrlEncode(createHash("sha256").update(endpoint).digest());
}

/** Whether subscriptions survive the process. See the note at the top of the file. */
export function isPushDurable(): boolean {
  return getSupabaseServer() !== null;
}

interface Row {
  id: string;
  subscription: PushSubscriptionJson;
  preferences: unknown;
  created_at: string;
  updated_at: string;
  last_sent_at: string | null;
  failures: number | null;
}

function fromRow(row: Row): StoredPushSubscription {
  return {
    id: row.id,
    subscription: row.subscription,
    preferences: normalisePreferences(row.preferences),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSentAt: row.last_sent_at ?? undefined,
    failures: row.failures ?? 0,
  };
}

export async function saveSubscription(
  subscription: PushSubscriptionJson,
  preferences: Partial<PushPreferences> = {},
): Promise<StoredPushSubscription> {
  const id = subscriptionId(subscription.endpoint);
  const now = new Date().toISOString();

  const existing = await getSubscription(id);
  const merged = normalisePreferences(
    { ...(existing?.preferences ?? DEFAULT_PUSH_PREFERENCES), ...preferences },
    existing?.preferences ?? DEFAULT_PUSH_PREFERENCES,
  );

  const record: StoredPushSubscription = {
    id,
    subscription,
    preferences: merged,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSentAt: existing?.lastSentAt,
    // A re-subscribe is proof of life. Whatever the failure count was, this
    // endpoint is demonstrably reachable now.
    failures: 0,
  };

  memory().set(id, record);

  const supabase = getSupabaseServer();
  if (supabase) {
    await supabase.from("news_push_subscriptions").upsert(
      {
        id,
        subscription,
        preferences: merged,
        created_at: record.createdAt,
        updated_at: now,
        last_sent_at: record.lastSentAt ?? null,
        failures: 0,
      },
      { onConflict: "id" },
    );
  }

  return record;
}

export async function getSubscription(id: string): Promise<StoredPushSubscription | null> {
  const supabase = getSupabaseServer();
  if (!supabase) return memory().get(id) ?? null;

  const { data, error } = await supabase
    .from("news_push_subscriptions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return memory().get(id) ?? null;
  return fromRow(data as Row);
}

export async function deleteSubscription(id: string): Promise<void> {
  memory().delete(id);
  const supabase = getSupabaseServer();
  if (supabase) await supabase.from("news_push_subscriptions").delete().eq("id", id);
}

/**
 * Every subscription, for the dispatcher to filter.
 *
 * Filtering happens in application code rather than in SQL because the predicate
 * is arithmetic over two stored fields — `hour` and `utcOffsetMinutes` — and
 * expressing "local hour equals this UTC hour" as a jsonb expression would be
 * both unreadable and unindexed anyway. The bound is what keeps this honest: a
 * single run dispatches at most `limit` subscribers, and the rest roll into the
 * next hour rather than blowing the invocation's time budget.
 */
export async function listSubscriptions(limit = 2_000): Promise<StoredPushSubscription[]> {
  const supabase = getSupabaseServer();
  if (!supabase) return [...memory().values()].slice(0, limit);

  const { data, error } = await supabase
    .from("news_push_subscriptions")
    // Never-sent first, then longest-waiting. A new subscriber gets their first
    // brief promptly, and no one can be starved by a table that outgrows `limit`.
    .select("*")
    .order("last_sent_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error || !data) return [...memory().values()].slice(0, limit);
  return (data as Row[]).map(fromRow);
}

export async function markSent(id: string, at = new Date().toISOString()): Promise<void> {
  const local = memory().get(id);
  if (local) memory().set(id, { ...local, lastSentAt: at, failures: 0 });

  const supabase = getSupabaseServer();
  if (supabase) {
    await supabase
      .from("news_push_subscriptions")
      .update({ last_sent_at: at, failures: 0 })
      .eq("id", id);
  }
}

/**
 * Record an ambiguous delivery failure, deleting the subscription once it has
 * failed often enough to be considered dead.
 *
 * Returns whether the row was dropped, so the dispatcher can report a prune
 * count distinct from a failure count — the two mean very different things when
 * a run looks wrong.
 */
export async function markFailure(id: string): Promise<boolean> {
  const current = await getSubscription(id);
  const failures = (current?.failures ?? 0) + 1;

  if (failures >= MAX_FAILURES) {
    await deleteSubscription(id);
    return true;
  }

  const local = memory().get(id);
  if (local) memory().set(id, { ...local, failures });

  const supabase = getSupabaseServer();
  if (supabase) {
    await supabase.from("news_push_subscriptions").update({ failures }).eq("id", id);
  }

  return false;
}

export interface PushRunLog {
  utcHour: number;
  candidates: number;
  sent: number;
  failed: number;
  pruned: number;
  leadArticle?: string;
  error?: string;
}

export async function recordPushRun(log: PushRunLog): Promise<void> {
  const supabase = getSupabaseServer();
  if (!supabase) return;
  await supabase.from("news_push_runs").insert({
    utc_hour: log.utcHour,
    candidates: log.candidates,
    sent: log.sent,
    failed: log.failed,
    pruned: log.pruned,
    lead_article: log.leadArticle ?? null,
    error: log.error ?? null,
  });
}
