"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, RotateCcw, Archive, Brain, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VizFrame, VizSlider, VizStat } from "./frame";
import { cn } from "@/lib/utils";

/**
 * Three tiers of memory, and the moment compaction fires.
 *
 * Run the session forward and watch working memory fill. When it crosses the
 * budget you set, the oldest turns are summarised into episodic memory and any
 * durable fact is lifted into semantic memory — where it survives every future
 * compaction. Every token figure is computed from the turns below.
 *
 * The thing to notice: the facts that survive are the ones something deliberately
 * extracted. A session that only truncates loses them permanently.
 */

interface Turn {
  role: "user" | "assistant";
  text: string;
  tokens: number;
  /** A durable fact this turn established. Promoted to semantic on compaction. */
  fact?: string;
}

const TURNS: Turn[] = [
  { role: "user", text: "We're migrating the billing service to Postgres 16.", tokens: 620, fact: "Target: Postgres 16 for billing" },
  { role: "assistant", text: "Outlined a migration plan with a shadow-write phase.", tokens: 1450 },
  { role: "user", text: "Our constraint is zero downtime — this is a payments path.", tokens: 540, fact: "Hard constraint: zero downtime" },
  { role: "assistant", text: "Revised to logical replication plus a cutover window.", tokens: 1780 },
  { role: "user", text: "Here's the current schema dump.", tokens: 4200 },
  { role: "assistant", text: "Flagged three tables with unindexed foreign keys.", tokens: 1320, fact: "3 tables lack FK indexes" },
  { role: "user", text: "What about the read replicas in eu-west?", tokens: 380 },
  { role: "assistant", text: "Replica lag analysis and a staged promotion order.", tokens: 2100 },
  { role: "user", text: "Legal says we can't move EU data outside the region.", tokens: 460, fact: "EU data must stay in eu-west" },
  { role: "assistant", text: "Reworked the plan around a region-local replica set.", tokens: 1950 },
  { role: "user", text: "Draft the runbook.", tokens: 210 },
  { role: "assistant", text: "Full runbook with rollback triggers per phase.", tokens: 3400 },
];

/** How much of the summarised span a good summary keeps. Illustrative. */
const SUMMARY_RATIO = 0.16;

interface Episode {
  label: string;
  fromTokens: number;
  tokens: number;
}

