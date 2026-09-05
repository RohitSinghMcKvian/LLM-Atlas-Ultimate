"use client";

import { getModelById } from "@/lib/catalog";
import { routeCost } from "@/lib/catalog/availability";
import type { ProviderId } from "@/lib/catalog/types";

// What the router actually did, in this browser.
//
// The Router page used to present a fabricated traffic log: five hardcoded
// entries ("Claude 3.5 Sonnet", "GPT-4o mini") plus a timer that invented a
// random model, latency and status every 2.6 seconds. It looked like
// observability and told you nothing — a page whose entire subject is routing
// was the one page in Atlas with no routing data on it.
//
// This is the real thing, and it is deliberately small. Every model call in the
// app goes through `postSSE("/api/v1/router/chat", …)` — Chat, Code, Compare,
// Playground, Bench, Learn, Prompt and Orchestra, eighteen call sites — so a tap
// at that one seam sees all of them without any of them knowing. Wiring each
// caller instead would mean eighteen chances to forget one, which is how this
// repo keeps ending up with subsystems that work in isolation and are never
// reached.
//
// Client-side and in-memory on purpose: it is this person's own traffic, it
// never leaves the tab, and it costs nothing when nobody is looking at it.

/** Calls retained. A page shows the recent past, not an audit log. */
const CAPACITY = 25;

export interface RouterCall {
  id: string;
  /** Atlas model id the caller asked for. */
  modelId: string;
  /** Display name at the time of the call, so a later resync cannot blank it. */
  modelName: string;
  /** The provider that actually served it — may differ from the caller's first choice. */
  provider?: ProviderId;
  /** True when the router fell through to a backup provider mid-request. */
  fellBack: boolean;
  startedAt: number;
  /** Milliseconds to the first content token. */
  ttftMs?: number;
  /** Milliseconds to `done`. */
  totalMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  /**
   * USD this call actually cost the user.
   *
   * Zero on a free route, which is not the same as the catalog's list price for
   * the model: `gpt-oss-120b` lists at a real $/Mtok and costs the user nothing
   * when NVIDIA serves it on the operator's key. Pricing from `model.pricing`
   * alone reported a charge for a model the whole product describes as free.
   */
  costUsd?: number;
  status: "streaming" | "ok" | "error";
  /** Present when `status === "error"`. */
  error?: string;
}

type Listener = () => void;

// On `globalThis` for the same reason the catalog pointer is: the app code-splits
// aggressively, and a plain module variable would give each dynamic chunk its own
// empty log.
const KEY = Symbol.for("atlas.router.telemetry");

interface Store {
  calls: RouterCall[];
  listeners: Set<Listener>;
}

type Host = typeof globalThis & { [KEY]?: Store };

function store(): Store {
  const host = globalThis as Host;
  return (host[KEY] ??= { calls: [], listeners: new Set() });
}

function emit(s: Store): void {
  // A fresh array each time, so `useSyncExternalStore` sees a new reference and
  // React re-renders. Mutating in place would silently do nothing.
  for (const listener of s.listeners) listener();
}

export function subscribeRouterCalls(listener: Listener): () => void {
  const { listeners } = store();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function routerCalls(): readonly RouterCall[] {
  return store().calls;
}

/** Test-only: forget everything recorded so far. */
export function resetRouterCalls(): void {
  const s = store();
  s.calls = [];
  emit(s);
}

let seq = 0;

/**
 * Start recording a call. Returns a handle the tap feeds events into.
 *
 * The name is resolved now rather than at read time because the catalog
 * regenerates daily: a model retired an hour after you called it should still
 * show the name it had when you called it.
 */
export function beginRouterCall(modelId: string): RouterCallRecorder {
  const s = store();
  const call: RouterCall = {
    id: `rc-${++seq}-${Date.now().toString(36)}`,
    modelId,
    modelName: getModelById(modelId)?.name ?? modelId,
    fellBack: false,
    startedAt: Date.now(),
    status: "streaming",
  };

  s.calls = [call, ...s.calls].slice(0, CAPACITY);
  emit(s);

  return new RouterCallRecorder(call);
}

/**
 * A single in-flight call.
 *
 * Every mutation replaces the entry rather than editing it, because the array is
 * read through `useSyncExternalStore` and an in-place edit is invisible to React.
 */
export class RouterCallRecorder {
  #id: string;
  #firstProvider?: ProviderId;
  /** Whether the route that served this call costs the user nothing. */
  #free = false;

  constructor(call: RouterCall) {
    this.#id = call.id;
  }

  #patch(patch: Partial<RouterCall>): void {
    const s = store();
    let changed = false;
    s.calls = s.calls.map((c) => {
      if (c.id !== this.#id) return c;
      changed = true;
      return { ...c, ...patch };
    });
    if (changed) emit(s);
  }

  /**
   * The provider serving this request.
   *
   * Emitted once up front, and again if a free model falls through to a backup
   * provider after a 429 or 5xx. The second one is the interesting event — it is
   * failover actually happening, which is the Router's whole pitch — so it is
   * recorded as such rather than silently overwriting the first.
   */
  provider(provider: ProviderId): void {
    this.#free = this.#isFreeOn(provider);
    if (this.#firstProvider === undefined) {
      this.#firstProvider = provider;
      this.#patch({ provider });
      return;
    }
    if (provider === this.#firstProvider) return;
    this.#patch({ provider, fellBack: true });
  }

  /**
   * Does this provider serve this model for free?
   *
   * `routeCost` needs no `RouteEnv`: zero-cost-ness is a pure function of the
   * provider's billing model and the route id. That is what makes it usable
   * here, in a module with no React context to read the environment from — and
   * it is the same function the picker's Free badge and the server's routing
   * both go through, so the three cannot disagree.
   */
  #isFreeOn(provider: ProviderId): boolean {
    const call = store().calls.find((c) => c.id === this.#id);
    const model = call ? getModelById(call.modelId) : undefined;
    if (!model) return false;
    const route = model.routes.find((r) => r.provider === provider);
    return route ? routeCost(route, model) === "free" : false;
  }

  /** First content token — the number people actually feel. */
  firstToken(): void {
    const existing = store().calls.find((c) => c.id === this.#id);
    if (!existing || existing.ttftMs !== undefined) return;
    this.#patch({ ttftMs: Date.now() - existing.startedAt });
  }

  usage(usage: { promptTokens?: number; completionTokens?: number }): void {
    const call = store().calls.find((c) => c.id === this.#id);
    const model = call ? getModelById(call.modelId) : undefined;
    const inTok = usage.promptTokens ?? 0;
    const outTok = usage.completionTokens ?? 0;
    const costUsd = this.#free
      ? 0
      : model
        ? (inTok / 1_000_000) * model.pricing.inputPerM +
          (outTok / 1_000_000) * model.pricing.outputPerM
        : undefined;
    this.#patch({
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd,
    });
  }

  finish(): void {
    const call = store().calls.find((c) => c.id === this.#id);
    if (!call || call.status !== "streaming") return;
    this.#patch({ status: "ok", totalMs: Date.now() - call.startedAt });
  }

  fail(error: string): void {
    const call = store().calls.find((c) => c.id === this.#id);
    if (!call || call.status !== "streaming") return;
    this.#patch({ status: "error", error, totalMs: Date.now() - call.startedAt });
  }
}
