"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, RotateCcw, CircleCheck, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VizFrame, VizStat, VizToggle } from "./frame";
import { cn } from "@/lib/utils";

/**
 * The same question, answered two ways.
 *
 * On the left, an answer produced in one step. On the right, the same model
 * given room to work. The traces are authored — a live model would answer
 * differently on every run and this needs to be a stable illustration — but the
 * token counts and the cost are computed from the text you can read, so the
 * trade is not being hidden from you: reasoning is bought with output tokens.
 */

interface Problem {
  value: string;
  label: string;
  question: string;
  /** The one-step attempt, and why it goes wrong. */
  direct: { answer: string; correct: boolean; why: string };
  /** The worked steps, in order. */
  steps: string[];
  reasoned: { answer: string; correct: boolean };
}

const PROBLEMS: Problem[] = [
  {
    value: "cost",
    label: "Arithmetic",
    question:
      "A support bot handles 40,000 turns a month. Each turn sends 6,200 input tokens and generates 340 output tokens. Input is $0.30/M, output $1.20/M. What is the monthly bill?",
    direct: {
      answer: "About $60 a month.",
      correct: false,
      why: "It produced a plausible-looking figure without ever multiplying anything. Nothing in a single forward pass forces the arithmetic to happen — the model is predicting what a cost answer looks like.",
    },
    steps: [
      "Input tokens per month: 40,000 × 6,200 = 248,000,000 tokens.",
      "Input cost: 248 M tokens × $0.30 per M = $74.40.",
      "Output tokens per month: 40,000 × 340 = 13,600,000 tokens.",
      "Output cost: 13.6 M × $1.20 per M = $16.32.",
      "Total: $74.40 + $16.32 = $90.72.",
    ],
    reasoned: { answer: "$90.72 per month — $74.40 input, $16.32 output.", correct: true },
  },
  {
    value: "logic",
    label: "Constraint",
    question:
      "Every request must be logged. Logs may not contain personal data. The request body contains the customer's email. Can you log the request body as-is?",
    direct: {
      answer: "Yes — logging request bodies is standard practice for debugging.",
      correct: false,
      why: "It answered from the frequency of the pattern in its training data rather than from the three constraints in the question. The conflict is one step away and it never took the step.",
    },
    steps: [
      "Constraint 1: every request must be logged. So some log entry is required.",
      "Constraint 2: logs may not contain personal data.",
      "An email address is personal data.",
      "The request body contains an email, so logging it as-is violates constraint 2.",
      "Both constraints can still hold if the body is logged with the email redacted or hashed.",
    ],
    reasoned: {
      answer:
        "No — not as-is. Log the request with the email redacted or replaced by a stable hash; that satisfies both rules.",
      correct: true,
    },
  },
];

/** ~4 characters per token, the rule of thumb from the tokenizer lesson. */
const estimate = (text: string) => Math.ceil(text.length / 4);

const OUTPUT_PRICE_PER_M = 1.2;

