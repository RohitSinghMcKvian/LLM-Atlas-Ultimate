"use client";

import * as React from "react";
import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import {
  Check,
  GitCompareArrows,
  Brain,
  Wrench,
  ShieldCheck,
  FileDiff,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";

function Bar({ w, className }: { w: string; className?: string }) {
  return (
    <div
      className={cn("h-2 rounded-full bg-surface-3", className)}
      style={{ width: w }}
    />
  );
}

/* ----------------------------- Compare fan-out ---------------------------- */
// `labels` come from the live catalog snapshot, read server-side on the landing
// page and threaded down as props — the same route the hero's constellation
// uses. These previews are decorative, but naming models the catalog no longer
// carries makes the page quietly lie about what Atlas serves. The literals stay
// as the fallback for the pre-sync/offline case.
const COMPARE_FALLBACK = ["Claude", "GPT-4o", "DeepSeek"];

export function PreviewCompare({ labels }: { labels?: string[] }) {
  const reduce = useReducedMotion();
  const cols =
    labels && labels.length >= 3 ? labels.slice(0, 3) : COMPARE_FALLBACK;
  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 shadow-glow">
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-xs text-muted-foreground">
        <GitCompareArrows className="size-3.5 text-action" />
        Compare across models…
      </div>
      <div className="grid grid-cols-3 gap-2">
        {cols.map((c, i) => (
          <div
            key={c}
            className="space-y-1.5 rounded-xl border border-border bg-surface p-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xs font-medium">{c}</span>
              <span className="size-1.5 animate-pulse-dot rounded-full bg-action" />
            </div>
            {[0, 1, 2, 3].map((j) => (
              <motion.div
                key={j}
                initial={{ opacity: 0.2, scaleX: 0.3 }}
                animate={
                  reduce
                    ? { opacity: 1, scaleX: 1 }
                    : { opacity: [0.2, 1, 0.5], scaleX: [0.3, 1, 1] }
                }
                transition={{
                  duration: 2.4,
                  repeat: reduce ? 0 : Infinity,
                  delay: i * 0.25 + j * 0.3,
                }}
                className="h-1.5 origin-left rounded-full bg-gradient-to-r from-action/60 to-accent/40"
              />
            ))}
          </div>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="mt-3 rounded-xl border border-action/30 bg-action/10 p-2.5"
      >
        <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold text-action">
          <GitCompareArrows className="size-3" /> Synthesis
        </div>
        <div className="space-y-1.5">
          <Bar w="100%" className="bg-foreground/10" />
          <Bar w="82%" className="bg-foreground/10" />
        </div>
      </motion.div>
    </div>
  );
}

/* --------------------------- Atlas Brain trace ---------------------------- */
export function PreviewBrainTrace() {
  const reduce = useReducedMotion();
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    if (reduce) {
      setStep(4);
      return;
    }
    const t = setInterval(() => setStep((s) => (s + 1) % 5), 1100);
    return () => clearInterval(t);
  }, [reduce]);

  const steps = [
    { icon: Brain, label: "Plan" },
    { icon: Wrench, label: "Sub-agents" },
    { icon: Wrench, label: "Tools" },
    { icon: ShieldCheck, label: "Verify" },
    { icon: FileDiff, label: "Diff" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 shadow-glow">
      <div className="space-y-2">
        {steps.map((s, i) => {
          const active = i <= step;
          const isParallel = i === 1 || i === 2;
          return (
            <div key={i} className="flex items-center gap-2.5">
              <div
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-lg border transition-colors",
                  active
                    ? "border-action/40 bg-action/10 text-action"
                    : "border-border bg-surface-2 text-muted-foreground/50",
                )}
              >
                {active && i < step ? (
                  <Check className="size-3.5" />
                ) : (
                  <s.icon className="size-3.5" />
                )}
              </div>
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={cn(
                      "text-2xs font-medium",
                      active ? "text-foreground" : "text-muted-foreground/60",
                    )}
                  >
                    {s.label}
                  </span>
                  {isParallel && (
                    <span className="rounded bg-accent/15 px-1 text-2xs uppercase text-accent">
                      parallel
                    </span>
                  )}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    className="h-full rounded-full bg-action"
                    initial={{ width: "0%" }}
                    animate={{ width: active ? "100%" : "0%" }}
                    transition={{ duration: 0.6 }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-success/25 bg-success/5 px-2.5 py-1.5 text-2xs text-success">
        <ShieldCheck className="size-3" /> Closed-loop verification passed
      </div>
    </div>
  );
}

/* --------------------------- Leaderboard FLIP ----------------------------- */
const LB = [
  { name: "Claude 3.7", color: "from-action to-accent" },
  { name: "DeepSeek R1", color: "from-accent to-action" },
  { name: "Gemini 2.0", color: "from-action/80 to-accent/70" },
  { name: "Llama 3.3", color: "from-amber/70 to-action/70" },
];

export function PreviewLeaderboard({ labels }: { labels?: string[] }) {
  const reduce = useReducedMotion();
  const [scores, setScores] = React.useState([88, 84, 80, 76]);
  // Names come from the catalog; the gradients (and the animated scores below)
  // stay synthetic — this panel illustrates re-ranking, it does not report it.
  const rows = React.useMemo(
    () =>
      labels && labels.length >= LB.length
        ? LB.map((m, i) => ({ ...m, name: labels[i] }))
        : LB,
    [labels],
  );
  React.useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => {
      setScores((s) => s.map((v) => v + (Math.random() * 8 - 4)));
    }, 2200);
    return () => clearInterval(t);
  }, [reduce]);

  const ranked = rows
    .map((m, i) => ({ ...m, score: scores[i], id: m.name }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 shadow-glow">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium">
        <Trophy className="size-4 text-amber" /> Live re-ranking
      </div>
      <div className="space-y-2">
        {ranked.map((m, i) => (
          <motion.div
            key={m.id}
            layout
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
          >
            <span className="w-4 font-mono text-xs text-muted-foreground">
              {i + 1}
            </span>
            <span className="w-20 truncate text-xs font-medium">{m.name}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <motion.div
                layout
                className={cn("h-full rounded-full bg-gradient-to-r", m.color)}
                animate={{ width: `${Math.max(20, Math.min(100, m.score))}%` }}
              />
            </div>
            <span className="w-8 text-right font-mono text-2xs">
              {Math.round(m.score)}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Cost frontier ----------------------------- */
export function PreviewCost() {
  const reduce = useReducedMotion();
  const [t, setT] = React.useState(0.5);
  React.useEffect(() => {
    if (reduce) return;
    let dir = 1;
    const id = setInterval(() => {
      setT((v) => {
        let n = v + dir * 0.04;
        if (n > 1) {
          n = 1;
          dir = -1;
        }
        if (n < 0) {
          n = 0;
          dir = 1;
        }
        return n;
      });
    }, 120);
    return () => clearInterval(id);
  }, [reduce]);

  const dots = [
    { x: 18, y: 30, open: false },
    { x: 32, y: 22, open: false },
    { x: 44, y: 40, open: true },
    { x: 58, y: 18, open: false },
    { x: 30, y: 60, open: true },
    { x: 68, y: 34, open: true },
    { x: 80, y: 26, open: false },
    { x: 52, y: 64, open: true },
  ];
  const budget = 12 + t * 76;

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 shadow-glow">
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="font-medium">Cost vs capability</span>
        <span className="font-mono text-2xs text-muted-foreground">
          budget ${Math.round(budget * 40)}
        </span>
      </div>
      <div className="relative h-40 overflow-hidden rounded-xl border border-border bg-code">
        {/* grid */}
        <div className="absolute inset-0 bg-graticule opacity-30" />
        {/* budget line */}
        <motion.div
          className="absolute inset-y-0 w-px bg-amber/60"
          style={{ left: `${budget}%` }}
        />
        {dots.map((d, i) => {
          const within = d.x <= budget;
          return (
            <motion.div
              key={i}
              className={cn(
                "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors",
                // Open on the shelf, closed on the ridge, matching the hero
                // plot and the real cost chart this previews.
                d.open ? "bg-accent" : "bg-action",
              )}
              style={{ left: `${d.x}%`, top: `${d.y}%` }}
              animate={{
                scale: within ? 1.35 : 1,
                opacity: within ? 1 : 0.4,
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-accent" /> Open
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-action" /> Closed
        </span>
        <span className="ml-auto">within budget stands out</span>
      </div>
    </div>
  );
}
