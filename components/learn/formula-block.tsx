"use client";

import * as React from "react";
import { Sigma } from "lucide-react";
import { RichText } from "./rich-text";

/**
 * Real math, with every symbol glossed.
 *
 * Deliberately plain text rather than LaTeX. KaTeX costs around 90 kB of JS
 * plus a stylesheet to typeset a handful of one-line expressions, and the
 * expressions this course uses — a softmax, a cosine, a weighted average — are
 * perfectly legible in monospace. The part that actually teaches is the `where`
 * list underneath: an unexplained symbol is where most readers quietly give up.
 */
export function FormulaBlock({
  expr,
  where,
  note,
}: {
  expr: string;
  where: { sym: string; meaning: string }[];
  note?: string;
}) {
  return (
    <div className="not-prose overflow-hidden rounded-2xl border border-accent/25 bg-accent/[0.04]">
      <div className="flex items-center gap-2 border-b border-accent/20 px-4 py-2">
        <Sigma className="size-3.5 text-accent" aria-hidden />
        <span className="text-2xs font-semibold uppercase tracking-wider text-accent">
          The maths
        </span>
      </div>

      <div className="overflow-x-auto px-4 py-4">
        <p className="whitespace-pre text-center font-mono text-sm leading-relaxed text-foreground">
          {expr}
        </p>
      </div>

      <dl className="space-y-1.5 border-t border-accent/15 px-4 py-3">
        {where.map((w) => (
          <div key={w.sym} className="flex gap-2.5 text-xs">
            <dt className="w-16 shrink-0 text-right font-mono font-semibold text-accent">
              {w.sym}
            </dt>
            <dd className="min-w-0 leading-relaxed text-foreground/80">
              {w.meaning}
            </dd>
          </div>
        ))}
      </dl>

      {note && (
        <RichText className="border-t border-accent/15 bg-surface-2/30 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {note}
        </RichText>
      )}
    </div>
  );
}
