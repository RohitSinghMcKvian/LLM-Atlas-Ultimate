"use client";

import * as React from "react";
import { Markdown } from "@/components/markdown";
import { splitSlides } from "@/lib/chat/document";

/**
 * How a prose artifact looks on screen.
 *
 * Both modes render through the app's own `<Markdown>`, which is the security
 * decision as much as the visual one: react-markdown escapes raw HTML rather
 * than executing it, so a document written by a model needs no sandbox. It also
 * means the printed PDF and the panel cannot drift — `printRenderedNode` lifts
 * the markup this component produced.
 *
 * The container carries `data-print-root`, which is the seam the print path
 * reads. Everything outside it (slide numbers, the deck's page chrome) is
 * on-screen affordance and stays out of the page.
 */

export function DocumentView({
  code,
  streaming = false,
}: {
  code: string;
  streaming?: boolean;
}) {
  return (
    <div className="mx-auto max-w-[52rem] px-6 py-8 sm:px-10">
      <article data-print-root className="doc">
        <Markdown streaming={streaming}>{code}</Markdown>
      </article>
    </div>
  );
}

export function SlidesView({
  code,
  streaming = false,
}: {
  code: string;
  streaming?: boolean;
}) {
  const slides = React.useMemo(() => splitSlides(code), [code]);

  return (
    <div className="space-y-4 p-4">
      {/* Only the slide sections are inside the print root. The counter below
          each one is a reading aid on screen and would be a stray line on
          paper. */}
      <div data-print-root className="space-y-4">
        {slides.map((s, i) => (
          <section
            key={i}
            className="slide aspect-[16/9] overflow-hidden rounded-xl border border-border bg-surface-2/40 p-6"
          >
            <Markdown streaming={streaming}>{s.body}</Markdown>
          </section>
        ))}
      </div>
      {slides.length > 0 && (
        <p className="text-center text-2xs text-muted-foreground">
          {slides.length} slide{slides.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
