"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles,
  TriangleAlert,
  Info,
  CircleCheck,
  Copy,
  CheckCheck,
  BookMarked,
  Lightbulb,
  Layers,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  type LucideIcon,
} from "lucide-react";
import { RichText } from "./rich-text";
import { LessonViz } from "./viz";
import { LiveCell } from "./live-cell";
import { QuizBlock } from "./quiz-block";
import { ExerciseBlock } from "./exercise-block";
import { CompareBlock } from "./compare-block";
import { FormulaBlock } from "./formula-block";
import { AnnotatedBlock } from "./annotated-block";
import { PredictBlock, SortBlock } from "./practice-blocks";
import { useLearnStore } from "@/lib/store/learn-store";
import { termId } from "@/lib/learn/practice";
import type { Block, KeyTerm, Tone } from "@/lib/learn/types";
import { cn } from "@/lib/utils";

/**
 * Diagrams are authored as data, but the renderer that draws them carries
 * framer-motion paths and a ResizeObserver. A lesson that only uses prose and a
 * table should not pay for it.
 */
const Figure = dynamic(() => import("./figure").then((m) => m.Figure), {
  loading: () => (
    <div
      className="h-40 w-full animate-pulse rounded-2xl border border-border bg-surface-2/40"
      aria-hidden
    />
  ),
});

/** Stable heading slug — also the anchor the in-page contents links to. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Block types that break out of the prose measure.
 *
 * Prose belongs at ~68 characters and that is worth defending. A ten-column
 * attention matrix does not — squeezing every diagram into a reading measure
 * was the worst thing about the previous reader.
 */
const WIDE: ReadonlySet<Block["type"]> = new Set([
  "viz",
  "figure",
  "table",
  "compare",
  "annotated",
]);

export function isWideBlock(block: Block): boolean {
  return WIDE.has(block.type);
}

export function BlockView({
  block,
  keyTerms,
  lessonId,
}: {
  block: Block;
  keyTerms?: KeyTerm[];
  lessonId?: string;
}) {
  switch (block.type) {
    case "p":
      return (
        <RichText className="text-pretty leading-[1.75] text-foreground/90">
          {block.text}
        </RichText>
      );

    case "h":
      return <SectionHeading text={block.text} id={block.id} />;

    case "callout":
      return <Callout tone={block.tone} title={block.title} text={block.text} />;

    case "code":
      return <CodeBlock lang={block.lang} code={block.code} caption={block.caption} />;

    case "table":
      return <DataTable head={block.head} rows={block.rows} caption={block.caption} />;

    case "steps":
      return <StepList title={block.title} steps={block.steps} />;

    case "viz":
      return <LessonViz viz={block.viz} caption={block.caption} />;

    case "figure":
      return <Figure figure={block.figure} caption={block.caption} />;

    case "compare":
      return (
        <CompareBlock
          title={block.title}
          bad={block.bad}
          good={block.good}
          verdict={block.verdict}
        />
      );

    case "formula":
      return (
        <FormulaBlock expr={block.expr} where={block.where} note={block.note} />
      );

    case "annotated":
      return (
        <AnnotatedBlock text={block.text} notes={block.notes} lang={block.lang} />
      );

    case "keyterms":
      return <KeyTermList terms={keyTerms ?? []} lessonId={lessonId} />;

    case "live":
      return (
        <LiveCell prompt={block.prompt} note={block.note} system={block.system} />
      );

    case "predict":
      return <PredictBlock block={block} />;

    case "sort":
      return <SortBlock block={block} />;

    case "quiz":
      return <QuizBlock block={block} />;

    case "exercise":
      return <ExerciseBlock block={block} />;
  }
}

// ---------------------------------------------------------------------------

/**
 * A section break with a self-linking anchor.
 *
 * The rule and the hover anchor exist so a reader scrolling a four-thousand-word
 * lesson can tell where they are, and link a colleague to the exact part.
 */
function SectionHeading({ text, id }: { text: string; id?: string }) {
  const slug = id ?? headingId(text);
  return (
    <h3 id={slug} className="group scroll-mt-28 pt-4">
      <span
        aria-hidden
        className="mb-3 block h-px w-full bg-gradient-to-r from-border-strong via-border to-transparent"
      />
      <span className="flex items-baseline gap-2">
        <span className="font-display text-xl font-semibold tracking-tight text-balance">
          {text}
        </span>
        <a
          href={`#${slug}`}
          aria-label={`Link to section: ${text}`}
          className="font-mono text-sm text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        >
          #
        </a>
      </span>
    </h3>
  );
}

