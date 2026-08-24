"use client";

import { create } from "zustand";
import { MODULES } from "@/lib/modules";

/**
 * What is on screen where the question was asked.
 *
 * This is the difference between a floating chat box and an assistant. Asked
 * "is this one worth it" on the leaderboard with three models filtered, the
 * useful answer is about those three; without the context it is a request for
 * clarification, which is what makes most in-app assistants annoying.
 *
 * A module opts in with one `useSurfaceContext(...)` call and publishes a small
 * serialisable summary of its own state. Nothing is inferred by reading the DOM:
 * a module knows what it is showing and a scraper only guesses.
 *
 * Deliberately small. This text goes into a system prompt on every question, so
 * a module that publishes its entire state would push the retrieved facts out of
 * the window to say something the user can already see.
 */

export interface SurfaceContext {
  /** Module id from `lib/modules.ts`, so the label and the route come for free. */
  moduleId: string;
  /** One line: what the person is looking at right now. */
  summary: string;
  /** Ids the question is most likely about - selected models, an open article. */
  focus?: string[];
}

interface SurfaceState {
  context: SurfaceContext | null;
  publish: (context: SurfaceContext | null) => void;
}

export const useSurfaceStore = create<SurfaceState>()((set) => ({
  context: null,
  publish: (context) => set({ context }),
}));

/** Longest summary accepted. Past this it is competing with the answer. */
export const MAX_SUMMARY_CHARS = 240;

/**
 * Render the context as one prompt line.
 *
 * Falls back to the module's own name when nothing was published, which is
 * still worth having: "they are on the Cost page" changes what a good answer
 * looks like even with no detail behind it.
 */
export function describeSurface(context: SurfaceContext | null, pathname?: string): string {
  if (context) {
    const mod = MODULES.find((m) => m.id === context.moduleId);
    const where = mod ? mod.name : context.moduleId;
    const summary = context.summary.slice(0, MAX_SUMMARY_CHARS);
    const focus = context.focus?.length ? ` Focus: ${context.focus.slice(0, 8).join(", ")}.` : "";
    return `${where} - ${summary}${focus}`;
  }
  const mod = pathname ? moduleForPath(pathname) : undefined;
  return mod ? `${mod.name} - ${mod.tagline}` : "";
}

/** Longest-prefix match, so `/chat/anything` still resolves to Chat. */
export function moduleForPath(pathname: string) {
  let best: (typeof MODULES)[number] | undefined;
  for (const m of MODULES) {
    if (pathname === m.href || pathname.startsWith(`${m.href}/`)) {
      if (!best || m.href.length > best.href.length) best = m;
    }
  }
  return best;
}
