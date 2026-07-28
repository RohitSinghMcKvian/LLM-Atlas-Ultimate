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

export function ProofStrip({ stats = FALLBACK }: { stats?: ProofStats }) {
  const STATS = [
    { value: stats.models, suffix: "", label: "Models tracked" },
    { value: stats.free, suffix: "", label: "Free to run" },
    { value: stats.brands, suffix: "", label: "Brands covered" },
    { value: stats.benchmarks, suffix: "", label: "Benchmark suites" },
  ];

  return (
    <Reveal className="relative border-y border-border bg-surface/30">
      <div className="mx-auto grid max-w-6xl grid-cols-2 divide-border md:grid-cols-4 md:divide-x">
        {STATS.map((s, i) => (
          <div
            key={s.label}
            className="flex flex-col items-center gap-1 px-4 py-8 text-center"
          >
            <div className="font-mono text-3xl font-semibold tracking-tight sm:text-4xl">
              <CountUp value={s.value} suffix={s.suffix} duration={1.8} />
            </div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </Reveal>
  );
}
