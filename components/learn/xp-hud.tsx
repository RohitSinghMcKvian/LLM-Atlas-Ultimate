"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame, Zap } from "lucide-react";
import { useLearnStore } from "@/lib/store/learn-store";
import { levelFor } from "@/lib/learn/progress";
import { announce } from "@/lib/atlas-events";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Level, XP and streak, plus the reward toasts.
 *
 * The ring is an SVG stroke-dasharray rather than a conic gradient so the
 * progress arc animates smoothly and reads correctly at 20px in both themes.
 */
export function XpHud() {
  const xp = useLearnStore((s) => s.xp);
  const streak = useLearnStore((s) => s.streak);
  const level = levelFor(xp);

  return (
    <div className="flex items-center gap-2.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/60 py-1 pl-1 pr-2.5">
            <LevelRing fraction={level.fraction} level={level.level} />
            <div className="leading-tight">
              <p className="text-[11px] font-semibold">{level.title}</p>
              <p className="font-mono text-[10px] tnum text-muted-foreground">
                {xp.toLocaleString()} XP
              </p>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {level.isMax
            ? "Max level — every track mastered."
            : `${level.toNext.toLocaleString()} XP to level ${level.level + 1}`}
        </TooltipContent>
      </Tooltip>

      {streak > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "flex items-center gap-1 rounded-xl border px-2 py-1.5",
                streak >= 7
                  ? "border-amber/40 bg-amber/10 text-amber"
                  : "border-border bg-surface-2/60 text-muted-foreground",
              )}
            >
              <Flame className="size-3.5" />
              <span className="font-mono text-[11px] font-semibold tnum">
                {streak}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {streak}-day streak. Study tomorrow to keep it.
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function LevelRing({ fraction, level }: { fraction: number; level: number }) {
  const r = 13;
  const circumference = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0 -rotate-90">
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        stroke="rgb(var(--surface-3))"
        strokeWidth="3"
      />
      <motion.circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        stroke="url(#xp-ring)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={false}
        animate={{ strokeDashoffset: circumference * (1 - Math.min(1, fraction)) }}
        transition={{ type: "spring", stiffness: 160, damping: 26 }}
      />
      <defs>
        <linearGradient id="xp-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--cyan))" />
          <stop offset="100%" stopColor="rgb(var(--violet))" />
        </linearGradient>
      </defs>
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="11"
        fontWeight="700"
        fill="rgb(var(--foreground))"
        transform="rotate(90 16 16)"
      >
        {level}
      </text>
    </svg>
  );
}

/**
 * Floating reward toasts.
 *
 * Mounted once at the page root. Reads the queue the store appends to, shows
 * it, announces it to assistive tech, and clears it — the store never holds a
 * reward longer than its animation.
 */
export function RewardToasts() {
  const rewards = useLearnStore((s) => s.rewards);
  const clearRewards = useLearnStore((s) => s.clearRewards);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  React.useEffect(() => {
    if (rewards.length === 0) return;
    for (const r of rewards) {
      announce(r.xp > 0 ? `${r.label}. ${r.xp} XP earned.` : r.label);
    }
    const t = setTimeout(clearRewards, reduceMotion ? 1600 : 2600);
    return () => clearTimeout(t);
  }, [rewards, clearRewards, reduceMotion]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {rewards.map((r) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: -12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="pointer-events-none inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-popover px-3.5 py-2 text-sm shadow-float"
          >
            {r.kind === "streak" ? (
              <Flame className="size-4 text-amber" />
            ) : (
              <Zap className="size-4 text-cyan" />
            )}
            <span className="font-medium">{r.label}</span>
            {r.xp > 0 && (
              <span className="font-mono text-xs font-semibold text-cyan">
                +{r.xp} XP
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
