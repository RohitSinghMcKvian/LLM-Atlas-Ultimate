"use client";

import * as React from "react";
import { CircleCheck, CircleX, MoveRight } from "lucide-react";
import { RichText } from "./rich-text";
import type { CompareSide } from "@/lib/learn/types";

/**
 * The wrong way and the right way, side by side.
 *
 * Prose does this badly. "Don't say 'summarise this', say what audience, what
 * length, what format" is a sentence a reader nods at and forgets; the same
 * point as two prompts they can hold in one glance is a thing they copy.
 *
 * The verdict line is mandatory in the type for a reason — two boxes without a
 * stated reason is an aesthetic preference, not a lesson.
 */
export function CompareBlock({
  title,
  bad,
  good,
  verdict,
}: {
  title?: string;
  bad: CompareSide;
  good: CompareSide;
  verdict: string;
}) {
  return (
    <div className="not-prose overflow-hidden rounded-2xl border border-border bg-surface/40">
      {title && (
        <p className="border-b border-border bg-surface-2/50 px-4 py-2.5 text-xs font-semibold">
          {title}
        </p>
      )}

      <div className="grid gap-px bg-border sm:grid-cols-2">
        <Side side={bad} kind="bad" />
        <Side side={good} kind="good" />
      </div>

      <p className="flex items-start gap-2 border-t border-border bg-action/10 px-4 py-2.5 text-xs leading-relaxed">
        <MoveRight className="mt-0.5 size-3.5 shrink-0 text-action" aria-hidden />
        <span>
          <span className="font-semibold text-action">Why: </span>
          {verdict}
        </span>
      </p>
    </div>
  );
}

function Side({ side, kind }: { side: CompareSide; kind: "bad" | "good" }) {
  const isGood = kind === "good";
  const Icon = isGood ? CircleCheck : CircleX;

  return (
    <div className="bg-surface/60 p-4">
      <p
        className={
          isGood
            ? "mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-success"
            : "mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-danger"
        }
      >
        <Icon className="size-3.5" aria-hidden />
        {side.label}
      </p>

      {side.code && (
        <pre
          className={
            isGood
              ? "mb-2 overflow-x-auto rounded-lg border border-success/25 bg-success/[0.05] p-2.5 font-mono text-2xs leading-relaxed text-foreground/90"
              : "mb-2 overflow-x-auto rounded-lg border border-danger/25 bg-danger/[0.05] p-2.5 font-mono text-2xs leading-relaxed text-foreground/90"
          }
        >
          <code>{side.code}</code>
        </pre>
      )}

      <RichText className="text-xs leading-relaxed text-muted-foreground">
        {side.text}
      </RichText>
    </div>
  );
}
