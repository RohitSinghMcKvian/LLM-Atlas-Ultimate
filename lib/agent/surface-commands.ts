"use client";

import * as React from "react";
import { create } from "zustand";
import { hrefForOpen } from "@/lib/tools/atlas/open-tool";
import type { VoiceIntent } from "@/lib/voice/intent";

/**
 * Acting on the page someone is looking at.
 *
 * `surface-context.ts` is the read half: a module publishes one line about what
 * it is showing, so a question can be answered about it. This is the write half.
 * "Show only free models" said on the Leaderboard should change *that*
 * Leaderboard, not open a second one, and no tool can do that — `atlas_open`
 * navigates, which throws away scroll position, expanded rows and everything
 * else the person had set up.
 *
 * ### Falling back to navigation rather than refusing
 *
 * A command a surface cannot take is not an error. "Compare these two" said on
 * the News page means the same thing it means anywhere else; the difference is
 * that News cannot do it, and Compare can. `resolveCommand` therefore returns a
 * navigation for that case, built through `hrefForOpen` so there is exactly one
 * URL vocabulary in the app rather than a second one that drifts.
 *
 * The resolution is pure and lives here; the store below is the registry the
 * modules attach to, in the same shape as `useSurfaceContext`.
 */

export type SurfaceCommand =
  | { kind: "select"; op: "set" | "add" | "remove" | "clear"; modelIds: string[] }
  | {
      kind: "filter";
      access?: "free" | "byok" | "all";
      sort?: string;
      openWeights?: boolean;
      clear?: boolean;
    };

export interface SurfaceCommands {
  /** Module id from `lib/modules.ts`, matching what the module publishes. */
  moduleId: string;
  /** Which command kinds this surface can actually carry out. */
  accepts: SurfaceCommand["kind"][];
  /** Run one. Returns false when it turned out not to be possible after all. */
  run: (command: SurfaceCommand) => boolean;
}

interface SurfaceCommandState {
  handler: SurfaceCommands | null;
  register: (handler: SurfaceCommands | null) => void;
}

export const useSurfaceCommandStore = create<SurfaceCommandState>()((set) => ({
  handler: null,
  register: (handler) => set({ handler }),
}));

/**
 * Which module a command should be sent to when the current one cannot take it.
 *
 * Selection is Compare's job; filtering is the Leaderboard's. Both are the
 * module whose whole purpose is that operation, which is also where someone
 * saying it out loud almost certainly wants to end up.
 */
const FALLBACK_MODULE: Record<SurfaceCommand["kind"], "compare" | "leaderboard"> = {
  select: "compare",
  filter: "leaderboard",
};

/**
 * The Leaderboard's sort keys, in the words people actually say.
 *
 * Two vocabularies meet here and neither can be changed to suit the other. The
 * component's enum has `arena` and `release`, which nobody says out loud; the
 * spoken set has "speed" and "newest", which the component has never heard of.
 * Kept as data rather than a `switch` inside the component so the mapping is
 * testable — it is the only real logic in that handler, and burying it in a
 * component puts it beyond the reach of a node test suite.
 */
export const SPOKEN_SORT: Record<string, string> = {
  price: "price",
  intelligence: "intelligence",
  speed: "arena",
  context: "context",
  recency: "release",
};

/** The sort key a spoken word maps to, or null when it maps to none. */
export function sortKeyForSpoken(spoken: string | undefined): string | null {
  if (!spoken) return null;
  return SPOKEN_SORT[spoken] ?? null;
}

/** What a voice intent asks a surface to do, if anything. */
export function commandFor(intent: VoiceIntent): SurfaceCommand | null {
  if (intent.kind === "select") {
    return { kind: "select", op: intent.op, modelIds: intent.modelIds };
  }
  if (intent.kind === "filter") {
    return {
      kind: "filter",
      ...(intent.access ? { access: intent.access } : {}),
      ...(intent.sort ? { sort: intent.sort } : {}),
      ...(intent.openWeights ? { openWeights: intent.openWeights } : {}),
      ...(intent.clear ? { clear: intent.clear } : {}),
    };
  }
  return null;
}

export type CommandResolution =
  /** The current surface can do it. */
  | { kind: "surface"; command: SurfaceCommand }
  /** It cannot, but another module can, and this is where. */
  | { kind: "navigate"; href: string; moduleName: string; command: SurfaceCommand }
  /** Nothing can do it right now, and this says why in one line. */
  | { kind: "unsupported"; message: string };

/**
 * Decide where a command goes, without performing it.
 *
 * Pure: given the intent and what the current surface says it accepts, this is
 * the decision. The driver performs it.
 */
export function resolveCommand(
  intent: VoiceIntent,
  surface: { moduleId: string; accepts: SurfaceCommand["kind"][] } | null,
): CommandResolution | null {
  const command = commandFor(intent);
  if (!command) return null;

  if (surface?.accepts.includes(command.kind)) return { kind: "surface", command };

  const target = FALLBACK_MODULE[command.kind];
  // A selection with nothing named cannot be carried anywhere: "clear the
  // selection" on a page with no selection is a no-op, not a navigation.
  if (command.kind === "select" && command.modelIds.length === 0) {
    return { kind: "unsupported", message: "There is nothing selected here to clear." };
  }

  const resolved = hrefForOpen({
    module: target,
    ...(command.kind === "select" ? { model_ids: command.modelIds } : {}),
    ...(command.kind === "filter" && command.access && command.access !== "all"
      ? { access: command.access }
      : {}),
    reason: "voice command",
  });
  if ("error" in resolved) return { kind: "unsupported", message: resolved.error };

  return { kind: "navigate", href: resolved.href, moduleName: resolved.moduleName, command };
}

/**
 * Register this module as able to take voice commands.
 *
 * Mirrors `useSurfaceContext`: the handler is held in a ref so a module can
 * re-render freely, and the cleanup only clears the registry if the handler
 * still in it is this module's own — unmount order between an outgoing and an
 * incoming route is not guaranteed.
 */
export function useSurfaceCommands(handler: SurfaceCommands | null): void {
  const register = useSurfaceCommandStore((s) => s.register);
  const ref = React.useRef(handler);
  ref.current = handler;

  const key = handler ? `${handler.moduleId}|${handler.accepts.join(",")}` : "";
  React.useEffect(() => {
    // Wrapped so the registry always calls through to the *current* handler,
    // rather than to the closure captured when the effect last ran.
    const mine: SurfaceCommands | null = ref.current
      ? {
          moduleId: ref.current.moduleId,
          accepts: ref.current.accepts,
          run: (command) => ref.current?.run(command) ?? false,
        }
      : null;
    register(mine);
    return () => {
      if (useSurfaceCommandStore.getState().handler === mine) register(null);
    };
  }, [key, register]);
}
