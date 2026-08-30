"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BAND_LABEL, BAND_RGB } from "@/lib/compare/bands";
import type { LaneState } from "@/lib/compare/types";
import { getModelById } from "@/lib/catalog";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { LaneCard } from "./lane-card";

/**
 * The lanes, side by side.
 *
 * Replaces a horizontal scroller of fixed 300px columns — a layout that made a
 * three-way comparison a left-and-right drag on every screen size, and made
 * reading two answers against each other impossible because they scrolled
 * independently.
 *
 * Two behaviours do most of the work here:
 *
 *   * **Locked scrolling.** Answers are different lengths, so the lanes are tied
 *     by scroll *fraction* rather than by pixel: at 40% of one answer you are at
 *     40% of the others, which is where the comparable passage actually is.
 *   * **Focus.** One lane to two-thirds width with the rest as rails, for when
 *     the comparison is over and you just want to read the winner.
 */

export interface LaneGridProps {
  lanes: LaneState[];
  blind?: boolean;
  syncScroll?: boolean;
  focusedId?: string | null;
  onFocus?: (id: string | null) => void;
  onStop?: (id: string) => void;
  onRetry?: (id: string) => void;
  onConnectKey?: () => void;
}

export function LaneGrid({
  lanes,
  blind = false,
  syncScroll = false,
  focusedId = null,
  onFocus,
  onStop,
  onRetry,
  onConnectKey,
}: LaneGridProps) {
  const reduced = useReducedMotion();
  const bodies = React.useRef(new Map<string, HTMLDivElement>());
  // Set while this component is the one moving a scroll position, so the
  // `onScroll` events it causes do not bounce back and fight the user.
  const syncing = React.useRef(false);

  const registerBody = React.useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) bodies.current.set(id, el);
    else bodies.current.delete(id);
  }, []);

  const handleScroll = React.useCallback(
    (id: string, top: number) => {
      if (!syncScroll || syncing.current) return;
      const source = bodies.current.get(id);
      if (!source) return;
      const sourceRange = source.scrollHeight - source.clientHeight;
      // A lane short enough not to scroll has no position to share.
      if (sourceRange <= 0) return;
      const fraction = top / sourceRange;

      syncing.current = true;
      for (const [otherId, el] of bodies.current) {
        if (otherId === id) continue;
        const range = el.scrollHeight - el.clientHeight;
        if (range <= 0) continue;
        el.scrollTop = fraction * range;
      }
      // Released on the next frame: the assignments above queue their own
      // scroll events, which arrive before a microtask would clear this.
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    },
    [syncScroll],
  );

  if (lanes.length === 0) return null;

  const focused = focusedId ? lanes.find((l) => l.id === focusedId) : undefined;

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "grid gap-3",
          focused
            ? "lg:grid-cols-3"
            : lanes.length === 1
              ? "grid-cols-1"
              : "sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4",
        )}
      >
        {focused ? (
          <>
            <LaneCard
              key={focused.id}
              lane={focused}
              blind={blind}
              focused
              onFocus={onFocus}
              onStop={onStop}
              onRetry={onRetry}
              onConnectKey={onConnectKey}
              scrollRef={registerBody}
              onScroll={handleScroll}
              className="h-[min(70vh,44rem)] lg:col-span-2"
            />
            <div className="flex flex-col gap-2">
              {lanes
                .filter((l) => l.id !== focused.id)
                .map((lane) => (
                  <LaneRail key={lane.id} lane={lane} blind={blind} onFocus={onFocus} />
                ))}
            </div>
          </>
        ) : (
          lanes.map((lane, i) => (
            <motion.div
              key={lane.id}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: reduced ? 0 : i * 0.06, ease: EASE }}
              className="flex min-w-0"
            >
              <LaneCard
                lane={lane}
                blind={blind}
                onFocus={onFocus}
                onStop={onStop}
                onRetry={onRetry}
                onConnectKey={onConnectKey}
                scrollRef={registerBody}
                onScroll={handleScroll}
                className="h-[min(60vh,38rem)] w-full"
              />
            </motion.div>
          ))
        )}
      </div>

      <BandLegend lanes={lanes} blind={blind} />
    </div>
  );
}

/**
 * A collapsed lane in focus mode.
 *
 * Keeps the band and the name visible so the set is still legible as a set, and
 * clicking swaps the focus — the fastest way to read two long answers in turn.
 */
function LaneRail({
  lane,
  blind,
  onFocus,
}: {
  lane: LaneState;
  blind: boolean;
  onFocus?: (id: string | null) => void;
}) {
  const model = getModelById(lane.modelId);
  const name = blind ? `Lane ${String.fromCharCode(65 + lane.band)}` : (model?.name ?? lane.modelId);
  return (
    <button
      onClick={() => onFocus?.(lane.id)}
      className="flex w-full items-center gap-2 overflow-hidden rounded-xl border border-border bg-surface/50 p-2.5 text-left transition-colors hover:border-border-strong"
    >
      <span
        aria-hidden
        className="h-6 w-0.5 shrink-0 rounded-full"
        style={{ backgroundColor: BAND_RGB[lane.band] }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{name}</span>
        <span className="block truncate text-2xs text-muted-foreground">
          {lane.status === "streaming" ? "still answering" : `${wordCount(lane.text)} words`}
        </span>
      </span>
    </button>
  );
}

/**
 * The legend.
 *
 * `bg-gradient-elevation` exists in the design system as "the legend for the
 * ramp" and had nowhere to be a legend *of*. Here it is literally one: the bands
 * in order, each labelled with the model that holds it.
 */
function BandLegend({ lanes, blind }: { lanes: LaneState[]; blind: boolean }) {
  if (lanes.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
      <span className="text-2xs uppercase tracking-legend text-muted-foreground/70">Lanes</span>
      {lanes.map((lane) => {
        const model = getModelById(lane.modelId);
        return (
          <span key={lane.id} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span
              aria-hidden
              className="size-2 rounded-[3px]"
              style={{ backgroundColor: BAND_RGB[lane.band] }}
            />
            {blind ? BAND_LABEL[lane.band] : (model?.name ?? lane.modelId)}
          </span>
        );
      })}
    </div>
  );
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
