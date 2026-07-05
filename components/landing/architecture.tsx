"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Boxes,
  Brain,
  Coins,
  Database,
  Router,
  Server,
  Cpu,
} from "lucide-react";
import { Reveal } from "@/components/motion/reveal";

const SURFACES = ["Learn", "Chat", "Code", "Compare", "Leaderboard", "Cost", "News"];
const PLATFORM = [
  { icon: Brain, label: "Atlas Brain", sub: "runtime" },
  { icon: Database, label: "Catalog", sub: "+ benchmarks" },
  { icon: Coins, label: "Cost engine", sub: "pricing" },
  { icon: Router, label: "Atlas Router", sub: "gateway" },
  { icon: Boxes, label: "Memory", sub: "+ vectors" },
];
const SUBSTRATE = [
  { icon: Cpu, label: "Provider APIs" },
  { icon: Server, label: "Local inference" },
  { icon: Boxes, label: "MCP servers · sandbox" },
];

function Flow() {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto h-8 w-px">
      <div className="absolute inset-0 w-px bg-border" />
      {!reduce && (
        <motion.div
          className="absolute left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-cyan shadow-glow-primary"
          animate={{ top: ["0%", "100%"], opacity: [0, 1, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </div>
  );
}

export function Architecture() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
      <Reveal className="mx-auto mb-12 max-w-2xl text-center">
        <p className="mb-3 text-sm font-medium uppercase tracking-wider text-cyan">
          The shared platform layer
        </p>
        <h2 className="text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          One substrate feeds every surface
        </h2>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="rounded-3xl border border-border bg-surface/40 p-5 shadow-glow sm:p-8">
          {/* Surfaces */}
          <div className="flex flex-wrap justify-center gap-2">
            {SURFACES.map((s) => (
              <span
                key={s}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium"
              >
                {s}
              </span>
            ))}
            <span className="rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
              + more
            </span>
          </div>

          <Flow />

          {/* Platform */}
          <div className="rounded-2xl border border-cyan/25 bg-gradient-primary-soft p-4">
            <p className="mb-3 text-center text-2xs font-semibold uppercase tracking-wider text-cyan">
              Platform layer
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {PLATFORM.map((p) => (
                <div
                  key={p.label}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface/80 p-3 text-center"
                >
                  <p.icon className="size-4 text-cyan" />
                  <span className="text-xs font-medium leading-tight">
                    {p.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {p.sub}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Flow />

          {/* Substrate */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SUBSTRATE.map((s) => (
              <div
                key={s.label}
                className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-muted-foreground"
              >
                <s.icon className="size-4" />
                {s.label}
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
