"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MousePointerClick } from "lucide-react";
import { RichText } from "./rich-text";
import { cn } from "@/lib/utils";

/**
 * A prompt or output that explains its own parts.
 *
 * Showing a good prompt teaches almost nothing — the reader sees a wall of
 * competent text and has no idea which sentence is load-bearing. Highlighting
 * the parts and making them answer for themselves turns the same artefact into
 * a dissection.
 */

interface Note {
  match: string;
  label: string;
  text: string;
}

type Segment =
  | { kind: "text"; text: string }
  | { kind: "note"; text: string; index: number };

/**
 * Split the text around each note's `match`.
 *
 * Matches are located longest-first so a note on "return JSON" isn't stolen by
 * a note on "JSON", and each match is consumed once — a repeated phrase
 * annotates its first occurrence rather than every one, which is what an author
 * writing `match: "```"` would otherwise get.
 */
function segment(text: string, notes: Note[]): Segment[] {
  const spans: { start: number; end: number; index: number }[] = [];
  const order = notes
    .map((n, index) => ({ n, index }))
    .sort((a, b) => b.n.match.length - a.n.match.length);

  for (const { n, index } of order) {
    let from = 0;
    // Skip forward past any span already claimed by a longer match.
    for (;;) {
      const at = text.indexOf(n.match, from);
      if (at === -1) break;
      const end = at + n.match.length;
      const clash = spans.some((s) => at < s.end && end > s.start);
      if (!clash) {
        spans.push({ start: at, end, index });
        break;
      }
      from = at + 1;
    }
  }

  spans.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, s.start) });
    }
    out.push({
      kind: "note",
      text: text.slice(s.start, s.end),
      index: s.index,
    });
    cursor = s.end;
  }
  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
  return out;
}

export function AnnotatedBlock({
  text,
  notes,
  lang,
}: {
  text: string;
  notes: Note[];
  lang?: string;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  const segments = React.useMemo(() => segment(text, notes), [text, notes]);
  const found = React.useMemo(
    () => new Set(segments.filter((s) => s.kind === "note").map((s) => s.index)),
    [segments],
  );

  return (
    <div className="not-prose overflow-hidden rounded-2xl border border-action/25 bg-surface/50 shadow-glow">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-action/10 px-3.5 py-2.5">
        <MousePointerClick className="size-3.5 text-action" aria-hidden />
        <span className="text-xs font-semibold">Pick it apart</span>
        {lang && (
          <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
            {lang}
          </span>
        )}
        <span className="ml-auto text-2xs text-muted-foreground">
          {notes.length} annotation{notes.length === 1 ? "" : "s"}
        </span>
      </div>

      <pre className="overflow-x-auto whitespace-pre-wrap break-words p-3.5 font-mono text-xs leading-[1.7] text-foreground/85">
        <code>
          {segments.map((seg, i) =>
            seg.kind === "text" ? (
              <span key={i}>{seg.text}</span>
            ) : (
              <button
                key={i}
                onClick={() =>
                  setActive((cur) => (cur === seg.index ? null : seg.index))
                }
                aria-pressed={active === seg.index}
                aria-label={`Explain: ${notes[seg.index].label}`}
                className={cn(
                  "-mx-0.5 rounded px-0.5 text-left underline decoration-dotted decoration-1 underline-offset-4 transition-colors",
                  active === seg.index
                    ? "bg-action/25 text-foreground decoration-action"
                    : "bg-action/10 decoration-action/50 hover:bg-action/20",
                )}
              >
                {seg.text}
              </button>
            ),
          )}
        </code>
      </pre>

      <AnimatePresence initial={false} mode="wait">
        {active !== null && notes[active] && (
          <motion.div
            key={active}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-action/25 bg-action/[0.06]"
          >
            <div className="px-3.5 py-3">
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-action">
                {notes[active].label}
              </p>
              <RichText className="text-xs leading-relaxed text-foreground/85">
                {notes[active].text}
              </RichText>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ul className="flex flex-wrap gap-1.5 border-t border-border bg-surface-2/30 px-3.5 py-2">
        {notes.map((n, i) => (
          <li key={n.label}>
            <button
              onClick={() => setActive((cur) => (cur === i ? null : i))}
              disabled={!found.has(i)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-2xs transition-colors",
                active === i
                  ? "border-action/50 bg-action/15 font-semibold text-action"
                  : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                !found.has(i) && "opacity-40",
              )}
            >
              {n.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
