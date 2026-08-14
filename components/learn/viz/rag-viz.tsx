"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VizFrame, VizToggle } from "./frame";
import { cn } from "@/lib/utils";

/**
 * The retrieval pipeline, run one stage at a time.
 *
 * Each query is authored to fail differently: one is a paraphrase that lexical
 * search misses, one is an exact identifier that dense search misses, and one
 * has a plausible-but-wrong chunk that only the re-ranker removes. Stepping
 * through all three is the lesson.
 */

interface Chunk {
  id: string;
  source: string;
  text: string;
  /** Per-query scores, authored to demonstrate a specific failure. */
  dense: Record<string, number>;
  lexical: Record<string, number>;
  rerank: Record<string, number>;
}

const QUERIES = [
  { value: "refund", label: "Paraphrase", text: "how do I get my money back" },
  { value: "error", label: "Identifier", text: "what does ERR_2043 mean" },
  { value: "ship", label: "Ambiguous", text: "how long until my order arrives" },
];

const CHUNKS: Chunk[] = [
  {
    id: "C1",
    source: "policy.md § Refunds",
    text: "Approved refunds are returned to the original payment method within 5 business days.",
    dense: { refund: 0.87, error: 0.11, ship: 0.29 },
    lexical: { refund: 0.04, error: 0.0, ship: 0.08 },
    rerank: { refund: 0.96, error: 0.02, ship: 0.14 },
  },
  {
    id: "C2",
    source: "policy.md § Returns",
    text: "Items may be returned within 30 days. A receipt is required for approval.",
    dense: { refund: 0.71, error: 0.06, ship: 0.31 },
    lexical: { refund: 0.02, error: 0.0, ship: 0.05 },
    rerank: { refund: 0.62, error: 0.01, ship: 0.09 },
  },
  {
    id: "C3",
    source: "errors.md § 2xxx",
    text: "ERR_2043 — payment authorization expired before capture. Retry the charge.",
    dense: { refund: 0.34, error: 0.41, ship: 0.12 },
    lexical: { refund: 0.0, error: 0.98, ship: 0.0 },
    rerank: { refund: 0.08, error: 0.97, ship: 0.03 },
  },
  {
    id: "C4",
    source: "errors.md § intro",
    text: "Error codes in the 2000 range relate to payment processing.",
    dense: { refund: 0.28, error: 0.63, ship: 0.09 },
    lexical: { refund: 0.0, error: 0.31, ship: 0.0 },
    rerank: { refund: 0.05, error: 0.54, ship: 0.02 },
  },
  {
    id: "C5",
    source: "shipping.md § Delivery",
    text: "Standard delivery is 3-5 business days after dispatch; express is next day.",
    dense: { refund: 0.22, error: 0.05, ship: 0.89 },
    lexical: { refund: 0.0, error: 0.0, ship: 0.22 },
    rerank: { refund: 0.04, error: 0.01, ship: 0.95 },
  },
  {
    id: "C6",
    source: "shipping.md § Dispatch",
    text: "Orders placed before 2pm are dispatched the same day.",
    dense: { refund: 0.18, error: 0.04, ship: 0.74 },
    lexical: { refund: 0.0, error: 0.0, ship: 0.14 },
    rerank: { refund: 0.03, error: 0.0, ship: 0.71 },
  },
  {
    id: "C7",
    source: "faq.md § Cancellations",
    text: "Orders can be cancelled before dispatch. Cancelled orders are refunded automatically.",
    // High dense score on the refund query but answers a different question —
    // exactly the case a re-ranker exists to remove.
    dense: { refund: 0.79, error: 0.08, ship: 0.52 },
    lexical: { refund: 0.11, error: 0.0, ship: 0.03 },
    rerank: { refund: 0.31, error: 0.01, ship: 0.18 },
  },
  {
    id: "C8",
    source: "handbook.md § Tone",
    text: "Always address the customer by name and confirm you have understood the issue.",
    dense: { refund: 0.14, error: 0.09, ship: 0.16 },
    lexical: { refund: 0.0, error: 0.0, ship: 0.0 },
    rerank: { refund: 0.02, error: 0.01, ship: 0.02 },
  },
];

