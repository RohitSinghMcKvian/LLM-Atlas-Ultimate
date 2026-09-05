"use client";

import * as React from "react";
import { routerCalls, subscribeRouterCalls, type RouterCall } from "@/lib/router/telemetry";

/**
 * This browser's recent router traffic, re-rendering as it arrives.
 *
 * Server-rendered as empty, which is correct rather than a compromise: the log
 * is per-browser and per-session, so there is nothing for the server to know.
 */
export function useRouterCalls(): readonly RouterCall[] {
  return React.useSyncExternalStore(subscribeRouterCalls, routerCalls, empty);
}

const EMPTY: readonly RouterCall[] = [];
function empty(): readonly RouterCall[] {
  return EMPTY;
}

export interface RouterSummary {
  calls: number;
  /** Median time-to-first-token, ms, across calls that produced one. */
  medianTtftMs?: number;
  /** Share of calls that fell through to a backup provider, 0–1. */
  fallbackRate: number;
  /** Total priced spend, USD. Free routes contribute zero, honestly. */
  spendUsd: number;
  errors: number;
}

/**
 * Headline numbers over the same calls.
 *
 * Median rather than mean for latency: one cold 200-second NVIDIA route would
 * otherwise define the whole page, and the number people care about is what a
 * typical request felt like.
 */
export function summarizeRouterCalls(calls: readonly RouterCall[]): RouterSummary {
  const ttfts = calls
    .map((c) => c.ttftMs)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);

  return {
    calls: calls.length,
    medianTtftMs: ttfts.length > 0 ? ttfts[Math.floor(ttfts.length / 2)] : undefined,
    fallbackRate: calls.length > 0 ? calls.filter((c) => c.fellBack).length / calls.length : 0,
    spendUsd: calls.reduce((sum, c) => sum + (c.costUsd ?? 0), 0),
    errors: calls.filter((c) => c.status === "error").length,
  };
}
