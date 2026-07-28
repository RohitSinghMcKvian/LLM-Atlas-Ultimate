"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ClipboardCheck,
  Lightbulb,
  Loader2,
  Send,
  RotateCcw,
  TriangleAlert,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichText } from "./rich-text";
import { useLearnStore } from "@/lib/store/learn-store";
import { useUIStore } from "@/lib/store/ui-store";
import { useKeysStore } from "@/lib/store/keys-store";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { MAX_CRITERION_SCORE, type Block, type GradeResult } from "@/lib/learn/types";
import { isPassing } from "@/lib/learn/grading";
import { announce } from "@/lib/atlas-events";
import { cn } from "@/lib/utils";

type ExerciseBlock = Extract<Block, { type: "exercise" }>;

/**
 * A graded practical.
 *
 * The rubric is shown *before* submission, deliberately: a student who can see
 * what full marks means can aim at it, and a grade against hidden criteria is
 * an opinion rather than an assessment. Only the submission is posted — the
 * rubric the server grades against is read from the curriculum, never from the
 * client.
 */
export function ExerciseBlock({ block }: { block: ExerciseBlock }) {
  const record = useLearnStore((s) => s.exercises[block.id]);
  const recordGrade = useLearnStore((s) => s.recordGrade);
  const activeModelId = useUIStore((s) => s.activeModelId);
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const keyHeaders = useUserKeyHeaders();

  const [text, setText] = React.useState(block.starter ?? "");
  const [grading, setGrading] = React.useState(false);
  const [result, setResult] = React.useState<GradeResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showHint, setShowHint] = React.useState(false);
  const [showRubric, setShowRubric] = React.useState(true);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const totalWeight = block.rubric.reduce((n, c) => n + c.weight, 0);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  async function submit() {
    if (!activeModelId) {
      setError("Select a model in the top bar — grading runs on your chosen model.");
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setGrading(true);
    setError(null);
    announce("Submitting for grading.");

    try {
      const res = await fetch("/api/v1/learn/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeaders },
        body: JSON.stringify({
          exerciseId: block.id,
          submission: text,
          modelId: activeModelId,
        }),
        signal: ctrl.signal,
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.error === "key_required" || res.status === 402) {
          setKeyModalOpen(true);
        }
        setError(
          data?.message ??
            data?.error ??
            `Grading failed (${res.status}). Try again.`,
        );
        return;
      }

      const grade = data as GradeResult;
      setResult(grade);
      recordGrade(block.id, grade, block.points);
      announce(`Graded ${grade.letter}, ${grade.percent} percent.`);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);
    } finally {
      setGrading(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="not-prose overflow-hidden rounded-2xl border border-amber/30 bg-surface/60 shadow-glow">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-amber/[0.07] px-3.5 py-2.5">
        <span className="grid size-5 place-items-center rounded bg-amber/20 text-amber">
          <ClipboardCheck className="size-3" />
        </span>
        <span className="text-xs font-semibold">Graded practical</span>
        {record && (
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              isPassing(record.percent)
                ? "border-success/40 bg-success/10 text-success"
                : "border-danger/40 bg-danger/10 text-danger",
            )}
          >
            Best: {record.letter} · {record.percent.toFixed(0)}%
          </span>
        )}
      </div>

      <div className="p-3.5 sm:p-4">
        <h4 className="font-display text-base font-semibold tracking-tight">
          {block.title}
        </h4>
        <RichText className="mt-1.5 text-sm leading-relaxed text-foreground/85">
          {block.brief}
        </RichText>

        {/* Rubric — visible before submission, by design. */}
        <div className="mt-3 rounded-xl border border-border bg-surface-2/40">
          <button
            onClick={() => setShowRubric((v) => !v)}
            aria-expanded={showRubric}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                !showRubric && "-rotate-90",
              )}
            />
            Rubric · {block.rubric.length} criteria
          </button>
          {showRubric && (
            <ul className="space-y-1.5 px-3 pb-3">
              {block.rubric.map((c) => (
                <li key={c.id} className="flex gap-2 text-xs">
                  <span className="mt-0.5 w-9 shrink-0 rounded bg-surface-3 px-1 text-center font-mono text-[10px] text-muted-foreground">
                    {Math.round((c.weight / totalWeight) * 100)}%
                  </span>
                  <span>
                    <span className="font-medium">{c.label}</span>
                    <span className="text-muted-foreground"> — {c.descriptor}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label htmlFor={`ex-${block.id}`} className="sr-only">
          Your submission
        </label>
        <textarea
          id={`ex-${block.id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck
          placeholder="Write your answer here…"
          className="mt-3 w-full resize-y rounded-xl border border-border bg-surface-2/50 p-3 font-mono text-[13px] leading-relaxed outline-none transition-colors focus:border-amber/50"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={grading || text.trim().length < 40}
          >
            {grading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Grading…
              </>
            ) : (
              <>
                <Send className="size-3.5" /> {record ? "Resubmit" : "Submit for grading"}
              </>
            )}
          </Button>
          {block.hint && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHint((v) => !v)}
            >
              <Lightbulb className="size-3.5" /> {showHint ? "Hide hint" : "Hint"}
            </Button>
          )}
          {block.starter && text !== block.starter && (
            <Button variant="ghost" size="sm" onClick={() => setText(block.starter!)}>
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          )}
          <span className="ml-auto font-mono text-2xs tnum text-muted-foreground">
            {wordCount} words
          </span>
        </div>

        <AnimatePresence initial={false}>
          {showHint && block.hint && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 overflow-hidden rounded-xl border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-foreground/85"
            >
              {block.hint}
            </motion.p>
          )}
        </AnimatePresence>

        {error && (
          <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        )}

        {result && <GradeCard result={result} rubric={block.rubric} />}
      </div>
    </div>
  );
}

function GradeCard({
  result,
  rubric,
}: {
  result: GradeResult;
  rubric: ExerciseBlock["rubric"];
}) {
  const passed = isPassing(result.percent);
  const labelOf = (id: string) => rubric.find((c) => c.id === id)?.label ?? id;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface-2/40"
    >
      <div className="flex items-center gap-4 border-b border-border px-4 py-3">
        <div
          className={cn(
            "grid size-14 shrink-0 place-items-center rounded-2xl border-2 font-display text-2xl font-bold",
            passed
              ? "border-success/50 bg-success/10 text-success"
              : "border-danger/50 bg-danger/10 text-danger",
          )}
        >
          {result.letter}
        </div>
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold tnum">
            {result.percent.toFixed(1)}%
            <span className="ml-2 text-2xs font-normal text-muted-foreground">
              {result.gradePoints.toFixed(1)} grade points
            </span>
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground/85">
            {result.feedback}
          </p>
        </div>
      </div>

      <ul className="space-y-2 px-4 py-3">
        {result.criteria.map((c) => (
          <li key={c.id}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">{labelOf(c.id)}</span>
              <span className="shrink-0 font-mono text-2xs tnum text-muted-foreground">
                {c.score} / {MAX_CRITERION_SCORE}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <motion.div
                className={cn(
                  "h-full rounded-full",
                  c.score >= 3
                    ? "bg-success"
                    : c.score >= 2
                      ? "bg-amber"
                      : "bg-danger",
                )}
                initial={{ width: 0 }}
                animate={{ width: `${(c.score / MAX_CRITERION_SCORE) * 100}%` }}
                transition={{ duration: 0.5, delay: 0.1 }}
              />
            </div>
            {c.comment && (
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                {c.comment}
              </p>
            )}
          </li>
        ))}
      </ul>

      {(result.strengths.length > 0 || result.improvements.length > 0) && (
        <div className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-2">
          {result.strengths.length > 0 && (
            <div>
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-success">
                Strengths
              </p>
              <ul className="space-y-0.5 text-xs text-foreground/85">
                {result.strengths.map((s, i) => (
                  <li key={i}>· {s}</li>
                ))}
              </ul>
            </div>
          )}
          {result.improvements.length > 0 && (
            <div>
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-amber">
                Improve next
              </p>
              <ul className="space-y-0.5 text-xs text-foreground/85">
                {result.improvements.map((s, i) => (
                  <li key={i}>· {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
        Assessed by {result.gradedBy ?? "your selected model"} against the rubric
        above. Resubmitting keeps your best grade.
      </p>
    </motion.div>
  );
}
