"use client";

import * as React from "react";
import { DEPTH_PRESETS } from "@/lib/compare/lanes";
import type { Depth } from "@/lib/compare/types";
import { cn } from "@/lib/utils";

/**
 * One control for how hard the run tries.
 *
 * The individual knobs behind it — research rounds, claim extraction, whether a
 * judge runs, the output ceiling, how many upstream connections open at once —
 * are not independently meaningful to anyone who has not read the planner. Three
 * named settings are, and each one states what it actually does, because a
 * control that changes the bill without saying so is not a control.
 */

const ORDER: Depth[] = ["quick", "standard", "deep"];

const COPY: Record<Depth, { name: string; blurb: string }> = {
  quick: { name: "Quick", blurb: "Answers only. No research, no scoring." },
  standard: { name: "Standard", blurb: "Researches first, then scores and synthesises." },
  deep: { name: "Deep", blurb: "More research, longer answers, head-to-head scoring." },
};

export function DepthControl({
  value,
  onChange,
  disabled,
}: {
  value: Depth;
  onChange: (d: Depth) => void;
  disabled?: boolean;
}) {
  const preset = DEPTH_PRESETS[value];
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs uppercase tracking-legend text-muted-foreground/70">Depth</span>
      <div
        role="radiogroup"
        aria-label="Depth"
        className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5"
      >
        {ORDER.map((d) => (
          <button
            key={d}
            role="radio"
            aria-checked={value === d}
            disabled={disabled}
            onClick={() => onChange(d)}
            title={COPY[d].blurb}
            className={cn(
              "rounded-md px-2.5 py-1 text-2xs font-medium transition-colors disabled:opacity-50",
              value === d
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {COPY[d].name}
          </button>
        ))}
      </div>
      <p className="hidden text-2xs text-muted-foreground lg:block">
        {COPY[value].blurb}
        {preset.researchRounds > 0 && (
          <>
            {" "}
            <span className="text-muted-foreground/70">
              ({preset.researchRounds} research round{preset.researchRounds === 1 ? "" : "s"})
            </span>
          </>
        )}
      </p>
    </div>
  );
}