export function ReasoningViz() {
  const [problemId, setProblemId] = React.useState(PROBLEMS[0].value);
  const [shown, setShown] = React.useState(0);

  const p = PROBLEMS.find((x) => x.value === problemId)!;
  const revealedSteps = p.steps.slice(0, shown);
  const finished = shown >= p.steps.length;

  const directTokens = estimate(p.direct.answer);
  const reasonedTokens =
    p.steps.reduce((n, s) => n + estimate(s), 0) + estimate(p.reasoned.answer);
  const shownTokens =
    revealedSteps.reduce((n, s) => n + estimate(s), 0) +
    (finished ? estimate(p.reasoned.answer) : 0);

  const cost = (tokens: number) =>
    `$${((tokens / 1_000_000) * OUTPUT_PRICE_PER_M).toFixed(5)}`;

  return (
    <VizFrame
      label="Reasoning, step by step"
      hint="Reveal the working and watch the token count"
      controls={
        <>
          <VizToggle
            ariaLabel="Problem"
            value={problemId}
            onChange={(v) => {
              setProblemId(v);
              setShown(0);
            }}
            options={PROBLEMS.map((x) => ({ value: x.value, label: x.label }))}
          />
          {shown > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShown(0)}>
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShown((s) => Math.min(s + 1, p.steps.length))}
            disabled={finished}
          >
            {shown === 0 ? "Show working" : "Next step"}
            <ChevronRight className="size-3.5" />
          </Button>
        </>
      }
      footer="Traces are authored so the comparison is stable; token counts are estimated from the text at ~4 characters per token and priced at $1.20/M output. Reasoning is not free and not magic — it is output tokens spent turning a one-shot guess into a checkable derivation."
    >
      <p className="mb-3 rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-xs leading-relaxed">
        {p.question}
      </p>

      <div className="grid gap-2 lg:grid-cols-2">
        {/* Direct answer */}
        <div className="rounded-xl border border-danger/30 bg-danger/[0.04] p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-danger">
            <CircleX className="size-3.5" /> Answer straight away
          </p>
          <p className="text-sm leading-relaxed">{p.direct.answer}</p>
          <p className="mt-2 border-t border-danger/20 pt-2 text-2xs leading-relaxed text-muted-foreground">
            {p.direct.why}
          </p>
          <p className="mt-2 font-mono text-2xs tnum text-muted-foreground">
            {directTokens} output tokens · {cost(directTokens)}
          </p>
        </div>

        {/* Reasoned answer */}
        <div
          className={cn(
            "rounded-xl border p-3 transition-colors",
            finished
              ? "border-success/35 bg-success/[0.05]"
              : "border-border bg-surface-2/40",
          )}
        >
          <p
            className={cn(
              "mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider",
              finished ? "text-success" : "text-muted-foreground",
            )}
          >
            <CircleCheck className="size-3.5" /> Work it out first
          </p>

          <ol className="space-y-1.5">
            <AnimatePresence initial={false}>
              {revealedSteps.map((s, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex gap-2 text-xs leading-relaxed"
                >
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-action/40 font-mono text-2xs font-bold text-action">
                    {i + 1}
                  </span>
                  <span className="text-foreground/85">{s}</span>
                </motion.li>
              ))}
            </AnimatePresence>
            {!finished && (
              <li className="pl-6 text-2xs text-muted-foreground">
                {shown === 0
                  ? `${p.steps.length} steps hidden — reveal them one at a time.`
                  : `${p.steps.length - shown} step${p.steps.length - shown === 1 ? "" : "s"} to go.`}
              </li>
            )}
          </ol>

          {finished && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2.5 rounded-lg border border-success/30 bg-success/10 px-2.5 py-1.5 text-sm font-medium leading-relaxed"
            >
              {p.reasoned.answer}
            </motion.p>
          )}

          <p className="mt-2 font-mono text-2xs tnum text-muted-foreground">
            {shownTokens} output tokens · {cost(shownTokens)}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <VizStat label="Direct tokens" value={directTokens} accent="danger" />
        <VizStat label="Reasoned tokens" value={reasonedTokens} accent="success" />
        <VizStat
          label="Token multiple"
          value={`${(reasonedTokens / Math.max(1, directTokens)).toFixed(1)}×`}
          accent = "upland"
        />
        <VizStat
          label="Extra cost / 1K calls"
          value={`$${(((reasonedTokens - directTokens) / 1_000_000) * OUTPUT_PRICE_PER_M * 1000).toFixed(2)}`}
        />
      </div>

      <p className="mt-2.5 rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5 text-2xs leading-relaxed text-muted-foreground">
        {(reasonedTokens / Math.max(1, directTokens)).toFixed(1)}× the output tokens
        for an answer that is actually derivable. That is a good trade on a billing
        calculation and a terrible one on &ldquo;what&rsquo;s the capital of
        France&rdquo; — which is the whole reason routing exists.
      </p>
    </VizFrame>
  );
}
