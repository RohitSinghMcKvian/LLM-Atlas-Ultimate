"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { relativeTime, sourceAccent } from "@/lib/news/format";
import type { NewsArticle } from "@/lib/news/types";
import { cn } from "@/lib/utils";

// The ticker of newest headlines across the top of the page.
//
// Three things this has to get right, and each one is a place these usually go
// wrong:
//
//   • It must pause on hover AND on focus. A marquee that keeps moving while a
//     keyboard user is trying to read an item is unusable, and focus is the only
//     signal that a keyboard user is there.
//   • It must be genuinely off under `prefers-reduced-motion`, not merely
//     slower. Framer's `useReducedMotion` is required here — the global CSS
//     `prefers-reduced-motion` block cannot reach a JS-driven animation.
//   • Every pill is a real button. A ticker of unclickable headlines is a
//     decoration pretending to be navigation.

export function NewsLiveWire({
  articles,
  mounted,
  onOpen,
  className,
}: {
  articles: NewsArticle[];
  mounted?: boolean;
  onOpen: (article: NewsArticle) => void;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = React.useState(false);

  if (!articles.length) return null;

  // Duration scaled to content so the speed feels constant regardless of how
  // many headlines are in the wire.
  const duration = Math.max(24, articles.length * 4.5);

  const pills = articles.map((article, index) => (
    <button
      key={`${article.id}-${index}`}
      type="button"
      onClick={() => onOpen(article)}
      className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-border/70 bg-surface-2/70 px-3 py-1.5 text-xs backdrop-blur-sm transition-colors hover:border-border-strong hover:bg-surface-3"
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: sourceAccent(article.sourceId) }}
        aria-hidden="true"
      />
      <span className="max-w-[22rem] truncate text-muted-foreground group-hover:text-foreground">
        {article.title}
      </span>
      {mounted && (
        <span className="shrink-0 text-2xs text-muted-foreground/70">
          {relativeTime(article.publishedAt)}
        </span>
      )}
    </button>
  ));

  // Reduced motion: a static, scrollable row. Same content, same affordances,
  // no movement.
  if (reducedMotion) {
    return (
      <div className={cn("mask-fade-r overflow-x-auto", className)}>
        <div className="flex gap-2 pb-1" aria-label="Latest headlines">
          {pills}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("mask-fade-r relative overflow-hidden", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Two identical tracks translated as one, so the loop has no visible seam.
          The duplicate is hidden from assistive tech — the headlines are
          announced once. */}
      <motion.div
        className="flex w-max gap-2"
        animate={paused ? { x: undefined } : { x: ["0%", "-50%"] }}
        transition={{ duration, ease: "linear", repeat: Infinity, repeatType: "loop" }}
        style={{ animationPlayState: paused ? "paused" : "running" }}
      >
        <div className="flex gap-2" aria-label="Latest headlines">
          {pills}
        </div>
        <div className="flex gap-2" aria-hidden="true">
          {pills}
        </div>
      </motion.div>
    </div>
  );
}
