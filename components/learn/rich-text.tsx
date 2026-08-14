"use client";

import * as React from "react";

/**
 * A minimal inline formatter for authored lesson prose.
 *
 * Lesson paragraphs use exactly four things: bold, italic, inline code, and
 * links. Rendering them through `<Markdown>` pulled react-markdown, remark-gfm,
 * remark-math, rehype-highlight, rehype-katex, mermaid and the KaTeX stylesheet
 * into the initial /learn bundle — roughly 280 kB to render `**this**`.
 *
 * Model output still goes through the real markdown renderer, because that is
 * genuinely arbitrary markdown. Authored curriculum text does not need it.
 */

// Order matters: `**` is tried before `*`, so bold never matches as two italics.
const TOKEN =
  /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\[[^\]]+?\]\([^)\s]+?\))|(\*[^*]+?\*)/g;

const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

/** Only http(s) and same-origin paths. Never `javascript:`, even from authored content. */
function safeHref(href: string): string | null {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/") || href.startsWith("#")) return href;
  return null;
}

export function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  // `matchAll` needs the global flag, and a shared regex object would carry
  // `lastIndex` between calls — construct a fresh one per invocation.
  for (const m of text.matchAll(new RegExp(TOKEN.source, "g"))) {
    const token = m[0];
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    last = start + token.length;

    if (token.startsWith("`")) {
      out.push(
        <code
          key={key++}
          className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={key++} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[")) {
      const [, label, href] = LINK.exec(token) ?? [];
      const safe = href ? safeHref(href) : null;
      out.push(
        safe ? (
          <a
            key={key++}
            href={safe}
            className="text-action underline-offset-2 hover:underline"
            {...(safe.startsWith("http")
              ? { target: "_blank", rel: "noreferrer noopener" }
              : {})}
          >
            {label}
          </a>
        ) : (
          <span key={key++}>{label ?? token}</span>
        ),
      );
    } else {
      out.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Multi-paragraph authored text. Blank lines separate paragraphs; a line
 * starting with `- ` or `1. ` becomes a list item, which is as much block
 * structure as the exercise briefs use.
 */
export function RichText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const blocks = React.useMemo(() => splitBlocks(children), [children]);

  return (
    <div className={className}>
      {blocks.map((block, i) =>
        block.kind === "list" ? (
          <ul key={i} className="my-2 space-y-1 pl-1">
            {block.items.map((item, j) => (
              <li key={j} className="flex gap-2">
                <span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-action" />
                <span>{renderInline(item)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="mb-3 last:mb-0">
            {renderInline(block.text)}
          </p>
        ),
      )}
    </div>
  );
}

type TextBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] };

function splitBlocks(source: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const chunk of source.split(/\n{2,}/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const lines = trimmed.split("\n").map((l) => l.trim());
    if (lines.every((l) => /^(?:[-*]|\d+\.)\s+/.test(l))) {
      blocks.push({
        kind: "list",
        items: lines.map((l) => l.replace(/^(?:[-*]|\d+\.)\s+/, "")),
      });
    } else {
      // A single newline inside a paragraph is a soft wrap, not a break.
      blocks.push({ kind: "p", text: lines.join(" ") });
    }
  }
  return blocks;
}
