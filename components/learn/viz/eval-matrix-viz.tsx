"use client";

import * as React from "react";
import { VizFrame, VizSlider, VizStat, VizToggle } from "./frame";
import { cn } from "@/lib/utils";

/**
 * The precision/recall trade, made unavoidable.
 *
 * Every number below is computed from the labelled set at the threshold you
 * choose. The scores and labels are authored illustrative data — they are not a
 * benchmark of anything — but the arithmetic on them is real, which is the part
 * that has to be, because the whole point is that you cannot raise both numbers
 * by moving one slider.
 */

interface Case {
  id: string;
  prompt: string;
  /** The judge's confidence that the answer is good, 0-1. */
  score: number;
  /** Ground truth from a human reviewer. */
  good: boolean;
}

/**
 * 24 graded cases. The overlap between 0.45 and 0.7 is deliberate: a judge with
 * perfectly separable scores would make this widget lie about how easy it is.
 */
const CASES: Case[] = [
  { id: "c01", prompt: "Refund window for a faulty item", score: 0.96, good: true },
  { id: "c02", prompt: "Cancel an order after dispatch", score: 0.93, good: true },
  { id: "c03", prompt: "Express delivery cut-off time", score: 0.91, good: true },
  { id: "c04", prompt: "Change the delivery address", score: 0.88, good: true },
  { id: "c05", prompt: "Meaning of ERR_2043", score: 0.85, good: true },
  { id: "c06", prompt: "Refund to a closed bank account", score: 0.81, good: true },
  { id: "c07", prompt: "Bulk order discount policy", score: 0.78, good: false },
  { id: "c08", prompt: "Warranty on refurbished units", score: 0.74, good: true },
  { id: "c09", prompt: "International duties and taxes", score: 0.71, good: false },
  { id: "c10", prompt: "Price match against a competitor", score: 0.68, good: true },
  { id: "c11", prompt: "Return without a receipt", score: 0.66, good: false },
  { id: "c12", prompt: "Gift wrapping availability", score: 0.63, good: true },
  { id: "c13", prompt: "Subscription pause rules", score: 0.61, good: false },
  { id: "c14", prompt: "Damaged in transit — who pays", score: 0.58, good: true },
  { id: "c15", prompt: "Loyalty points expiry", score: 0.55, good: false },
  { id: "c16", prompt: "Partial refund on a bundle", score: 0.52, good: false },
  { id: "c17", prompt: "Delivery to a locker", score: 0.49, good: true },
  { id: "c18", prompt: "Reship after a failed delivery", score: 0.45, good: false },
  { id: "c19", prompt: "Cancel a subscription mid-term", score: 0.41, good: false },
  { id: "c20", prompt: "Tax invoice for a business", score: 0.36, good: false },
  { id: "c21", prompt: "Recycle the packaging", score: 0.29, good: false },
  { id: "c22", prompt: "Store opening hours on holidays", score: 0.24, good: false },
  { id: "c23", prompt: "Sponsorship enquiry", score: 0.17, good: false },
  { id: "c24", prompt: "Unrelated legal question", score: 0.08, good: false },
];

type Cell = "tp" | "fp" | "fn" | "tn";

const CELL_META: Record<
  Cell,
  { label: string; sub: string; tint: string; ring: string }
> = {
  tp: {
    label: "True positive",
    sub: "shipped, and good",
    tint: "text-success",
    ring: "border-success/40 bg-success/[0.08]",
  },
  fp: {
    label: "False positive",
    sub: "shipped, but bad",
    tint: "text-danger",
    ring: "border-danger/40 bg-danger/[0.08]",
  },
  fn: {
    label: "False negative",
    sub: "blocked, but good",
    tint: "text-amber",
    ring: "border-amber/40 bg-amber/[0.08]",
  },
  tn: {
    label: "True negative",
    sub: "blocked, and bad",
    tint: "text-muted-foreground",
    ring: "border-border bg-surface-2/40",
  },
};

