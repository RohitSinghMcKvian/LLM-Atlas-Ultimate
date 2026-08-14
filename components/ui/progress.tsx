"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A hairline meter.
 *
 * Built rather than pulled in: the whole surface needed is a track, a fill and a
 * colour that changes as the fill approaches the end, and `@radix-ui/react-progress`
 * would be a dependency for twenty lines. The same reasoning as `lib/chat/idb.ts`
 * and `lib/crypto/secret-box.ts` elsewhere in this repo.
 *
 * `tone="budget"` is the one that matters: an agent's spend meter should stop
 * looking neutral before it runs out, so the fill moves cyan → amber → danger as
 * it fills. That is the honesty surface for a mode that spends money.
 */
export function Progress({
  value,
  tone = "primary",
  className,
  label,
}: {
  /** 0–1. Clamped, because a provider can report spend past the ceiling. */
  value: number;
  tone?: "primary" | "budget";
  className?: string;
  /** Screen-reader name. Without it the bar is an unlabelled number. */
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const fill =
    tone === "budget"
      ? pct >= 0.9
        ? "bg-danger"
        : pct >= 0.7
          ? "bg-amber"
          : "bg-action"
      : "bg-action";

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-0.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width,background-color]", fill)}
        // Width and colour are the only animated properties, both cheap, both on
        // the house easing curve so the bar settles like everything else.
        style={{
          width: `${pct * 100}%`,
          transitionDuration: "300ms",
          transitionTimingFunction: "var(--ease-atlas)",
        }}
      />
    </div>
  );
}
