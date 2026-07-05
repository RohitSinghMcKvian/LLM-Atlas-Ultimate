"use client";

import { CountUp } from "@/components/motion/count-up";
import { Reveal } from "@/components/motion/reveal";

const STATS = [
  { value: 195, suffix: "+", label: "Models tracked" },
  { value: 13, suffix: "+", label: "Providers + local" },
  { value: 8, suffix: "", label: "Benchmark suites" },
  { value: 60, suffix: "+", label: "News sources / hr" },
];

export function ProofStrip() {
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
