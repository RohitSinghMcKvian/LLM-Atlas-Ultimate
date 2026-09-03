"use client";

import * as React from "react";

// The feed keeps itself current. There is no Sync button.
//
// WHY THE BUTTON WENT AWAY
//
// A Refresh control on a news feed is an admission that the product cannot tell
// when it is out of date. It also lied by omission: pressing it inside the
// server's cooldown window did nothing upstream, and the honest "up to date,
// next sync in 6 minutes" that replaced the spinner was a good fix to a problem
// that should not have been the reader's to see at all.
//
// HOW FRESHNESS ACTUALLY HAPPENS NOW
//
// Reading `/api/v1/news` is itself the trigger. `getNewsSnapshot()` schedules a
// background sweep whenever the corpus it is about to serve is older than the
// interval, so a poll costs one small JSON response and keeps the server's
// corpus moving without anyone asking it to. The explicit nudge below exists
// only for the case where that has demonstrably not worked.
//
// THE RULE THAT MATTERS MOST
//
// Never re-order the page under someone who is reading it. New stories are
// adopted instantly at the top of the feed and held as a count anywhere else.
// A feed that reshuffles mid-sentence is worse than a stale one.

/** How often to ask the server what it has, while the tab is visible. */
const POLL_MS = 90_000;

/**
 * Floor between focus-triggered checks.
 *
 * Alt-tabbing repeatedly is a normal thing to do and must not turn into a
 * request per keystroke.
 */
const FOCUS_THROTTLE_MS = 30_000;

/**
 * Scroll depth under which a reader counts as "at the top", and therefore as
 * someone who can have the feed updated beneath them without losing their place.
 */
const TOP_OF_FEED_PX = 400;

/** Minimum gap between explicit refresh nudges from one tab. */
const NUDGE_INTERVAL_MS = 10 * 60_000;

export type AutoSyncPhase = "idle" | "checking" | "updating" | "offline";

export interface AutoSyncStatus {
  phase: AutoSyncPhase;
  /** Stories fetched and deliberately withheld because the reader is mid-page. */
  pending: number;
  /** Last time the server answered, for the status pill. Null before the first check. */
  checkedAt: number | null;
  /** Reveal what is being held. Called by the "new stories" ribbon. */
  reveal: () => void;
}

export interface UseNewsAutoSyncOptions {
  /** Content hash of the corpus currently on screen. */
  version: string;
  /** Adopt the server's corpus. Returns the new article count, or null on failure. */
  onAdopt: () => Promise<number | null>;
  /** Articles on screen now, so a held update can be described as a count. */
  articleCount: number;
  /**
   * Off during the cold-start poll, which is a different loop with a different
   * cadence and would otherwise double every request.
   */
  enabled?: boolean;
}

interface StatsResponse {
  version?: string;
  syncedAt?: string;
  /** Server's own verdict, so client and server cannot drift on the threshold. */
  stale?: boolean;
  stats?: { articles?: number };
}