const TONES: Record<
  Tone,
  {
    icon: LucideIcon;
    border: string;
    bg: string;
    text: string;
    eyebrow?: string;
  }
> = {
  info: {
    icon: Info,
    border: "border-border-strong",
    bg: "bg-surface-2/50",
    text: "text-foreground",
  },
  insight: {
    icon: Sparkles,
    border: "border-action/30",
    bg: "bg-action/10",
    text: "text-action",
  },
  warn: {
    icon: TriangleAlert,
    border: "border-amber/35",
    bg: "bg-amber/[0.07]",
    text: "text-amber",
  },
  success: {
    icon: CircleCheck,
    border: "border-success/35",
    bg: "bg-success/[0.07]",
    text: "text-success",
  },
  /**
   * The jargon-free restatement. Its own tone and its own eyebrow label, so a
   * reader who wants the simple version can find it by shape alone without
   * reading a word of the surrounding text.
   */
  plain: {
    icon: Lightbulb,
    border: "border-accent/35",
    bg: "bg-accent/[0.06]",
    text: "text-accent",
    eyebrow: "In plain English",
  },
};

function Callout({
  tone = "info",
  title,
  text,
}: {
  tone?: Tone;
  title: string;
  text: string;
}) {
  const cfg = TONES[tone];
  const Icon = cfg.icon;
  return (
    <aside className={cn("not-prose rounded-2xl border p-4", cfg.border, cfg.bg)}>
      {cfg.eyebrow && (
        <p
          className={cn(
            "mb-1.5 text-2xs font-semibold uppercase tracking-[0.16em]",
            cfg.text,
          )}
        >
          {cfg.eyebrow}
        </p>
      )}
      <p
        className={cn(
          "mb-1 flex items-center gap-1.5 text-sm font-semibold",
          cfg.text,
        )}
      >
        <Icon className="size-4 shrink-0" />
        {title}
      </p>
      <RichText className="text-sm leading-relaxed text-foreground/90">
        {text}
      </RichText>
    </aside>
  );
}

