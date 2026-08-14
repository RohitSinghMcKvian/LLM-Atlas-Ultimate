"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VizFrame, VizStat } from "./frame";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * A scripted agent run, steppable.
 *
 * The run deliberately includes a failed verification and a self-correction,
 * because a trace where everything works first time teaches nothing about why
 * stopping conditions exist. The context bar grows monotonically — that growth
 * is the cost curve the lesson is trying to make visceral.
 */

type Node = "think" | "act" | "observe" | "check";

interface Step {
  node: Node;
  text: string;
  /** Cumulative context size in tokens after this step. */
  context: number;
  costUsd: number;
  tone?: "ok" | "warn" | "fail";
}

const RUN: Step[] = [
  { node: "think", text: "Goal: fix the failing auth test. Plan: reproduce, locate, fix, verify.", context: 1200, costUsd: 0.002 },
  { node: "act", text: "run_tests('auth.spec.ts')", context: 1800, costUsd: 0.004 },
  { node: "observe", text: "1 failing: expected 401, received 200", context: 3400, costUsd: 0.007, tone: "warn" },
  { node: "think", text: "Hypothesis: the middleware short-circuits when the header is absent.", context: 4100, costUsd: 0.011 },
  { node: "act", text: "read_file('middleware/auth.ts')", context: 4600, costUsd: 0.014 },
  { node: "observe", text: "Guard returns next() when no Authorization header is present.", context: 7900, costUsd: 0.021 },
  { node: "act", text: "edit_file — return 401 instead of next()", context: 8600, costUsd: 0.026 },
  { node: "check", text: "run_tests('auth.spec.ts') → auth passes, 2 other tests now fail", context: 11200, costUsd: 0.034, tone: "fail" },
  { node: "think", text: "Verification failed. New hypothesis: public routes rely on the old behaviour.", context: 12100, costUsd: 0.041 },
  { node: "act", text: "edit_file — exempt the public route allowlist", context: 12900, costUsd: 0.047 },
  { node: "check", text: "run_tests() → full suite green", context: 15400, costUsd: 0.056, tone: "ok" },
];

const NODES: { id: Node; label: string; angle: number }[] = [
  { id: "think", label: "Think", angle: -90 },
  { id: "act", label: "Act", angle: 0 },
  { id: "observe", label: "Observe", angle: 90 },
  { id: "check", label: "Verify", angle: 180 },
];

const R = 58;
const CX = 100;
const CY = 92;
const MAX_CONTEXT = 32000;

export function AgentLoopViz() {
  const [step, setStep] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  React.useEffect(() => {
    if (!playing) return;
    if (step >= RUN.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 1300);
    return () => clearTimeout(t);
  }, [playing, step]);

  const current = RUN[step];
  const contextPct = (current.context / MAX_CONTEXT) * 100;

  return (
    <VizFrame
      label="Agent loop"
      hint={`Step ${step + 1} of ${RUN.length}`}
      controls={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous step"
            onClick={() => {
              setPlaying(false);
              setStep((s) => Math.max(0, s - 1));
            }}
            disabled={step === 0}
          >
            <SkipBack className="size-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (step >= RUN.length - 1) setStep(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {playing ? "Pause" : step >= RUN.length - 1 ? "Replay" : "Play"}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next step"
            onClick={() => {
              setPlaying(false);
              setStep((s) => Math.min(RUN.length - 1, s + 1));
            }}
            disabled={step === RUN.length - 1}
          >
            <SkipForward className="size-3.5" />
          </Button>
        </>
      }
      footer="Step 8 fails verification and the loop revises its hypothesis rather than retrying the same edit. That branch is the difference between an agent and a retry loop."
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        <svg
          viewBox="0 0 200 184"
          className="w-full rounded-lg border border-border bg-[rgb(var(--surface-2))]"
          role="img"
          aria-label={`Agent loop, currently at ${current.node}`}
        >
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke="rgb(var(--border-strong))"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
          {NODES.map((n) => {
            const rad = (n.angle * Math.PI) / 180;
            const x = CX + Math.cos(rad) * R;
            const y = CY + Math.sin(rad) * R;
            const isActive = n.id === current.node;
            return (
              <g key={n.id}>
                <motion.circle
                  cx={x}
                  cy={y}
                  r={isActive ? 22 : 19}
                  fill={
                    isActive
                      ? current.tone === "fail"
                        ? "rgb(var(--danger) / 0.22)"
                        : "rgb(var(--elev-1) / 0.22)"
                      : "rgb(var(--surface-3))"
                  }
                  stroke={
                    isActive
                      ? current.tone === "fail"
                        ? "rgb(var(--danger))"
                        : "rgb(var(--elev-1))"
                      : "rgb(var(--border))"
                  }
                  strokeWidth={isActive ? 2 : 1}
                  animate={reduceMotion ? {} : { scale: isActive ? [1, 1.06, 1] : 1 }}
                  transition={{ duration: 0.8, repeat: isActive && playing ? Infinity : 0 }}
                  style={{ transformOrigin: `${x}px ${y}px` }}
                />
                <text
                  x={x}
                  y={y + 3.5}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={isActive ? 700 : 400}
                  fill={
                    isActive
                      ? "rgb(var(--foreground))"
                      : "rgb(var(--muted-foreground))"
                  }
                >
                  {n.label}
                </text>
              </g>
            );
          })}
          <text
            x={CX}
            y={CY + 3}
            textAnchor="middle"
            fontSize={9}
            fill="rgb(var(--muted-foreground))"
          >
            {step + 1} / {RUN.length}
          </text>
          <text
            x={CX}
            y={176}
            textAnchor="middle"
            fontSize={8}
            fill="rgb(var(--muted-foreground))"
          >
            verify → think closes the loop
          </text>
        </svg>

        <div className="flex flex-col gap-3">
          <div
            className={cn(
              "min-h-[4.5rem] rounded-lg border p-2.5",
              current.tone === "fail"
                ? "border-danger/40 bg-danger/5"
                : current.tone === "ok"
                  ? "border-success/40 bg-success/5"
                  : "border-border bg-surface-2/50",
            )}
          >
            <p className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">
              {current.node}
            </p>
            <p className="font-mono text-xs leading-relaxed">{current.text}</p>
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between text-2xs text-muted-foreground">
              <span>Context used</span>
              <span className="font-mono tnum">
                {(current.context / 1000).toFixed(1)}K / 32K
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <motion.div
                className={cn(
                  "h-full rounded-full",
                  contextPct > 75 ? "bg-amber" : "bg-action",
                )}
                animate={{ width: `${contextPct}%` }}
                transition={{ type: "spring", stiffness: 220, damping: 30 }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <VizStat
              label="Cost so far"
              value={`$${current.costUsd.toFixed(3)}`}
              accent = "upland"
            />
            <VizStat
              label="Tool calls"
              value={RUN.slice(0, step + 1).filter((s) => s.node === "act").length}
              accent = "ridge"
            />
          </div>
        </div>
      </div>
    </VizFrame>
  );
}
