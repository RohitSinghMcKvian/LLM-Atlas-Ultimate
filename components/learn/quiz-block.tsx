"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X, RotateCcw, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLearnStore } from "@/lib/store/learn-store";
import { announce } from "@/lib/atlas-events";
import type { Block } from "@/lib/learn/types";
import { cn } from "@/lib/utils";

type QuizBlock = Extract<Block, { type: "quiz" }>;

/**
 * A checked-answer question, single or multi-select.
 *
 * Multi-select is inferred from the shape of `answer` rather than a separate
 * flag, so an author cannot write an array answer and forget to mark the block
 * as multi. The interaction changes accordingly — radio semantics for one
 * answer, checkbox semantics for several — because the affordance has to tell
 * the reader how many to pick before they pick.
 */
export function QuizBlock({ block }: { block: QuizBlock }) {
  const record = useLearnStore((s) => s.quizzes[block.id]);
  const answerQuiz = useLearnStore((s) => s.answerQuiz);

  const multi = Array.isArray(block.answer);
  const correctSet = React.useMemo(
    () => new Set(Array.isArray(block.answer) ? block.answer : [block.answer]),
    [block.answer],
  );

  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [checked, setChecked] = React.useState(false);

  const isCorrect =
    picked.size === correctSet.size &&
    [...picked].every((i) => correctSet.has(i));

  function toggle(i: number) {
    if (checked) return;
    setPicked((prev) => {
      if (!multi) return new Set([i]);
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function check() {
    setChecked(true);
    answerQuiz(block.id, isCorrect, block.points);
    announce(isCorrect ? "Correct." : "Not quite. Explanation shown.");
  }

  function retry() {
    setChecked(false);
    setPicked(new Set());
  }

  return (
    <div className="not-prose rounded-2xl border border-border bg-surface/60 p-4 shadow-glow">
      <div className="mb-1 flex items-center gap-1.5 text-2xs uppercase tracking-wider text-muted-foreground">
        <HelpCircle className="size-3.5 text-cyan" />
        {multi ? "Select all that apply" : "Check your understanding"}
        {record?.correct && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-success">
            <Check className="size-3" /> answered
          </span>
        )}
      </div>
      <p className="mb-3 text-sm font-medium">{block.question}</p>

      <div
        role={multi ? "group" : "radiogroup"}
        aria-label={block.question}
        className="space-y-1.5"
      >
        {block.options.map((option, i) => {
          const isPicked = picked.has(i);
          const isAnswer = correctSet.has(i);
          const reveal = checked && (isAnswer || isPicked);
          return (
            <button
              key={i}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={isPicked}
              disabled={checked}
              onClick={() => toggle(i)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                !checked && isPicked && "border-cyan/50 bg-cyan/10",
                !checked &&
                  !isPicked &&
                  "border-border hover:border-border-strong hover:bg-surface-2/50",
                reveal && isAnswer && "border-success/50 bg-success/10",
                reveal && isPicked && !isAnswer && "border-danger/50 bg-danger/10",
                checked && !reveal && "border-border opacity-50",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center border text-[10px] font-semibold",
                  multi ? "rounded" : "rounded-full",
                  isPicked
                    ? "border-cyan bg-cyan/15 text-cyan"
                    : "border-border-strong text-muted-foreground",
                  reveal && isAnswer && "border-success bg-success/15 text-success",
                  reveal &&
                    isPicked &&
                    !isAnswer &&
                    "border-danger bg-danger/15 text-danger",
                )}
              >
                {reveal && isAnswer ? (
                  <Check className="size-3" />
                ) : reveal && isPicked ? (
                  <X className="size-3" />
                ) : (
                  String.fromCharCode(65 + i)
                )}
              </span>
              <span className="flex-1">{option}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!checked ? (
          <Button
            variant="primary"
            size="sm"
            disabled={picked.size === 0}
            onClick={check}
          >
            Check answer
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={retry}>
            <RotateCcw className="size-3.5" /> Try again
          </Button>
        )}
        {record && record.attempts > 0 && (
          <span className="text-2xs text-muted-foreground">
            {record.attempts} attempt{record.attempts === 1 ? "" : "s"}
            {record.xp > 0 && ` · ${record.xp} XP`}
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {checked && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <p
              className={cn(
                "mt-3 rounded-xl border px-3 py-2 text-xs leading-relaxed",
                isCorrect
                  ? "border-success/30 bg-success/5"
                  : "border-amber/30 bg-amber/5",
              )}
            >
              <span
                className={cn(
                  "font-semibold",
                  isCorrect ? "text-success" : "text-amber",
                )}
              >
                {isCorrect ? "Correct. " : "Not quite. "}
              </span>
              {block.explain}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
