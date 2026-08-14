"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { VizFrame, VizSlider, VizToggle } from "./frame";
import { cn } from "@/lib/utils";

/**
 * A context budget you can overspend.
 *
 * The instructive moment is the overflow: segments are packed in priority
 * order and whatever doesn't fit is visibly evicted, which is what actually
 * happens in a system that doesn't budget deliberately.
 */

const WINDOWS = [
  { value: "8000", label: "8K" },
  { value: "32000", label: "32K" },
  { value: "128000", label: "128K" },
  { value: "1000000", label: "1M" },
];

interface Segment {
  id: string;
  label: string;
  color: string;
  /** Lower evicts first. Output is reserved, so it never evicts. */
  priority: number;
}

const SEGMENTS: Segment[] = [
  { id: "system", label: "System prompt", color: "var(--elev-0)", priority: 4 },
  { id: "retrieval", label: "Retrieved docs", color: "var(--amber)", priority: 1 },
  { id: "history", label: "Conversation history", color: "var(--elev-1)", priority: 2 },
  { id: "user", label: "User message", color: "var(--success)", priority: 5 },
  { id: "output", label: "Reserved for output", color: "var(--muted-foreground)", priority: 6 },
];

export function ContextWindowViz() {
  const [windowSize, setWindowSize] = React.useState("32000");
  const [values, setValues] = React.useState<Record<string, number>>({
    system: 800,
    retrieval: 12000,
    history: 18000,
    user: 200,
    output: 4000,
  });

  const total = Object.values(values).reduce((a, b) => a + b, 0);
  const limit = Number(windowSize);
  const overflow = Math.max(0, total - limit);

  // Pack in priority order; anything the window can't hold is evicted, lowest
  // priority first. This mirrors a naive truncation policy on purpose.
  const packed = React.useMemo(() => {
    const ordered = [...SEGMENTS].sort((a, b) => b.priority - a.priority);
    let remaining = limit;
    const kept: Record<string, number> = {};
    for (const seg of ordered) {
      const want = values[seg.id] ?? 0;
      const give = Math.max(0, Math.min(want, remaining));
      kept[seg.id] = give;
      remaining -= give;
    }
    return kept;
  }, [values, limit]);

  const cut = SEGMENTS.filter((s) => packed[s.id] < (values[s.id] ?? 0));

  const set = (id: string) => (v: number) =>
    setValues((s) => ({ ...s, [id]: v }));

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : String(n);

  return (
    <VizFrame
      label="Context budget"
      hint="Overspend it and watch what goes"
      controls={
        <VizToggle
          ariaLabel="Context window size"
          value={windowSize}
          onChange={setWindowSize}
          options={WINDOWS}
        />
      }
      footer="Input and output share one window. Segments here evict lowest-priority first — the policy you get by default if you don't write one."
    >
      <div
        className={cn(
          "relative flex h-11 w-full overflow-hidden rounded-lg border",
          overflow > 0 ? "border-danger/50" : "border-border",
        )}
        role="img"
        aria-label={`${fmt(total)} of ${fmt(limit)} tokens used`}
      >
        {SEGMENTS.map((seg) => {
          const width = (packed[seg.id] / limit) * 100;
          if (width <= 0) return null;
          return (
            <motion.div
              key={seg.id}
              className="relative h-full border-r border-black/20 last:border-r-0"
              animate={{ width: `${width}%` }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              style={{ background: `rgb(${seg.color} / 0.55)` }}
              title={`${seg.label}: ${fmt(packed[seg.id])}`}
            >
              {width > 12 && (
                <span className="absolute inset-0 grid place-items-center px-1 text-center text-2xs font-medium text-foreground">
                  {fmt(packed[seg.id])}
                </span>
              )}
            </motion.div>
          );
        })}
        {total < limit && (
          <div className="h-full flex-1 bg-surface-3/40">
            <span className="grid h-full place-items-center text-2xs text-muted-foreground">
              {fmt(limit - total)} free
            </span>
          </div>
        )}
      </div>

      {overflow > 0 && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
          <AlertTriangle className="size-3.5 shrink-0" />
          Over budget by {fmt(overflow)} tokens — evicting{" "}
          {cut.length > 0
            ? cut.map((s) => s.label.toLowerCase()).join(" and ")
            : "the lowest-priority segments"}
          .
        </p>
      )}

      <div className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <VizSlider
          label="System prompt"
          value={values.system}
          onChange={set("system")}
          min={0}
          max={4000}
          step={100}
          format={fmt}
          accent = "shelf"
        />
        <VizSlider
          label="Retrieved docs"
          value={values.retrieval}
          onChange={set("retrieval")}
          min={0}
          max={Math.min(limit, 120000)}
          step={500}
          format={fmt}
          accent = "upland"
        />
        <VizSlider
          label="Conversation history"
          value={values.history}
          onChange={set("history")}
          min={0}
          max={Math.min(limit, 120000)}
          step={500}
          format={fmt}
        />
        <VizSlider
          label="Reserved for output"
          value={values.output}
          onChange={set("output")}
          min={256}
          max={16000}
          step={256}
          format={fmt}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SEGMENTS.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-2xs text-muted-foreground"
          >
            <span
              className="size-1.5 rounded-full"
              style={{ background: `rgb(${s.color})` }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </VizFrame>
  );
}
