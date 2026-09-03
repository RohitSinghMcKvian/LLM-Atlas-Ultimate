"use client";

import * as React from "react";
import Link from "next/link";
import { AppLink } from "@/components/nav/app-link";
import { motion, useReducedMotion } from "framer-motion";
import { AtlasMark } from "@/components/brand/logo";
import { ModuleGlyph } from "@/components/brand/glyph";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Reveal } from "@/components/motion/reveal";
import { MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";

const VW = 1000;
const VH = 600;
const CX = 500;
const CY = 300;

function positions() {
  const inner = MODULES.slice(0, 6);
  const outer = MODULES.slice(6);
  const pts: { x: number; y: number }[] = [];
  inner.forEach((_, i) => {
    const a = (i / inner.length) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: CX + Math.cos(a) * 200, y: CY + Math.sin(a) * 150 });
  });
  outer.forEach((_, i) => {
    const a = (i / outer.length) * Math.PI * 2 - Math.PI / 2 + 0.3;
    pts.push({ x: CX + Math.cos(a) * 420, y: CY + Math.sin(a) * 250 });
  });
  return pts;
}

export function EcosystemMap() {
  const reduce = useReducedMotion();
  const pts = React.useMemo(positions, []);

  return (
    <section className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
      <Reveal className="mx-auto mb-12 max-w-2xl text-center">
        <p className="mb-3 text-sm font-medium uppercase tracking-wider text-action">
          One shared substrate
        </p>
        <h2 className="text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
          Not a bundle of tools — a single map
        </h2>
        <p className="mt-4 text-pretty text-muted-foreground">
          Every module sits on the same catalog, cost engine, memory layer, and
          agent runtime. Learning links to live models; research feeds the
          leaderboard; the coding agent and chat share one brain.
        </p>
      </Reveal>

      {/* Constellation (lg+) */}
      <div className="relative mx-auto hidden aspect-[1000/600] w-full max-w-5xl lg:block">
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          className="absolute inset-0 size-full"
          preserveAspectRatio="none"
        >
          {/* Survey lines from the station at the centre. Flat hairlines in the
              border tone rather than a brand gradient — the spokes are the
              structure of the diagram, not the subject of it. */}
          {pts.map((p, i) => (
            <motion.line
              key={i}
              x1={CX}
              y1={CY}
              x2={p.x}
              y2={p.y}
              stroke="rgb(var(--border-strong))"
              strokeWidth={1}
              initial={reduce ? undefined : { pathLength: 0, opacity: 0 }}
              whileInView={reduce ? undefined : { pathLength: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
            />
          ))}
        </svg>

        {/* Center hub */}
        <div
          className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ left: `${(CX / VW) * 100}%`, top: `${(CY / VH) * 100}%` }}
        >
          <div className="relative grid size-24 place-items-center rounded-3xl border border-action/40 bg-surface shadow-glow">
            <AtlasMark size={48} className="relative" />
          </div>
          <div className="mt-3 text-center">
            <p className="font-display text-sm font-semibold">Atlas Brain</p>
            <p className="text-2xs text-muted-foreground">
              catalog · memory · cost · router
            </p>
          </div>
        </div>

        {/* Module nodes */}
        {MODULES.map((m, i) => {
          const p = pts[i];
          return (
            <div
              key={m.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${(p.x / VW) * 100}%`, top: `${(p.y / VH) * 100}%` }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <AppLink href={m.href}>
                    <motion.div
                      initial={reduce ? undefined : { opacity: 0, scale: 0.6 }}
                      whileInView={reduce ? undefined : { opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                      whileHover={{ scale: 1.08, y: -2 }}
                      className="group flex w-[88px] flex-col items-center gap-1.5"
                    >
                      <div className="grid size-14 place-items-center rounded-2xl border border-border bg-surface/80 backdrop-blur transition-all group-hover:border-action/50 group-hover:shadow-glow">
                        <ModuleGlyph seed={m.id} accent={m.accent} size={34} />
                      </div>
                      <span className="text-xs font-medium">{m.label}</span>
                    </motion.div>
                  </AppLink>
                </TooltipTrigger>
                <TooltipContent className="max-w-[200px] text-center font-normal">
                  <span className="font-semibold">{m.name}</span> — {m.tagline}
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>

      {/* Grid fallback (mobile) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:hidden">
        {MODULES.map((m) => (
          <AppLink
            key={m.id}
            href={m.href}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface/50 p-4 text-center transition-colors hover:border-action/40"
          >
            <ModuleGlyph seed={m.id} accent={m.accent} size={36} />
            <span className="text-sm font-medium">{m.label}</span>
            <span className="text-2xs text-muted-foreground">{m.tagline}</span>
          </AppLink>
        ))}
      </div>
    </section>
  );
}
