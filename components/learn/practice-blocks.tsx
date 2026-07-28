"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  CircleCheck,
  CircleHelp,
  Eye,
  ListOrdered,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichText } from "./rich-text";
import { useLearnStore } from "@/lib/store/learn-store";
import { PRACTICE_XP, type Block } from "@/lib/learn/types";
import { announce } from "@/lib/atlas-events";
import { cn } from "@/lib/utils";

/**
 * Inline drills.
 *
 * These sit in the gap the course had between a multiple-choice quiz and a
 * four-hundred-word graded practical: low stakes, instant feedback, unlimited
 * retries, no grade attached. They exist because reading a correct answer and
 * producing one are different skills, and only the second one transfers.
 *
 * Both are checked in the browser. Nothing here needs a model, so nothing here
 * needs a network round trip or an API key.
 */

type PredictSpec = Extract<Block, { type: "predict" }>;
type SortSpec = Extract<Block, { type: "sort" }>;

/**
 * A deterministic shuffle.
 *
 * `Math.random()` would reorder the pool between server render and hydration
 * and React would replace the whole list. Seeding from the block id gives one
 * fixed order per drill that still looks scrambled.
 */
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 48271) + 11) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// predict — commit, then reveal
// ---------------------------------------------------------------------------

/**
 * Commit to an answer before seeing it.
 *
 * The reveal is gated on a choice on purpose. A reader who has guessed
 * "temperature 0 will still vary" and finds out they were wrong remembers it;
 * a reader who read the same sentence unprompted has learned a fact they will
 * not recall next week.
 */
