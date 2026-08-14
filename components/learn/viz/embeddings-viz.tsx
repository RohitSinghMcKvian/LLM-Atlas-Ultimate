"use client";

import * as React from "react";
import { VizFrame, VizStat } from "./frame";
import { cn } from "@/lib/utils";

/**
 * A 2-D embedding space you can interrogate.
 *
 * Words are placed by angle so that the *geometry on screen is the similarity
 * being reported* — cosine here is literally the cosine of the angle you can
 * see between two points and the origin. A random scatter with pre-baked
 * similarity numbers would teach the wrong intuition: that the picture and the
 * maths are separate things.
 */

interface Word {
  word: string;
  /** Degrees. Cluster membership is an angular band. */
  angle: number;
  /** 0.45-1. Magnitude carries no meaning — cosine normalizes it away. */
  radius: number;
  cluster: string;
}

const CLUSTERS: Record<string, { label: string; color: string }> = {
  code: { label: "Programming", color: "var(--elev-1)" },
  money: { label: "Billing", color: "var(--elev-0)" },
  animal: { label: "Animals", color: "var(--amber)" },
  royal: { label: "Monarchy", color: "var(--success)" },
};

const WORDS: Word[] = [
  { word: "function", angle: 12, radius: 0.86, cluster: "code" },
  { word: "compiler", angle: 26, radius: 0.72, cluster: "code" },
  { word: "debug", angle: 40, radius: 0.9, cluster: "code" },
  { word: "syntax", angle: 2, radius: 0.62, cluster: "code" },
  { word: "variable", angle: 33, radius: 0.55, cluster: "code" },

  { word: "refund", angle: 100, radius: 0.88, cluster: "money" },
  { word: "invoice", angle: 114, radius: 0.7, cluster: "money" },
  { word: "payment", angle: 92, radius: 0.6, cluster: "money" },
  { word: "receipt", angle: 126, radius: 0.83, cluster: "money" },
  { word: "billing", angle: 108, radius: 0.5, cluster: "money" },

  { word: "dog", angle: 196, radius: 0.84, cluster: "animal" },
  { word: "cat", angle: 208, radius: 0.68, cluster: "animal" },
  { word: "kitten", angle: 219, radius: 0.88, cluster: "animal" },
  { word: "wolf", angle: 186, radius: 0.58, cluster: "animal" },

  { word: "king", angle: 292, radius: 0.86, cluster: "royal" },
  { word: "queen", angle: 302, radius: 0.74, cluster: "royal" },
  { word: "throne", angle: 283, radius: 0.62, cluster: "royal" },
  { word: "crown", angle: 312, radius: 0.9, cluster: "royal" },
];

const W = 340;
const H = 280;
const CX = W / 2;
const CY = H / 2;
const SCALE = 112;

function xy(w: Word) {
  const rad = (w.angle * Math.PI) / 180;
  return { x: CX + Math.cos(rad) * w.radius * SCALE, y: CY - Math.sin(rad) * w.radius * SCALE };
}

/** Cosine of the angle between two words' vectors from the origin. */
export function cosineOf(a: Word, b: Word): number {
  return Math.cos(((a.angle - b.angle) * Math.PI) / 180);
}

export function EmbeddingsViz() {
  const [selected, setSelected] = React.useState<Word>(WORDS[5]);

  const neighbours = React.useMemo(
    () =>
      WORDS.filter((w) => w.word !== selected.word)
        .map((w) => ({ word: w, sim: cosineOf(selected, w) }))
        .sort((a, b) => b.sim - a.sim),
    [selected],
  );

  const top = neighbours.slice(0, 3);
  const topSet = new Set(top.map((n) => n.word.word));
  const farthest = neighbours[neighbours.length - 1];
  const sel = xy(selected);

  return (
    <VizFrame
      label="Embedding space"
      hint="Click any word"
      footer="A real embedding has hundreds of dimensions; this is two, so the geometry is legible. Cosine similarity here is exactly the cosine of the on-screen angle."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_11rem]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full rounded-lg border border-border bg-[rgb(var(--surface-2))]"
          role="img"
          aria-label={`Embedding scatter. ${selected.word} selected. Nearest: ${top
            .map((t) => t.word.word)
            .join(", ")}.`}
        >
          <circle
            cx={CX}
            cy={CY}
            r={SCALE}
            fill="none"
            stroke="rgb(var(--border))"
            strokeDasharray="3 5"
          />
          <circle cx={CX} cy={CY} r={SCALE * 0.5} fill="none" stroke="rgb(var(--border))" strokeDasharray="3 5" />

          {/* Similarity rays to the three nearest neighbours. */}
          {top.map(({ word, sim }) => {
            const p = xy(word);
            return (
              <line
                key={`ray-${word.word}`}
                x1={sel.x}
                y1={sel.y}
                x2={p.x}
                y2={p.y}
                stroke="rgb(var(--elev-1))"
                strokeWidth={1 + sim * 1.6}
                strokeOpacity={0.15 + sim * 0.45}
              />
            );
          })}

          {WORDS.map((w) => {
            const p = xy(w);
            const isSelected = w.word === selected.word;
            const isNeighbour = topSet.has(w.word);
            const color = CLUSTERS[w.cluster].color;
            return (
              <g
                key={w.word}
                role="button"
                tabIndex={0}
                aria-label={w.word}
                onClick={() => setSelected(w)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(w);
                  }
                }}
                className="cursor-pointer"
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isSelected ? 6 : 4}
                  fill={`rgb(${color})`}
                  fillOpacity={isSelected || isNeighbour ? 1 : 0.45}
                  stroke={isSelected ? "rgb(var(--foreground))" : "transparent"}
                  strokeWidth={1.5}
                />
                <text
                  x={p.x + 8}
                  y={p.y + 3.5}
                  fontSize={10}
                  className="select-none"
                  fill={
                    isSelected || isNeighbour
                      ? "rgb(var(--foreground))"
                      : "rgb(var(--muted-foreground))"
                  }
                  fontWeight={isSelected ? 700 : 400}
                >
                  {w.word}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="space-y-2">
          <div>
            <p className="text-2xs uppercase tracking-wider text-muted-foreground">
              Nearest to
            </p>
            <p className="font-mono text-sm font-semibold text-action">
              {selected.word}
            </p>
          </div>
          <ul className="space-y-1">
            {top.map(({ word, sim }) => (
              <li
                key={word.word}
                className="flex items-center justify-between rounded-lg border border-border bg-surface-2/50 px-2 py-1"
              >
                <span className="font-mono text-xs">{word.word}</span>
                <span className="font-mono text-2xs tnum text-action">
                  {sim.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <VizStat
            label={`Farthest · ${farthest.word.word}`}
            value={farthest.sim.toFixed(2)}
            accent={farthest.sim < 0 ? "danger" : "upland"}
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {Object.entries(CLUSTERS).map(([id, c]) => (
              <span
                key={id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-2xs",
                  selected.cluster === id && "border-border-strong",
                )}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: `rgb(${c.color})` }}
                />
                {c.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </VizFrame>
  );
}
