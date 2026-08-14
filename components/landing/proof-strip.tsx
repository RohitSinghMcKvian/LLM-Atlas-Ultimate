"use client";

import { CountUp } from "@/components/motion/count-up";
import { Reveal } from "@/components/motion/reveal";

export interface ProofStats {
  /** Total models in the live catalog. */
  models: number;
  /** Distinct model brands (Meta, OpenAI, …). */
  brands: number;
  /** Models runnable with no key from the user. */
  free: number;
  benchmarks: number;
}

// Defaults exist only for the case where no snapshot reaches this component. The
// numbers here used to be invented — "195 models", "13 providers" — while the real
// catalog held 97. Now they come from the server snapshot, so the strip cannot
// claim more than the product actually has.
const FALLBACK: ProofStats = { models: 97, brands: 20, free: 20, benchmarks: 12 };

/**
 * The legend for the hero plot, doubling as the proof strip.
 *
 * A map's legend explains its symbols and states its scale, so putting the
 * figures there rather than in a row of floating counters means the structure
 * is carrying information instead of decorating it — and the reader gets the
 * key to the thing they just looked at, in the place they'd look for it.
 */
export function ProofStrip({ stats = FALLBACK }: { stats?: ProofStats }) {
  const entries = [
    { value: stats.models, label: "models charted", note: "routable today" },
    { value: stats.free, label: "free to run", note: "no key needed" },
    { value: stats.brands, label: "brands covered", note: "one catalog" },
    { value: stats.benchmarks, label: "benchmark suites", note: "every score sourced" },
  ];

  return (
    <Reveal className="relative border-y border-border bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-9 sm:px-6">
        <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-2xs uppercase tracking-legend text-muted-foreground">
            Legend
          </p>
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xs uppercase tracking-legend text-muted-foreground">
              cheap
            </span>
            <span
              className="h-2 w-40 rounded-full bg-gradient-elevation sm:w-56"
              aria-hidden="true"
            />
            <span className="font-mono text-2xs uppercase tracking-legend text-muted-foreground">
              capable
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-y-8 md:grid-cols-4">
          {entries.map((entry) => (
            <div key={entry.label} className="border-l border-border pl-4">
              <div className="font-mono text-3xl font-semibold tracking-tight sm:text-4xl">
                <CountUp value={entry.value} duration={1.8} />
              </div>
              <div className="mt-1 text-sm text-foreground">{entry.label}</div>
              <div className="text-2xs text-muted-foreground">{entry.note}</div>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}
