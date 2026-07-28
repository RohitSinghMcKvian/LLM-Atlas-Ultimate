"use client";

import * as React from "react";
import { AlertTriangle, CircleCheck } from "lucide-react";
import { VizFrame, VizSlider, VizStat, VizToggle } from "./frame";
import { cn } from "@/lib/utils";

/**
 * Chunking, with the failure mode visible.
 *
 * Everything here is computed from the document below at the settings you
 * choose — the split, the retrieval scores, and crucially whether the answer
 * survived. The lesson is the last one: a chunk boundary that lands in the
 * middle of the only sentence that answers the question makes that answer
 * unretrievable, and no amount of embedding-model shopping fixes it.
 */

const DOC = `Orders placed before 2pm are dispatched the same day. Orders placed after 2pm are dispatched the next business day. Standard delivery takes 3-5 business days after dispatch, and express delivery arrives the next business day. Delivery estimates exclude weekends and public holidays. Once an order has been dispatched you will receive a tracking number by email. If tracking has not updated for 48 hours, contact support with your order number. Items may be returned within 30 days of delivery. Approved refunds are returned to the original payment method within 5 business days.`;

/**
 * The sentence that answers the demo query. If a boundary lands inside this
 * span, no single chunk contains the answer.
 */
const ANSWER =
  "Standard delivery takes 3-5 business days after dispatch, and express delivery arrives the next business day.";

const QUERIES = [
  { value: "delivery", label: "Delivery", text: "how long does delivery take" },
  { value: "refund", label: "Refund", text: "when will I get my refund" },
  { value: "tracking", label: "Tracking", text: "my tracking has not updated" },
];

