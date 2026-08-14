"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { VizFrame } from "./frame";
import { cn } from "@/lib/utils";

/**
 * A decoder block, opened up.
 *
 * Deliberately a *stack* rather than a single annotated diagram: the idea the
 * lesson needs to land is that the same operation runs many times and the
 * representation is refined at each pass, which a one-block diagram cannot say.
 */

interface Stage {
  id: string;
  label: string;
  detail: string;
  /** What the representation "knows" after this stage — the payoff line. */
  knows: string;
  accent: "ridge" | "shelf" | "upland";
}

const STAGES: Stage[] = [
  {
    id: "embed",
    label: "Token + position embedding",
    detail:
      "Each token id is looked up in the embedding table and combined with a positional signal, so the model can tell 'dog bites man' from 'man bites dog'.",
    knows: "What this token is, and where it sits.",
    accent: "ridge",
  },
  {
    id: "attn",
    label: "Multi-head self-attention",
    detail:
      "Every token forms a query, key and value; each head blends the sequence by its own learned notion of relevance, and the heads are concatenated.",
    knows: "What this token is, in the company of the others.",
    accent: "shelf",
  },
  {
    id: "norm1",
    label: "Residual + layer norm",
    detail:
      "The attention output is added back to the input and re-normalized. The residual path is what lets gradients survive fifty layers of depth.",
    knows: "The update, without having discarded the original.",
    accent: "ridge",
  },
  {
    id: "ffn",
    label: "Feed-forward network",
    detail:
      "A position-wise MLP, usually 4x wider than the model dimension. Most of a model's parameters live here — and, on current evidence, most of its stored facts.",
    knows: "The token, transformed by what the model knows about it.",
    accent: "upland",
  },
  {
    id: "norm2",
    label: "Residual + layer norm",
    detail:
      "Again: add, normalize, hand upward. The block is now complete and the next identical block receives a slightly better representation.",
    knows: "A refined representation, ready for the next block.",
    accent: "ridge",
  },
  {
    id: "head",
    label: "Output projection → logits",
    detail:
      "After the final block, the last token's vector is projected back onto the vocabulary, producing one score per possible next token. Sampling takes it from there.",
    knows: "A score for every token that could come next.",
    accent: "shelf",
  },
];

export function TransformerViz() {
  const [active, setActive] = React.useState(1);
  const stage = STAGES[active];

  return (
    <VizFrame
      label="Decoder block"
      hint="Select a stage"
      footer="Blocks 2-5 repeat — a small model stacks ~30 of them, a frontier model far more. The shape never changes; only the representation flowing through it does."
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <ol className="space-y-1.5">
          {STAGES.map((s, i) => {
            const isActive = i === active;
            const repeated = i >= 1 && i <= 4;
            return (
              <li key={s.id}>
                <button
                  onClick={() => setActive(i)}
                  aria-current={isActive}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors",
                    isActive
                      ? "border-action/45 bg-action/10"
                      : "border-border bg-surface-2/40 hover:border-border-strong",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded font-mono text-2xs",
                      isActive
                        ? "bg-action text-action-foreground"
                        : "bg-surface-3 text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className={cn("flex-1", isActive && "font-medium")}>
                    {s.label}
                  </span>
                  {repeated && (
                    <span className="shrink-0 rounded bg-surface-3 px-1 text-2xs text-muted-foreground">
                      ×N
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-col gap-3">
          <svg
            viewBox="0 0 200 210"
            className="w-full rounded-lg border border-border bg-[rgb(var(--surface-2))]"
            role="img"
            aria-label={`Transformer stack, ${stage.label} highlighted`}
          >
            {STAGES.map((s, i) => {
              // Drawn top-down in reverse so the output head sits at the top,
              // matching how these diagrams are conventionally read.
              const idx = STAGES.length - 1 - i;
              const y = 8 + i * 33;
              const isActive = idx === active;
              return (
                <g key={s.id}>
                  <motion.rect
                    x={26}
                    y={y}
                    width={148}
                    height={26}
                    rx={6}
                    fill={
                      isActive
                        ? `rgb(var(--${STAGES[idx].accent}) / 0.28)`
                        : "rgb(var(--surface-3) / 0.7)"
                    }
                    stroke={
                      isActive
                        ? `rgb(var(--${STAGES[idx].accent}))`
                        : "rgb(var(--border))"
                    }
                    strokeWidth={isActive ? 1.5 : 1}
                    animate={{ opacity: isActive ? 1 : 0.75 }}
                    className="cursor-pointer"
                    onClick={() => setActive(idx)}
                  />
                  <text
                    x={100}
                    y={y + 17}
                    textAnchor="middle"
                    fontSize={8.5}
                    fill={
                      isActive
                        ? "rgb(var(--foreground))"
                        : "rgb(var(--muted-foreground))"
                    }
                    className="pointer-events-none select-none"
                  >
                    {STAGES[idx].label.length > 30
                      ? `${STAGES[idx].label.slice(0, 28)}…`
                      : STAGES[idx].label}
                  </text>
                  {i < STAGES.length - 1 && (
                    <line
                      x1={100}
                      y1={y + 26}
                      x2={100}
                      y2={y + 33}
                      stroke="rgb(var(--border-strong))"
                      strokeWidth={1.5}
                      markerEnd=""
                    />
                  )}
                </g>
              );
            })}
            <text
              x={100}
              y={205}
              textAnchor="middle"
              fontSize={8}
              fill="rgb(var(--muted-foreground))"
            >
              tokens in
            </text>
          </svg>

          <div className="rounded-lg border border-border bg-surface-2/50 p-3">
            <p className="text-xs font-semibold text-action">{stage.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground/85">
              {stage.detail}
            </p>
            <p className="mt-2 border-t border-border pt-2 text-2xs text-muted-foreground">
              After this stage the representation carries:{" "}
              <span className="text-foreground/80">{stage.knows}</span>
            </p>
          </div>
        </div>
      </div>
    </VizFrame>
  );
}