function classify(c: Case, threshold: number): Cell {
  const passed = c.score >= threshold;
  if (passed && c.good) return "tp";
  if (passed && !c.good) return "fp";
  if (!passed && c.good) return "fn";
  return "tn";
}

export function EvalMatrixViz() {
  const [threshold, setThreshold] = React.useState(0.6);
  const [view, setView] = React.useState("matrix");

  const rows = React.useMemo(
    () => CASES.map((c) => ({ ...c, cell: classify(c, threshold) })),
    [threshold],
  );

  const counts = React.useMemo(() => {
    const n: Record<Cell, number> = { tp: 0, fp: 0, fn: 0, tn: 0 };
    for (const r of rows) n[r.cell] += 1;
    return n;
  }, [rows]);

  // Guarded so an empty numerator reads as "—" rather than NaN. A threshold of
  // 1.0 legitimately ships nothing, and precision is undefined there, not zero.
  const precision =
    counts.tp + counts.fp > 0 ? counts.tp / (counts.tp + counts.fp) : null;
  const recall =
    counts.tp + counts.fn > 0 ? counts.tp / (counts.tp + counts.fn) : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  const accuracy = (counts.tp + counts.tn) / CASES.length;

  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);

  return (
    <VizFrame
      label="Eval threshold"
      hint="Move the line and watch both numbers refuse to rise together"
      controls={
        <VizToggle
          ariaLabel="View"
          value={view}
          onChange={setView}
          options={[
            { value: "matrix", label: "Matrix" },
            { value: "cases", label: "Cases" },
          ]}
        />
      }
      footer="24 cases with a judge score and a human verdict. The scores are illustrative; the precision, recall and F1 are computed from them at your threshold. Notice there is no setting where both precision and recall reach 100% — that would need a judge that never disagrees with the reviewer."
    >
      <div className="mb-4">
        <VizSlider
          label="Pass threshold"
          value={threshold}
          onChange={setThreshold}
          min={0.05}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
        />
      </div>

      {view === "matrix" ? (
        <div className="grid grid-cols-2 gap-2">
          {(["tp", "fp", "fn", "tn"] as Cell[]).map((cell) => {
            const meta = CELL_META[cell];
            return (
              <div
                key={cell}
                className={cn("rounded-xl border px-3 py-2.5", meta.ring)}
              >
                <p
                  className={cn(
                    "font-display text-2xl font-bold tnum",
                    meta.tint,
                  )}
                >
                  {counts[cell]}
                </p>
                <p className="text-2xs font-semibold">{meta.label}</p>
                <p className="text-[10px] text-muted-foreground">{meta.sub}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {rows.map((r) => {
            const meta = CELL_META[r.cell];
            return (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                  meta.ring,
                )}
              >
                <span className="min-w-0 flex-1 truncate">{r.prompt}</span>
                <span className="shrink-0 font-mono text-2xs tnum text-muted-foreground">
                  {r.score.toFixed(2)}
                </span>
                <span
                  className={cn(
                    "w-7 shrink-0 text-right font-mono text-2xs font-bold uppercase",
                    meta.tint,
                  )}
                >
                  {r.cell}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <VizStat label="Precision" value={pct(precision)} accent="cyan" />
        <VizStat label="Recall" value={pct(recall)} accent="violet" />
        <VizStat label="F1" value={pct(f1)} accent="amber" />
        <VizStat label="Accuracy" value={pct(accuracy)} />
      </div>

      <p className="mt-2.5 rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5 text-2xs leading-relaxed text-muted-foreground">
        {precision !== null && recall !== null && precision > recall
          ? "Tuned for precision: what ships is mostly right, and some good answers are being blocked. The setting for a legal or medical surface."
          : precision !== null && recall !== null && recall > precision
            ? "Tuned for recall: almost nothing good is blocked, and some bad answers get through. The setting for a draft assistant with a human in the loop."
            : "Balanced. Which is only the right choice if a false positive and a false negative cost you the same, and they usually don't."}
      </p>
    </VizFrame>
  );
}