const STAGES = [
  { key: "corpus", label: "Corpus", note: "Every chunk in the index." },
  { key: "retrieve", label: "Retrieve", note: "Hybrid: dense + lexical, fused. Top 4 kept." },
  { key: "rerank", label: "Re-rank", note: "A cross-encoder reads query and chunk together. Top 2 kept." },
  { key: "generate", label: "Generate", note: "Only the survivors reach the prompt." },
] as const;

export function RagViz() {
  const [query, setQuery] = React.useState(QUERIES[0].value);
  const [stage, setStage] = React.useState(0);

  const q = QUERIES.find((x) => x.value === query)!;

  const scored = React.useMemo(() => {
    // Fuse dense and lexical the way RRF does in spirit: neither score
    // dominates, so an exact-match hit survives a low dense score.
    return CHUNKS.map((c) => ({
      chunk: c,
      fused: c.dense[query] * 0.6 + c.lexical[query] * 0.7,
      rerank: c.rerank[query],
    })).sort((a, b) => b.fused - a.fused);
  }, [query]);

  const retrieved = scored.slice(0, 4);
  const reranked = [...retrieved].sort((a, b) => b.rerank - a.rerank).slice(0, 2);

  const visible =
    stage === 0
      ? scored
      : stage === 1
        ? retrieved
        : reranked;

  return (
    <VizFrame
      label="RAG pipeline"
      hint="Step through the stages"
      controls={
        <>
          <VizToggle
            ariaLabel="Query"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setStage(0);
            }}
            options={QUERIES.map((x) => ({ value: x.value, label: x.label }))}
          />
          {stage > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setStage(0)}>
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setStage((s) => Math.min(s + 1, STAGES.length - 1))}
            disabled={stage === STAGES.length - 1}
          >
            Next <ChevronRight className="size-3.5" />
          </Button>
        </>
      }
      footer="Scores are authored to demonstrate each stage's job. Watch C3 on the identifier query — dense retrieval ranks it fourth, lexical rescues it."
    >
      <p className="mb-3 rounded-lg border border-border bg-surface-2/50 px-2.5 py-1.5 font-mono text-xs">
        <span className="text-muted-foreground">query:</span> {q.text}
      </p>

      <ol className="mb-3 flex items-center gap-1 text-2xs">
        {STAGES.map((s, i) => (
          <React.Fragment key={s.key}>
            <li
              className={cn(
                "rounded-full border px-2 py-0.5 transition-colors",
                i === stage
                  ? "border-action/50 bg-action/10 font-semibold text-action"
                  : i < stage
                    ? "border-border bg-surface-2 text-muted-foreground"
                    : "border-border text-muted-foreground/50",
              )}
            >
              {s.label}
            </li>
            {i < STAGES.length - 1 && (
              <li aria-hidden className="text-muted-foreground/40">
                →
              </li>
            )}
          </React.Fragment>
        ))}
      </ol>
      <p className="mb-3 text-xs text-muted-foreground">{STAGES[stage].note}</p>

      <ul className="space-y-1.5">
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((row) => {
            const score =
              stage === 0
                ? null
                : stage === 1
                  ? row.fused
                  : row.rerank;
            return (
              <motion.li
                key={row.chunk.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.22 }}
                className={cn(
                  "rounded-lg border px-2.5 py-2",
                  stage === 3
                    ? "border-success/40 bg-success/5"
                    : "border-border bg-surface-2/40",
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xs text-action">
                    [{row.chunk.id}]
                  </span>
                  <span className="truncate text-2xs text-muted-foreground">
                    {row.chunk.source}
                  </span>
                  {score !== null && (
                    <span className="ml-auto shrink-0 font-mono text-2xs tnum text-amber">
                      {score.toFixed(2)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-snug text-foreground/85">
                  {row.chunk.text}
                </p>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {stage === 3 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 rounded-lg border border-action/30 bg-action/10 px-2.5 py-2 text-xs"
        >
          The prompt now carries {reranked.length} chunks —{" "}
          <span className="font-mono text-action">
            {reranked.map((r) => r.chunk.id).join(", ")}
          </span>{" "}
          — instead of all {CHUNKS.length}. Fewer tokens, less noise, and every
          claim in the answer is checkable against a labelled source.
        </motion.p>
      )}
    </VizFrame>
  );
}