export function MemoryTiersViz() {
  const [budget, setBudget] = React.useState(8000);
  const [at, setAt] = React.useState(2);

  /**
   * Replay the session from the start every time rather than mutating state
   * incrementally — a scrubbable timeline that depends on how you got there is
   * a bug waiting to happen, and the whole run is twelve turns of arithmetic.
   */
  const state = React.useMemo(() => {
    let working: Turn[] = [];
    const episodes: Episode[] = [];
    const semantic: string[] = [];
    let compactions = 0;

    const sum = (ts: Turn[]) => ts.reduce((n, t) => n + t.tokens, 0);

    for (const turn of TURNS.slice(0, at)) {
      working.push(turn);

      while (sum(working) > budget && working.length > 2) {
        // Compact the oldest half, always leaving the two most recent turns
        // intact — a summary of the turn you are currently answering is useless.
        const keep = Math.max(2, Math.ceil(working.length / 2));
        const drop = working.slice(0, working.length - keep);
        if (drop.length === 0) break;

        const from = sum(drop);
        episodes.push({
          label: `${drop.length} turns summarised`,
          fromTokens: from,
          tokens: Math.max(40, Math.round(from * SUMMARY_RATIO)),
        });
        for (const d of drop) {
          if (d.fact && !semantic.includes(d.fact)) semantic.push(d.fact);
        }
        working = working.slice(working.length - keep);
        compactions += 1;
      }
    }

    const workingTokens = sum(working);
    const episodicTokens = episodes.reduce((n, e) => n + e.tokens, 0);
    const semanticTokens = semantic.reduce(
      (n, f) => n + Math.ceil(f.length / 4),
      0,
    );
    const naiveTokens = sum(TURNS.slice(0, at));

    return {
      working,
      episodes,
      semantic,
      compactions,
      workingTokens,
      episodicTokens,
      semanticTokens,
      naiveTokens,
      resident: workingTokens + episodicTokens + semanticTokens,
    };
  }, [at, budget]);

  const over = state.workingTokens > budget;
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

  return (
    <VizFrame
      label="Memory tiers"
      hint="Run the session and watch compaction fire"
      controls={
        <>
          {at > 2 && (
            <Button variant="ghost" size="sm" onClick={() => setAt(2)}>
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setAt((n) => Math.min(n + 1, TURNS.length))}
            disabled={at >= TURNS.length}
          >
            Next turn <ChevronRight className="size-3.5" />
          </Button>
        </>
      }
      footer="Token counts are summed from the turns above; a summary is modelled as keeping 16% of what it replaces. The comparison that matters is resident vs naive — and that the extracted facts are still there after four compactions, which truncation cannot claim."
    >
      <div className="mb-4">
        <VizSlider
          label="Working memory budget"
          value={budget}
          onChange={setBudget}
          min={3000}
          max={20000}
          step={500}
          format={fmt}
        />
      </div>

      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-2xs tnum text-muted-foreground">
          turn {at}/{TURNS.length}
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className={cn(
              "h-full rounded-full",
              over ? "bg-danger" : "bg-gradient-primary",
            )}
            animate={{ width: `${Math.min(100, (state.workingTokens / budget) * 100)}%` }}
            transition={{ type: "spring", stiffness: 200, damping: 26 }}
          />
        </div>
        <span
          className={cn(
            "font-mono text-2xs tnum",
            over ? "text-danger" : "text-muted-foreground",
          )}
        >
          {fmt(state.workingTokens)}/{fmt(budget)}
        </span>
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        <Tier
          icon={MessageSquare}
          title="Working"
          sub="verbatim, in the window"
          tint="var(--cyan)"
          tokens={state.workingTokens}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {state.working.map((t, i) => (
              <motion.li
                key={`${t.text}-${i}`}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                className="rounded-lg border border-border bg-surface-2/50 px-2 py-1.5"
              >
                <p className="flex items-baseline gap-1.5">
                  <span
                    className={cn(
                      "font-mono text-[9px] uppercase",
                      t.role === "user" ? "text-cyan" : "text-violet",
                    )}
                  >
                    {t.role}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] tnum text-muted-foreground">
                    {fmt(t.tokens)}
                  </span>
                </p>
                <p className="text-[11px] leading-snug text-foreground/85">
                  {t.text}
                </p>
              </motion.li>
            ))}
          </AnimatePresence>
        </Tier>

        <Tier
          icon={Archive}
          title="Episodic"
          sub="summarised spans"
          tint="var(--amber)"
          tokens={state.episodicTokens}
        >
          {state.episodes.length === 0 ? (
            <li className="rounded-lg border border-dashed border-border px-2 py-2 text-[10px] text-muted-foreground">
              Nothing compacted yet. Lower the budget or advance the session.
            </li>
          ) : (
            state.episodes.map((e, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-amber/30 bg-amber/[0.06] px-2 py-1.5"
              >
                <p className="text-[11px] font-medium">{e.label}</p>
                <p className="font-mono text-[9px] tnum text-muted-foreground">
                  {fmt(e.fromTokens)} → {fmt(e.tokens)} tokens
                </p>
              </motion.li>
            ))
          )}
        </Tier>

        <Tier
          icon={Brain}
          title="Semantic"
          sub="durable facts"
          tint="var(--violet)"
          tokens={state.semanticTokens}
        >
          {state.semantic.length === 0 ? (
            <li className="rounded-lg border border-dashed border-border px-2 py-2 text-[10px] text-muted-foreground">
              Facts are lifted here when their turn is compacted.
            </li>
          ) : (
            state.semantic.map((f) => (
              <motion.li
                key={f}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-lg border border-violet/30 bg-violet/[0.07] px-2 py-1.5 text-[11px] leading-snug"
              >
                {f}
              </motion.li>
            ))
          )}
        </Tier>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <VizStat label="Compactions" value={state.compactions} accent="amber" />
        <VizStat label="Resident" value={fmt(state.resident)} accent="cyan" />
        <VizStat label="Naive (no tiers)" value={fmt(state.naiveTokens)} />
        <VizStat
          label="Saved"
          value={
            state.naiveTokens > 0
              ? `${Math.max(
                  0,
                  Math.round((1 - state.resident / state.naiveTokens) * 100),
                )}%`
              : "0%"
          }
          accent="success"
        />
      </div>
    </VizFrame>
  );
}

function Tier({
  icon: Icon,
  title,
  sub,
  tint,
  tokens,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
  tint: string;
  tokens: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface/50">
      <div
        className="flex items-center gap-1.5 rounded-t-xl border-b border-border px-2.5 py-1.5"
        style={{ background: `rgb(${tint} / 0.08)` }}
      >
        <Icon className="size-3.5" />
        <span className="text-2xs font-semibold">{title}</span>
        <span className="ml-auto font-mono text-[10px] tnum text-muted-foreground">
          {tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : tokens}
        </span>
      </div>
      <p className="px-2.5 pt-1.5 text-[10px] text-muted-foreground">{sub}</p>
      <ul className="max-h-56 space-y-1 overflow-y-auto p-2">{children}</ul>
    </div>
  );
}