export function useNewsAutoSync({
  version,
  onAdopt,
  articleCount,
  enabled = true,
}: UseNewsAutoSyncOptions): AutoSyncStatus {
  const [phase, setPhase] = React.useState<AutoSyncPhase>("idle");
  const [checkedAt, setCheckedAt] = React.useState<number | null>(null);
  const [pending, setPending] = React.useState(0);

  // Refs rather than state for everything the effect reads but must not restart
  // on. Putting `version` in the dependency list would tear down and rebuild the
  // interval on every adoption, which quietly turns a 90-second poll into a
  // burst every time the news changes.
  const versionRef = React.useRef(version);
  const countRef = React.useRef(articleCount);
  const adoptRef = React.useRef(onAdopt);
  const lastNudgeRef = React.useRef(0);
  const lastFocusCheckRef = React.useRef(0);

  versionRef.current = version;
  countRef.current = articleCount;
  adoptRef.current = onAdopt;

  // A held update is only meaningful against the corpus it was measured from.
  // Once the reader adopts it, or a newer one arrives, the old count is stale.
  const heldVersionRef = React.useRef<string | null>(null);

  const adopt = React.useCallback(async (): Promise<void> => {
    setPhase("updating");
    const count = await adoptRef.current();
    setPending(0);
    heldVersionRef.current = null;
    if (count !== null) countRef.current = count;
    setPhase("idle");
  }, []);

  const reveal = React.useCallback(() => {
    void adopt();
    // Bring the reader to what they just asked to see. Without this the count
    // clears and the new stories are somewhere above the fold, which reads as
    // the button having done nothing.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [adopt]);

  /**
   * Ask the server what it has.
   *
   * `?fields=stats` is a few hundred bytes rather than the corpus, and — the
   * part that makes the whole design work — reading it is what schedules the
   * server's background sweep when the corpus has gone stale.
   */
  const check = React.useCallback(async (): Promise<void> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setPhase("offline");
      return;
    }

    setPhase((prev) => (prev === "updating" ? prev : "checking"));

    let body: StatsResponse;
    try {
      const response = await fetch("/api/v1/news?fields=stats", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      body = (await response.json()) as StatsResponse;
    } catch {
      // A dropped connection, a cold serverless instance, a deploy in progress.
      // The page keeps rendering what it has and the next tick tries again.
      setPhase("idle");
      return;
    }

    setCheckedAt(Date.now());
    setPhase("idle");

    // The corpus is older than the server's own interval, which means the
    // read-triggered sweep is not keeping up — a stale Supabase cache, or a
    // platform where `after()` never ran. Ask once, then leave it alone: the
    // endpoint has a global cooldown and this must not become a poll.
    if (body.stale) void nudge(lastNudgeRef);

    const nextVersion = body.version;
    if (!nextVersion || nextVersion === versionRef.current) {
      // Nothing new. Any count we were holding is now provably obsolete.
      if (heldVersionRef.current && heldVersionRef.current !== nextVersion) {
        setPending(0);
        heldVersionRef.current = null;
      }
      return;
    }

    if (atTopOfFeed()) {
      await adopt();
      return;
    }

    // Held. The count is approximate by construction — the server reports its
    // whole corpus and the client holds a ranked slice — so it is rendered as
    // "new stories", never as an exact figure the reader could check.
    const serverCount = body.stats?.articles ?? 0;
    heldVersionRef.current = nextVersion;
    setPending(Math.max(1, serverCount - countRef.current));
  }, [adopt]);

  // The poll, plus the two moments a reader is most likely to want fresh data:
  // returning to the tab, and reconnecting.
  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let cancelled = false;
    const tick = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      void check();
    };

    const interval = window.setInterval(tick, POLL_MS);

    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusCheckRef.current < FOCUS_THROTTLE_MS) return;
      lastFocusCheckRef.current = now;
      tick();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };

    const onOnline = () => {
      setPhase("idle");
      onFocus();
    };

    const onOffline = () => setPhase("offline");

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [enabled, check]);

  return { phase, pending, checkedAt, reveal };
}

function atTopOfFeed(): boolean {
  if (typeof window === "undefined") return true;
  return window.scrollY <= TOP_OF_FEED_PX;
}

/**
 * Ask the server to sweep upstream now.
 *
 * Fire and forget, and rate-limited twice over: once by this tab's own interval,
 * and once by the endpoint's global cooldown, which bounds every client in the
 * world to one upstream sweep per window regardless of how many ask. A failure
 * is genuinely uninteresting — the read path already scheduled a sweep, and this
 * was only ever the belt to that braces.
 */
async function nudge(last: React.MutableRefObject<number>): Promise<void> {
  const now = Date.now();
  if (now - last.current < NUDGE_INTERVAL_MS) return;
  last.current = now;

  try {
    await fetch("/api/v1/news/refresh", {
      method: "POST",
      // The endpoint's CSRF guard: a cross-origin form POST cannot set this
      // without a preflight, and the route sends no CORS headers.
      headers: { "x-atlas-refresh": "1" },
      keepalive: true,
    });
  } catch {
    /* nothing to do and nothing to say */
  }
}
