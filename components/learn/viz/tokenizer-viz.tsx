"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VizFrame, VizStat } from "./frame";
import { cn } from "@/lib/utils";

/**
 * Live sub-word tokenization.
 *
 * The splitter is a heuristic, not a real BPE merge table — shipping a genuine
 * one would mean a multi-megabyte vocabulary file for a teaching widget. It
 * reproduces the behaviours the lesson is actually about: common words stay
 * whole, rare words fragment, leading whitespace attaches to the following
 * token, and non-Latin text and emoji cost several tokens each. The footer
 * says so, because a lesson about precision shouldn't imply false precision.
 */

const SUFFIXES = [
  "ization",
  "ational",
  "ation",
  "ition",
  "ously",
  "ment",
  "ness",
  "able",
  "ible",
  "ing",
  "tion",
  "sion",
  "ers",
  "est",
  "ly",
  "ed",
  "er",
  "s",
];

const PREFIXES = ["inter", "multi", "under", "over", "trans", "sub", "pre", "non", "un", "re", "de", "dis"];

/** Words this common are single tokens in every real vocabulary. */
const COMMON = new Set([
  "the", "of", "and", "to", "in", "is", "it", "you", "that", "was", "for", "on",
  "are", "with", "as", "his", "they", "at", "be", "this", "have", "from", "or",
  "one", "had", "by", "but", "not", "what", "all", "were", "we", "when", "your",
  "can", "said", "there", "use", "an", "each", "which", "she", "do", "how",
  "their", "if", "will", "up", "other", "about", "out", "many", "then", "them",
  "model", "token", "data", "text", "world", "hello", "atlas", "maps", "llm",
]);

export interface TokenPiece {
  text: string;
  /** Word-initial pieces are tinted differently from continuations. */
  head: boolean;
}

export function tokenize(input: string): TokenPiece[] {
  const pieces: TokenPiece[] = [];
  // Chunk into runs of letters / digits / punctuation, each carrying any
  // whitespace that preceded it — which is how real tokenizers group it.
  const chunks = input.match(/\s*(?:[A-Za-z]+|[0-9]+|[^\sA-Za-z0-9]+|\s+)/g) ?? [];

  for (const chunk of chunks) {
    const lead = chunk.match(/^\s*/)?.[0] ?? "";
    const core = chunk.slice(lead.length);
    if (!core) {
      // Pure whitespace run: a single space merges into the next token, but a
      // long run of them is its own token — as in real tokenizers.
      if (lead.length > 1) pieces.push({ text: lead, head: true });
      continue;
    }

    // Anything non-ASCII (emoji, CJK, accents) is byte-encoded and costs
    // several tokens per character.
    if (/[^\x00-\x7F]/.test(core)) {
      for (const ch of Array.from(core)) {
        const cost = ch.codePointAt(0)! > 0xffff ? 3 : 2;
        for (let i = 0; i < cost; i++) {
          pieces.push({ text: i === 0 ? lead + ch : "·", head: i === 0 });
        }
      }
      continue;
    }

    if (!/^[A-Za-z]+$/.test(core)) {
      // Digits split every 3; punctuation runs stay together.
      if (/^[0-9]+$/.test(core) && core.length > 3) {
        const parts = core.match(/.{1,3}/g) ?? [core];
        parts.forEach((p, i) =>
          pieces.push({ text: i === 0 ? lead + p : p, head: i === 0 }),
        );
      } else {
        pieces.push({ text: lead + core, head: true });
      }
      continue;
    }

    for (const [i, part] of splitWord(core).entries()) {
      pieces.push({ text: i === 0 ? lead + part : part, head: i === 0 });
    }
  }
  return pieces;
}

function splitWord(word: string): string[] {
  const lower = word.toLowerCase();
  if (word.length <= 4 || COMMON.has(lower)) return [word];

  let start = 0;
  let end = word.length;
  const out: string[] = [];

  const prefix = PREFIXES.find(
    (p) => lower.startsWith(p) && word.length - p.length >= 3,
  );
  if (prefix) {
    out.push(word.slice(0, prefix.length));
    start = prefix.length;
  }

  const suffix = SUFFIXES.find(
    (s) => lower.endsWith(s) && end - s.length - start >= 3,
  );
  let tail = "";
  if (suffix) {
    tail = word.slice(end - suffix.length);
    end -= suffix.length;
  }

  const stem = word.slice(start, end);
  if (stem.length <= 6) out.push(stem);
  else for (const part of stem.match(/.{1,5}/g) ?? [stem]) out.push(part);

  if (tail) out.push(tail);
  return out.filter(Boolean);
}

const DEFAULT_TEXT =
  "Atlas maps the LLM universe — tokenization, embeddings, and 1,024 attention heads. 🛰️";

export function TokenizerViz() {
  const [text, setText] = React.useState(DEFAULT_TEXT);
  const pieces = React.useMemo(() => tokenize(text), [text]);

  const chars = text.length;
  const tokens = pieces.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const ratio = tokens ? chars / tokens : 0;
  // Priced at a representative mid-tier input rate so the number is
  // interpretable; the lesson makes clear that rates vary widely.
  const costPer1k = (tokens / 1_000_000) * 0.3 * 1000;

  return (
    <VizFrame
      label="Tokenizer"
      hint="Type to re-split"
      controls={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setText(DEFAULT_TEXT)}
          disabled={text === DEFAULT_TEXT}
        >
          <RotateCcw className="size-3.5" /> Reset
        </Button>
      }
      footer="Heuristic splitter for teaching. Real tokenizers use a learned merge table, so exact boundaries differ — the behaviours shown (common words whole, rare words fragmented, emoji expensive) are faithful."
    >
      <label htmlFor="tokenizer-input" className="sr-only">
        Text to tokenize
      </label>
      <textarea
        id="tokenizer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        spellCheck={false}
        className="w-full resize-none rounded-lg border border-border bg-surface-2/50 p-2.5 font-mono text-sm outline-none transition-colors focus:border-action/50"
      />

      <div
        className="mt-3 flex flex-wrap gap-1 rounded-lg border border-border bg-[rgb(var(--surface-2))] p-2.5"
        aria-label={`${tokens} tokens`}
      >
        {pieces.length === 0 && (
          <span className="text-xs text-muted-foreground">
            Nothing to tokenize yet.
          </span>
        )}
        {pieces.map((p, i) => (
          <span
            key={i}
            title={`token ${i + 1}`}
            className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-xs leading-tight",
              // Alternating tint makes boundaries readable at a glance —
              // adjacent tokens are never the same colour.
              i % 2 === 0
                ? "border-action/30 bg-action/10 text-action"
                : "border-accent/30 bg-accent/10 text-accent",
              !p.head && "opacity-70",
            )}
          >
            {p.text.replace(/ /g, "␣").replace(/\n/g, "⏎")}
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <VizStat label="Tokens" value={tokens} accent = "ridge" />
        <VizStat label="Characters" value={chars} />
        <VizStat label="Chars / token" value={ratio ? ratio.toFixed(2) : "—"} />
        <VizStat
          label="Words"
          value={words}
          accent={tokens > words * 1.6 ? "upland" : undefined}
        />
      </div>
      <p className="mt-2 text-2xs text-muted-foreground">
        At $0.30 per million input tokens, sending this {tokens ? "" : "text "}
        1,000 times costs{" "}
        <span className="font-mono text-amber">${costPer1k.toFixed(4)}</span>.
      </p>
    </VizFrame>
  );
}
