"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VizFrame, VizSlider, VizStat } from "./frame";
import { cn } from "@/lib/utils";

/**
 * Temperature and top-p, applied to a real-shaped next-token distribution.
 *
 * The logits are fixed so the two controls are the only variables — the whole
 * point is that sampling is a transformation *of a distribution the model
 * already produced*, not something that changes the model.
 */

const PROMPT = "The capital of France is";

const CANDIDATES: { token: string; logit: number }[] = [
  { token: " Paris", logit: 8.2 },
  { token: " the", logit: 4.4 },
  { token: " a", logit: 3.6 },
  { token: " located", logit: 3.3 },
  { token: " home", logit: 3.0 },
  { token: " known", logit: 2.6 },
  { token: " one", logit: 2.3 },
  { token: " now", logit: 1.9 },
  { token: " arguably", logit: 1.4 },
  { token: " famously", logit: 1.0 },
];

interface Row {
  token: string;
  prob: number;
  cumulative: number;
  kept: boolean;
}

export function softmax(logits: number[], temperature: number): number[] {
  // T = 0 is greedy: the argmax takes all the mass. Dividing by zero would
  // produce NaN, so it is handled as its own case rather than as a limit.
  if (temperature <= 0) {
    const top = logits.indexOf(Math.max(...logits));
    return logits.map((_, i) => (i === top ? 1 : 0));
  }
  const scaled = logits.map((l) => l / temperature);
  const max = Math.max(...scaled);
  const exp = scaled.map((s) => Math.exp(s - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / sum);
}

export function applyTopP(probs: number[], topP: number): boolean[] {
  const order = probs
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p - a.p);
  const kept = new Array(probs.length).fill(false);
  let cumulative = 0;
  for (const { p, i } of order) {
    kept[i] = true;
    cumulative += p;
    // The token that crosses the threshold is kept — the nucleus is the
    // smallest set whose mass *reaches* p, so it must include the crossing one.
    if (cumulative >= topP) break;
  }
  return kept;
}

export function SamplingViz() {
  const [temperature, setTemperature] = React.useState(0.8);
  const [topP, setTopP] = React.useState(0.95);
  const [sampled, setSampled] = React.useState<string | null>(null);

  const rows: Row[] = React.useMemo(() => {
    const probs = softmax(
      CANDIDATES.map((c) => c.logit),
      temperature,
    );
    const kept = applyTopP(probs, topP);
    let cumulative = 0;
    return CANDIDATES.map((c, i) => {
      cumulative += probs[i];
      return { token: c.token, prob: probs[i], cumulative, kept: kept[i] };
    });
  }, [temperature, topP]);

  const keptRows = rows.filter((r) => r.kept);
  const keptMass = keptRows.reduce((n, r) => n + r.prob, 0);
  const top = rows[0];

  function sample() {
    // Renormalize across the surviving nucleus, then draw.
    const mass = keptMass || 1;
    let r = Math.random() * mass;
    for (const row of rows) {
      if (!row.kept) continue;
      r -= row.prob;
      if (r <= 0) return setSampled(row.token);
    }
    setSampled(keptRows[0]?.token ?? null);
  }

  return (
    <VizFrame
      label="Sampling"
      hint="Reshape the distribution"
      controls={
        <Button variant="secondary" size="sm" onClick={sample}>
          <Dices className="size-3.5" /> Sample
        </Button>
      }
      footer="Greyed bars are outside the nucleus and cannot be selected. Logits are fixed — only the sampling transformation changes."
    >
      <p className="mb-3 font-mono text-xs text-muted-foreground">
        {PROMPT}
        <span className="ml-1 inline-block animate-caret-blink text-cyan">▍</span>
        {sampled && (
          <span className="ml-1 rounded bg-cyan/15 px-1 text-cyan">
            {sampled.trim()}
          </span>
        )}
      </p>

      <div className="mb-4 flex flex-wrap gap-4">
        <VizSlider
          label="Temperature"
          value={temperature}
          onChange={(v) => {
            setTemperature(v);
            setSampled(null);
          }}
          min={0}
          max={2}
          step={0.05}
          format={(v) => (v === 0 ? "0 (greedy)" : v.toFixed(2))}
        />
        <VizSlider
          label="Top-p"
          value={topP}
          onChange={(v) => {
            setTopP(v);
            setSampled(null);
          }}
          min={0.05}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          accent="violet"
        />
      </div>

      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.token} className="flex items-center gap-2">
            <span
              className={cn(
                "w-20 shrink-0 truncate font-mono text-[12px]",
                row.kept ? "text-foreground" : "text-muted-foreground/50",
              )}
            >
              {row.token.trim()}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-surface-3/60">
              <motion.div
                className={cn(
                  "h-full rounded",
                  row.kept ? "bg-gradient-primary" : "bg-surface-3",
                )}
                animate={{ width: `${Math.max(row.prob * 100, 0.4)}%` }}
                transition={{ type: "spring", stiffness: 300, damping: 32 }}
              />
            </div>
            <span
              className={cn(
                "w-14 shrink-0 text-right font-mono text-[11px] tnum",
                row.kept ? "text-cyan" : "text-muted-foreground/50",
              )}
            >
              {(row.prob * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <VizStat label="In nucleus" value={keptRows.length} accent="cyan" />
        <VizStat
          label="Mass kept"
          value={`${(keptMass * 100).toFixed(0)}%`}
          accent="violet"
        />
        <VizStat
          label="Top token"
          value={`${(top.prob * 100).toFixed(0)}%`}
          accent={top.prob > 0.9 ? "success" : top.prob < 0.35 ? "amber" : undefined}
        />
      </div>
    </VizFrame>
  );
}