const STOP = new Set([
  "how", "long", "does", "the", "a", "my", "will", "i", "get", "when", "has",
  "not", "is", "to", "of", "and", "in", "it", "for", "your", "you",
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

interface Chunk {
  index: number;
  start: number;
  end: number;
  text: string;
}

/**
 * Fixed-size chunking with overlap, optionally snapped to sentence ends.
 *
 * The naive version is the default because it is what people ship first, and
 * seeing it break the answer sentence is the point of the widget.
 */
function chunk(doc: string, size: number, overlap: number, snap: boolean): Chunk[] {
  const out: Chunk[] = [];
  const step = Math.max(1, size - overlap);
  let start = 0;
  let index = 0;

  while (start < doc.length) {
    let end = Math.min(doc.length, start + size);

    if (snap && end < doc.length) {
      // Walk back to the nearest sentence end inside the window. If there
      // isn't one, fall through to the hard cut rather than emitting a
      // pathologically short chunk.
      const window = doc.slice(start, end);
      const lastStop = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
      );
      if (lastStop > size * 0.4) end = start + lastStop + 1;
    }

    out.push({ index: index++, start, end, text: doc.slice(start, end).trim() });
    if (end >= doc.length) break;
    start = snap ? end : start + step;
    if (snap) start = Math.max(0, start - overlap);
  }

  return out;
}

export function ChunkingViz() {
  const [size, setSize] = React.useState(180);
  const [overlap, setOverlap] = React.useState(0);
  const [snap, setSnap] = React.useState("off");
  const [query, setQuery] = React.useState(QUERIES[0].value);

  const q = QUERIES.find((x) => x.value === query)!;
  const chunks = React.useMemo(
    () => chunk(DOC, size, Math.min(overlap, size - 20), snap === "on"),
    [size, overlap, snap],
  );

  // Retrieval, scored by how many of the query's content words a chunk covers.
  // Crude on purpose: this is what lexical search does, and it is enough to
  // show that a split answer cannot be retrieved whole by anything.
  const scored = React.useMemo(() => {
    const qt = terms(q.text);
    return chunks
      .map((c) => {
        const ct = new Set(terms(c.text));
        const hits = qt.filter((t) => ct.has(t)).length;
        return { chunk: c, score: qt.length ? hits / qt.length : 0, hits };
      })
      .sort((a, b) => b.score - a.score);
  }, [chunks, q.text]);

  const best = scored[0];
  const answerIntact = chunks.some((c) => c.text.includes(ANSWER));
  const answerChunks = chunks.filter(
    (c) => c.text.includes(ANSWER.slice(0, 40)) || c.text.includes(ANSWER.slice(-40)),
  );

  return (
    <VizFrame
      label="Chunking"
      hint="Break the document, then try to retrieve the answer"
      controls={
        <>
          <VizToggle
            ariaLabel="Query"
            value={query}
            onChange={setQuery}
            options={QUERIES.map((x) => ({ value: x.value, label: x.label }))}
          />
          <VizToggle
            ariaLabel="Snap to sentence boundaries"
            value={snap}
            onChange={setSnap}
            options={[
              { value: "off", label: "Hard cut" },
              { value: "on", label: "Snap to sentence" },
            ]}
          />
        </>
      }
      footer="Scores are term overlap between the query and each chunk — the same signal a lexical index uses. The delivery query is the one to watch: at a small chunk size with a hard cut, the sentence that answers it gets sliced in two."
    >
      <p className="mb-3 rounded-lg border border-border bg-surface-2/50 px-2.5 py-1.5 font-mono text-xs">
        <span className="text-muted-foreground">query:</span> {q.text}
      </p>

      <div className="mb-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <VizSlider
          label="Chunk size"
          value={size}
          onChange={setSize}
          min={80}
          max={520}
          step={20}
          format={(v) => `${v} chars`}
        />
        <VizSlider
          label="Overlap"
          value={overlap}
          onChange={setOverlap}
          min={0}
          max={160}
          step={10}
          format={(v) => `${v} chars`}
          accent="amber"
        />
      </div>

      {/* The document, with chunk boundaries drawn in. */}
      <div className="rounded-xl border border-border bg-surface-2/30 p-3">
        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {chunks.length} chunks
        </p>
        <p className="font-mono text-[11.5px] leading-[1.9]">
          {chunks.map((c, i) => (
            <span
              key={c.index}
              className={cn(
                "rounded px-0.5 py-px",
                i % 2 === 0
                  ? "bg-cyan/[0.13] text-foreground"
                  : "bg-violet/[0.15] text-foreground",
              )}
              title={`Chunk ${c.index + 1} · ${c.text.length} chars`}
            >
              {c.text}
              {i < chunks.length - 1 && (
                <span className="mx-0.5 font-bold text-amber" aria-hidden>
                  ⎸
                </span>
              )}
            </span>
          ))}
        </p>
      </div>

      {/* The verdict that makes this worth interacting with. */}
      <div
        className={cn(
          "mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
          answerIntact
            ? "border-success/35 bg-success/[0.07] text-success"
            : "border-danger/35 bg-danger/10 text-danger",
        )}
      >
        {answerIntact ? (
          <CircleCheck className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span className="leading-relaxed">
          {answerIntact ? (
            <>
              The delivery answer survives intact in one chunk. Retrieval has
              something whole to return.
            </>
          ) : (
            <>
              The sentence answering the delivery query is split across{" "}
              {Math.max(2, answerChunks.length)} chunks. No single chunk contains
              the answer, so no retriever can return it — raise the chunk size,
              add overlap, or snap to sentence boundaries.
            </>
          )}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <VizStat label="Chunks" value={chunks.length} accent="cyan" />
        <VizStat
          label="Avg size"
          value={`${Math.round(
            chunks.reduce((n, c) => n + c.text.length, 0) / chunks.length,
          )}`}
        />
        <VizStat
          label="Top score"
          value={best ? best.score.toFixed(2) : "—"}
          accent="amber"
        />
        <VizStat
          label="Answer intact"
          value={answerIntact ? "yes" : "no"}
          accent={answerIntact ? "success" : "danger"}
        />
      </div>

      {/* What retrieval would actually return. */}
      <ol className="mt-3 space-y-1.5">
        {scored.slice(0, 3).map((row, i) => (
          <li
            key={row.chunk.index}
            className={cn(
              "rounded-lg border px-2.5 py-1.5",
              i === 0
                ? "border-cyan/40 bg-cyan/[0.06]"
                : "border-border bg-surface-2/40",
            )}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xs text-cyan">
                chunk {row.chunk.index + 1}
              </span>
              <span className="ml-auto shrink-0 font-mono text-2xs tnum text-amber">
                {row.score.toFixed(2)}
              </span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-foreground/80">
              {row.chunk.text}
            </p>
          </li>
        ))}
      </ol>
    </VizFrame>
  );
}
