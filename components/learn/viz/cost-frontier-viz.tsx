"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { VizFrame, VizSlider, VizStat } from "./frame";
import { formatUSD } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * The routing economics of a cascade, as a live model.
 *
 * The escalation rate is the variable people forget: routing 90% of traffic to
 * a small model saves nothing if 80% of it escalates, because escalated
 * requests are paid for *twice*. Moving both sliders makes that visible in a
 * way a static table never does.
 */

const REQUESTS_PER_MONTH = 3_000_000;
const IN_TOKENS = 1_400;
const OUT_TOKENS = 320;

const TIERS = {
  small: { name: "Small model", inPerM: 0.15, outPerM: 0.6 },
  large: { name: "Frontier model", inPerM: 3.0, outPerM: 15.0 },
};

function unitCost(tier: { inPerM: number; outPerM: number }) {
  return (IN_TOKENS / 1e6) * tier.inPerM + (OUT_TOKENS / 1e6) * tier.outPerM;
}

export function CostFrontierViz() {
  const [routedPct, setRoutedPct] = React.useState(75);
  const [escalationPct, setEscalationPct] = React.useState(12);
  const [cacheHitPct, setCacheHitPct] = React.useState(20);

  const small = unitCost(TIERS.small);
  const large = unitCost(TIERS.large);

  const billable = REQUESTS_PER_MONTH * (1 - cacheHitPct / 100);
  const toSmall = billable * (routedPct / 100);
  const toLarge = billable - toSmall;
  const escalated = toSmall * (escalationPct / 100);

  const baseline = REQUESTS_PER_MONTH * large;
  // Escalated requests pay the small model *and* the large one — the cascade's
  // one genuine downside, and the reason the escalation check has to be cheap.
  const routed = toSmall * small + toLarge * large + escalated * large;
  const saved = baseline - routed;
  const savedPct = baseline > 0 ? (saved / baseline) * 100 : 0;

  const barMax = Math.max(baseline, routed) || 1;

  return (
    <VizFrame
      label="Routing economics"
      hint="3M requests / month"
      footer="Escalated requests are billed twice — once for the small model, once for the frontier one. Above roughly a 45% escalation rate the cascade costs more than routing everything to the frontier model directly."
    >
      <div className="mb-4 space-y-2">
        {[
          { label: "Everything to the frontier model", value: baseline, tone: "muted" as const },
          { label: "With routing + caching", value: routed, tone: "cyan" as const },
        ].map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-baseline justify-between text-2xs">
              <span className="text-muted-foreground">{row.label}</span>
              <span
                className={cn(
                  "font-mono tnum",
                  row.tone === "cyan" ? "text-cyan" : "text-muted-foreground",
                )}
              >
                {formatUSD(row.value)}/mo
              </span>
            </div>
            <div className="h-5 overflow-hidden rounded bg-surface-3/60">
              <motion.div
                className={cn(
                  "h-full rounded",
                  row.tone === "cyan" ? "bg-gradient-primary" : "bg-surface-3",
                )}
                animate={{ width: `${(row.value / barMax) * 100}%` }}
                transition={{ type: "spring", stiffness: 240, damping: 30 }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
        <VizSlider
          label="Routed to small model"
          value={routedPct}
          onChange={setRoutedPct}
          min={0}
          max={100}
          format={(v) => `${v}%`}
        />
        <VizSlider
          label="Escalation rate"
          value={escalationPct}
          onChange={setEscalationPct}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          accent="amber"
        />
        <VizSlider
          label="Cache hit rate"
          value={cacheHitPct}
          onChange={setCacheHitPct}
          min={0}
          max={80}
          format={(v) => `${v}%`}
          accent="violet"
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <VizStat
          label="Monthly saving"
          value={saved >= 0 ? formatUSD(saved) : `−${formatUSD(-saved)}`}
          accent={saved > 0 ? "success" : "danger"}
        />
        <VizStat
          label="Reduction"
          value={`${savedPct.toFixed(0)}%`}
          accent={savedPct > 0 ? "success" : "danger"}
        />
        <VizStat
          label="Double-billed"
          value={`${(escalated / 1000).toFixed(0)}K`}
          accent="amber"
        />
        <VizStat
          label="Cost / request"
          value={`$${(routed / Math.max(REQUESTS_PER_MONTH, 1)).toFixed(5)}`}
        />
      </div>

      {savedPct <= 0 && (
        <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
          At this escalation rate the cascade is pure overhead — you are paying
          the small model for work the frontier model redoes. Either fix the
          escalation check or remove the tier.
        </p>
      )}
    </VizFrame>
  );
}
