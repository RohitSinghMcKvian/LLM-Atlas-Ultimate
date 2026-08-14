"use client";

import * as React from "react";
import { VizFrame, VizToggle } from "./frame";
import { cn } from "@/lib/utils";

/**
 * An attention map you can read a token at a time.
 *
 * Weights are generated from an authored rule per head and then softmaxed
 * under a causal mask, rather than hand-typed as a 10x10 table. That keeps the
 * two properties the lesson depends on genuinely true of the picture: each row
 * sums to 1, and nothing attends to the future.
 */

const TOKENS = [
  "The",
  "cat",
  "sat",
  "on",
  "the",
  "mat",
  "because",
  "it",
  "was",
  "warm",
];

interface Head {
  id: string;
  label: string;
  description: string;
  /** Unnormalized affinity of query i for key j. */
  score: (i: number, j: number) => number;
}

const HEADS: Head[] = [
  {
    id: "prev",
    label: "Head 2 · previous token",
    description:
      "The simplest learned pattern: attend to the token immediately before. Heads like this appear in every trained model and carry local word order.",
    score: (i, j) => (j === i - 1 ? 4 : j === i ? 1 : 0.15),
  },
  {
    id: "coref",
    label: "Head 7 · coreference",
    description:
      "Pronouns look back at what they refer to. Hover 'it' — the mass concentrates on 'mat', which is what makes the sentence interpretable.",
    score: (i, j) => {
      const q = TOKENS[i].toLowerCase();
      const k = TOKENS[j].toLowerCase();
      if (q === "it" && (k === "mat" || k === "cat")) return k === "mat" ? 5 : 2.5;
      if (q === "was" && k === "it") return 3;
      if (q === "warm" && k === "mat") return 2.6;
      return j === i ? 1.4 : 0.2;
    },
  },
  {
    id: "subject",
    label: "Head 4 · subject–verb",
    description:
      "Verbs attend back to their subject across intervening words. This is how agreement survives long clauses.",
    score: (i, j) => {
      const q = TOKENS[i].toLowerCase();
      const k = TOKENS[j].toLowerCase();
      if ((q === "sat" || q === "was") && k === "cat") return 4.2;
      if (q === "mat" && k === "on") return 2.4;
      if (q === "because" && k === "sat") return 2.2;
      return j === i ? 1.2 : 0.25;
    },
  },
];

/** Causal softmax over keys 0..i. */
function attentionRow(head: Head, i: number): number[] {
  const row = TOKENS.map((_, j) => (j <= i ? Math.exp(head.score(i, j)) : 0));
  const sum = row.reduce((a, b) => a + b, 0) || 1;
  return row.map((v) => v / sum);
}

export function AttentionViz() {
  const [headId, setHeadId] = React.useState(HEADS[1].id);
  const [query, setQuery] = React.useState(7); // "it"

  const head = HEADS.find((h) => h.id === headId) ?? HEADS[0];
  const matrix = React.useMemo(
    () => TOKENS.map((_, i) => attentionRow(head, i)),
    [head],
  );
  const active = matrix[query];
  const strongest = active.indexOf(Math.max(...active));

  return (
    <VizFrame
      label="Attention"
      hint="Hover a row to change the query token"
      controls={
        <VizToggle
          ariaLabel="Attention head"
          value={headId}
          onChange={setHeadId}
          options={HEADS.map((h) => ({ value: h.id, label: h.label.split(" · ")[0] }))}
        />
      }
      footer="Rows are query tokens, columns are keys. Each row sums to 1, and the upper triangle is empty because a token cannot attend to the future."
    >
      <p className="mb-3 text-xs text-muted-foreground">{head.description}</p>

      {/* Sentence view — the same weights, read as highlight intensity. */}
      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-2/50 p-2.5">
        {TOKENS.map((t, j) => (
          <span
            key={j}
            className={cn(
              "rounded px-1.5 py-0.5 text-sm transition-colors",
              j === query && "ring-1 ring-action",
            )}
            style={{
              background:
                j <= query
                  ? `rgb(var(--elev-1) / ${(active[j] * 0.85).toFixed(3)})`
                  : "transparent",
              color: j > query ? "rgb(var(--muted-foreground) / 0.4)" : undefined,
            }}
          >
            {t}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5">
          <caption className="sr-only">
            Attention weights for {head.label}
          </caption>
          <thead>
            <tr>
              <th className="w-16" />
              {TOKENS.map((t, j) => (
                <th
                  key={j}
                  scope="col"
                  className="h-14 w-7 align-bottom text-2xs font-normal text-muted-foreground"
                >
                  <span className="inline-block origin-bottom-left translate-x-2 -rotate-45 whitespace-nowrap">
                    {t}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TOKENS.map((t, i) => (
              <tr
                key={i}
                onMouseEnter={() => setQuery(i)}
                onFocus={() => setQuery(i)}
                className="cursor-pointer"
              >
                <th
                  scope="row"
                  tabIndex={0}
                  className={cn(
                    "w-16 pr-1.5 text-right text-2xs font-normal outline-none",
                    i === query ? "font-semibold text-action" : "text-muted-foreground",
                  )}
                >
                  {t}
                </th>
                {TOKENS.map((_, j) => {
                  const w = matrix[i][j];
                  const masked = j > i;
                  return (
                    <td
                      key={j}
                      title={masked ? "masked" : `${t} → ${TOKENS[j]}: ${w.toFixed(2)}`}
                      className={cn(
                        "size-7 rounded-sm",
                        masked && "bg-surface-3/25",
                        i === query && !masked && "ring-1 ring-action/40",
                      )}
                      style={
                        masked
                          ? undefined
                          : { background: `rgb(var(--elev-1) / ${(0.06 + w * 0.9).toFixed(3)})` }
                      }
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs">
        <span className="font-mono text-action">{TOKENS[query]}</span> attends most
        strongly to{" "}
        <span className="font-mono text-action">{TOKENS[strongest]}</span>{" "}
        <span className="font-mono text-2xs text-muted-foreground">
          ({(active[strongest] * 100).toFixed(0)}%)
        </span>
      </p>
    </VizFrame>
  );
}