export function PredictBlock({ block }: { block: PredictSpec }) {
  const record = useLearnStore((s) => s.practice[block.id]);
  const recordPractice = useLearnStore((s) => s.recordPractice);

  const [choice, setChoice] = React.useState<number | null>(null);
  const [guess, setGuess] = React.useState("");
  const [revealed, setRevealed] = React.useState(false);

  const hasOptions = Boolean(block.options?.length);
  const committed = hasOptions ? choice !== null : guess.trim().length > 0;

  function reveal() {
    setRevealed(true);
    // There is no marking scheme here — the learner is the judge of their own
    // prediction, so the item is credited for having been attempted honestly.
    // Paying only once is what stops that from being exploitable.
    recordPractice(block.id, true, block.points ?? PRACTICE_XP);
    announce("Prediction revealed.");
  }

  return (
    <div className="not-prose overflow-hidden rounded-2xl border border-violet/30 bg-surface/60">
      <div className="flex items-center gap-2 border-b border-border bg-violet/[0.07] px-3.5 py-2.5">
        <span className="grid size-5 place-items-center rounded bg-violet/20 text-violet">
          <CircleHelp className="size-3" />
        </span>
        <span className="text-xs font-semibold">Predict first</span>
        {record?.attempts ? (
          <span className="ml-auto inline-flex items-center gap-1 text-2xs text-muted-foreground">
            <Check className="size-3 text-success" /> attempted
          </span>
        ) : (
          <span className="ml-auto text-2xs text-muted-foreground">
            no wrong answers
          </span>
        )}
      </div>

      <div className="p-3.5">
        <RichText className="text-sm font-medium leading-relaxed">
          {block.question}
        </RichText>

        {hasOptions ? (
          <ul className="mt-3 space-y-1.5" role="radiogroup">
            {block.options!.map((opt, i) => (
              <li key={opt}>
                <button
                  role="radio"
                  aria-checked={choice === i}
                  disabled={revealed}
                  onClick={() => setChoice(i)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                    choice === i
                      ? "border-violet/50 bg-violet/10"
                      : "border-border bg-surface-2/40 hover:border-border-strong",
                    revealed && "opacity-70",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                      choice === i ? "border-violet" : "border-border-strong",
                    )}
                  >
                    {choice === i && (
                      <span className="size-1.5 rounded-full bg-violet" />
                    )}
                  </span>
                  <span className="leading-snug">{opt}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <label htmlFor={`predict-${block.id}`} className="sr-only">
              Your prediction
            </label>
            <textarea
              id={`predict-${block.id}`}
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              disabled={revealed}
              rows={3}
              placeholder="Write what you think will happen, then reveal…"
              className="mt-3 w-full resize-y rounded-xl border border-border bg-surface-2/50 p-2.5 text-sm leading-relaxed outline-none transition-colors focus:border-violet/50 disabled:opacity-70"
            />
          </>
        )}

        {!revealed && (
          <Button
            variant="primary"
            size="sm"
            className="mt-3"
            disabled={!committed}
            onClick={reveal}
          >
            <Eye className="size-3.5" />
            {committed ? "Reveal the answer" : "Commit to an answer first"}
          </Button>
        )}

        <AnimatePresence initial={false}>
          {revealed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.25 }}
              className="mt-3 overflow-hidden"
            >
              <div className="rounded-xl border border-violet/30 bg-gradient-primary-soft p-3">
                <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-violet">
                  What actually happens
                </p>
                <RichText className="text-sm leading-relaxed text-foreground/90">
                  {block.reveal}
                </RichText>
              </div>
              <RichText className="mt-2 px-1 text-xs leading-relaxed text-muted-foreground">
                {block.explain}
              </RichText>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => {
                  setRevealed(false);
                  setChoice(null);
                  setGuess("");
                }}
              >
                <RotateCcw className="size-3.5" /> Try again
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// sort — put the stages back in order
// ---------------------------------------------------------------------------

/**
 * Order the stages.
 *
 * Click-to-place rather than drag-and-drop: dragging needs a pointer, a steady
 * hand, and a fallback for keyboard and touch users, and buys nothing here that
 * two clicks don't already give.
 */
export function SortBlock({ block }: { block: SortSpec }) {
  const record = useLearnStore((s) => s.practice[block.id]);
  const recordPractice = useLearnStore((s) => s.recordPractice);

  const pool = React.useMemo(
    () => seededShuffle(block.items, block.id),
    [block.items, block.id],
  );

  const [placed, setPlaced] = React.useState<string[]>([]);
  const [checked, setChecked] = React.useState(false);

  const remaining = pool.filter((i) => !placed.includes(i.id));
  const complete = placed.length === block.items.length;
  const label = (id: string) =>
    block.items.find((i) => i.id === id)?.text ?? id;

  /** Correct only if every position matches — partial credit would teach a partial order. */
  const allRight =
    checked && placed.every((id, i) => id === block.correct[i]);

  function check() {
    const right = placed.every((id, i) => id === block.correct[i]);
    setChecked(true);
    recordPractice(block.id, right, block.points ?? PRACTICE_XP);
    announce(right ? "Order correct." : "Order not correct yet.");
  }

  function reset() {
    setPlaced([]);
    setChecked(false);
  }

  return (
    <div className="not-prose overflow-hidden rounded-2xl border border-cyan/30 bg-surface/60">
      <div className="flex items-center gap-2 border-b border-border bg-cyan/[0.07] px-3.5 py-2.5">
        <span className="grid size-5 place-items-center rounded bg-cyan/20 text-cyan">
          <ListOrdered className="size-3" />
        </span>
        <span className="text-xs font-semibold">Put it in order</span>
        {record?.correct && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-2xs text-success">
            <Check className="size-3" /> solved
          </span>
        )}
      </div>

      <div className="p-3.5">
        <p className="text-sm font-medium leading-relaxed">{block.title}</p>

        {/* The answer being built. */}
        <ol className="mt-3 space-y-1.5">
          {placed.map((id, i) => {
            const right = checked && block.correct[i] === id;
            const wrong = checked && !right;
            return (
              <motion.li
                key={id}
                layout
                transition={{ duration: 0.18 }}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2",
                  right && "border-success/45 bg-success/[0.07]",
                  wrong && "border-danger/45 bg-danger/[0.07]",
                  !checked && "border-cyan/35 bg-cyan/[0.05]",
                )}
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-[10px] font-bold">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug">
                  {label(id)}
                </span>
                {checked ? (
                  right ? (
                    <CircleCheck className="size-4 shrink-0 text-success" />
                  ) : (
                    <X className="size-4 shrink-0 text-danger" />
                  )
                ) : (
                  <button
                    onClick={() =>
                      setPlaced((p) => p.filter((x) => x !== id))
                    }
                    aria-label={`Remove ${label(id)}`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </motion.li>
            );
          })}

          {!complete && (
            <li className="rounded-xl border border-dashed border-border px-3 py-2 text-2xs text-muted-foreground">
              Position {placed.length + 1} — pick the next stage below
            </li>
          )}
        </ol>

        {/* The pool. */}
        {remaining.length > 0 && !checked && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {remaining.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => setPlaced((p) => [...p, item.id])}
                  className="rounded-lg border border-border bg-surface-2/60 px-2.5 py-1.5 text-left text-xs transition-colors hover:border-cyan/50 hover:bg-cyan/[0.07]"
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!checked ? (
            <Button
              variant="primary"
              size="sm"
              disabled={!complete}
              onClick={check}
            >
              <Check className="size-3.5" /> Check order
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" />
              {allRight ? "Do it again" : "Try again"}
            </Button>
          )}
          {checked && (
            <span
              className={cn(
                "text-xs font-semibold",
                allRight ? "text-success" : "text-danger",
              )}
            >
              {allRight
                ? "Exactly right."
                : `${placed.filter((id, i) => id === block.correct[i]).length} of ${block.correct.length} in place.`}
            </span>
          )}
        </div>

        <AnimatePresence initial={false}>
          {checked && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <RichText className="mt-2 rounded-xl border border-border bg-surface-2/40 px-3 py-2 text-xs leading-relaxed text-foreground/85">
                {block.explain}
              </RichText>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