function CodeBlock({
  lang,
  code,
  caption,
}: {
  lang: string;
  code: string;
  caption?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is permission-gated and blocked in some embeds. The code is
      // selectable either way, so a failed copy is not worth an error state.
    }
  }

  return (
    <figure className="not-prose overflow-hidden rounded-2xl border border-border bg-[rgb(var(--surface-2))]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
          {lang}
        </span>
        {caption && (
          <span className="truncate text-2xs text-muted-foreground">
            {caption}
          </span>
        )}
        <button
          onClick={copy}
          aria-label="Copy code"
          className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
        >
          {copied ? (
            <CheckCheck className="size-3.5 text-success" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-xs leading-[1.65] text-foreground/85">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

function DataTable({
  head,
  rows,
  caption,
}: {
  head: string[];
  rows: string[][];
  caption?: string;
}) {
  return (
    <figure className="not-prose overflow-hidden rounded-2xl border border-border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="bg-surface-2/70">
              {head.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="whitespace-nowrap border-b border-border px-3 py-2 font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-border last:border-b-0 even:bg-surface-2/25"
              >
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={cn(
                      "px-3 py-2 align-top leading-relaxed",
                      j === 0
                        ? "font-medium text-foreground"
                        : "text-foreground/80",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && (
        <figcaption className="border-t border-border bg-surface-2/30 px-3 py-1.5 text-2xs text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function StepList({
  title,
  steps,
}: {
  title?: string;
  steps: { title: string; text: string }[];
}) {
  return (
    <div className="not-prose">
      {title && (
        <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
      )}
      <ol className="relative space-y-3 border-l border-border pl-5">
        {steps.map((s, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[1.6rem] top-0.5 grid size-5 place-items-center rounded-full border border-action/40 bg-surface text-2xs font-semibold text-action">
              {i + 1}
            </span>
            <p className="text-sm font-medium">{s.title}</p>
            <RichText className="mt-0.5 text-sm leading-relaxed text-foreground/80">
              {s.text}
            </RichText>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key terms — a glossary you can also drill
// ---------------------------------------------------------------------------

/**
 * The glossary, with a study mode.
 *
 * The list is the reference; the cards are the practice. Same authored data,
 * no extra content to write, and answers feed the same spaced-review schedule
 * as every other drill — which is the only reason this is worth having over a
 * plain definition list.
 */
function KeyTermList({
  terms,
  lessonId,
}: {
  terms: KeyTerm[];
  lessonId?: string;
}) {
  const [mode, setMode] = React.useState<"list" | "study">("list");
  if (terms.length === 0) return null;

  return (
    <div className="not-prose overflow-hidden rounded-2xl border border-border bg-surface-2/40">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <BookMarked className="size-3.5 text-accent" aria-hidden />
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Key terms
        </p>
        <span className="font-mono text-2xs tnum text-muted-foreground">
          {terms.length}
        </span>
        {lessonId && (
          <div
            role="radiogroup"
            aria-label="Key term view"
            className="ml-auto inline-flex rounded-lg border border-border bg-surface p-0.5"
          >
            {(["list", "study"] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-2xs font-medium transition-colors",
                  mode === m
                    ? "bg-surface-3 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "study" ? (
                  <span className="inline-flex items-center gap-1">
                    <Layers className="size-3" /> Study
                  </span>
                ) : (
                  "List"
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "list" || !lessonId ? (
        <dl className="space-y-2 p-4">
          {terms.map((t) => (
            <div key={t.term} className="sm:flex sm:gap-3">
              <dt className="shrink-0 font-mono text-xs font-semibold text-action sm:w-40">
                {t.term}
              </dt>
              <dd className="text-xs leading-relaxed text-foreground/80">
                {t.definition}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <Flashcards terms={terms} lessonId={lessonId} />
      )}
    </div>
  );
}

function Flashcards({
  terms,
  lessonId,
}: {
  terms: KeyTerm[];
  lessonId: string;
}) {
  const recordPractice = useLearnStore((s) => s.recordPractice);
  const [at, setAt] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [scored, setScored] = React.useState<Record<number, boolean>>({});

  const term = terms[at];
  const answered = Object.keys(scored).length;
  const done = answered === terms.length;

  function score(knew: boolean) {
    recordPractice(termId(lessonId, term.term), knew);
    setScored((s) => ({ ...s, [at]: knew }));
    setFlipped(false);
    if (at < terms.length - 1) setAt(at + 1);
  }

  if (done) {
    const right = Object.values(scored).filter(Boolean).length;
    return (
      <div className="p-5 text-center">
        <p className="font-display text-3xl font-semibold tnum">
          {right}
          <span className="text-muted-foreground">/{terms.length}</span>
        </p>
        <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
          {right === terms.length
            ? "Every term. These come back in Practice on a long cooldown."
            : "The ones you missed are queued for review sooner than the rest."}
        </p>
        <button
          onClick={() => {
            setScored({});
            setAt(0);
            setFlipped(false);
          }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-3"
        >
          <RotateCcw className="size-3.5" /> Run through again
        </button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-action transition-[width] duration-300"
            style={{ width: `${(answered / terms.length) * 100}%` }}
          />
        </div>
        <span className="font-mono text-2xs tnum text-muted-foreground">
          {at + 1}/{terms.length}
        </span>
      </div>

      <button
        onClick={() => setFlipped((f) => !f)}
        aria-expanded={flipped}
        className="grid min-h-[7rem] w-full place-items-center rounded-xl border border-accent/30 bg-action/10 px-4 py-5 text-center transition-colors hover:border-accent/50"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={flipped ? "back" : "front"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="block"
          >
            {flipped ? (
              <span className="text-sm leading-relaxed text-foreground/90">
                {term.definition}
              </span>
            ) : (
              <>
                <span className="block font-mono text-lg font-semibold text-action">
                  {term.term}
                </span>
                <span className="mt-1 block text-2xs text-muted-foreground">
                  tap to reveal the definition
                </span>
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </button>

      {flipped && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={() => score(false)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-danger/35 bg-danger/[0.07] px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/15"
          >
            <ThumbsDown className="size-3.5" /> Not yet
          </button>
          <button
            onClick={() => score(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-success/35 bg-success/[0.07] px-3 py-2 text-xs font-medium text-success transition-colors hover:bg-success/15"
          >
            <ThumbsUp className="size-3.5" /> Knew it
          </button>
        </div>
      )}
    </div>
  );
}
