"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { List } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * On-this-page contents, with a live position marker.
 *
 * The previous version was a list of anchors with no state, which in a
 * four-thousand-word lesson tells the reader nothing they didn't already know.
 * An IntersectionObserver costs almost nothing and turns the same list into a
 * "you are here".
 */

export interface TocEntry {
  id: string;
  text: string;
}

export function LessonToc({
  entries,
  className,
}: {
  entries: TocEntry[];
  className?: string;
}) {
  const [active, setActive] = React.useState<string | null>(
    entries[0]?.id ?? null,
  );

  React.useEffect(() => {
    if (entries.length === 0) return;

    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          seen.set(r.target.id, r.isIntersecting ? r.intersectionRatio : 0);
        }
        // Pick the topmost heading that is currently on screen. Choosing "most
        // visible" instead makes the marker jump backwards on a long section.
        const visible = entries.filter((e) => (seen.get(e.id) ?? 0) > 0);
        if (visible.length > 0) setActive(visible[0].id);
      },
      {
        // Bias the band toward the upper third of the viewport — the heading a
        // reader considers "current" is the one just above where they're reading.
        rootMargin: "-88px 0px -55% 0px",
        threshold: [0, 1],
      },
    );

    for (const e of entries) {
      const el = document.getElementById(e.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <nav
      aria-label="On this page"
      className={cn(
        "rounded-2xl border border-border bg-surface/50 p-3",
        className,
      )}
    >
      <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        <List className="size-3.5" /> On this page
      </p>

      <ul className="relative space-y-0.5">
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-px bg-border"
        />
        {entries.map((e) => {
          const isActive = active === e.id;
          return (
            <li key={e.id} className="relative">
              {isActive && (
                <motion.span
                  layoutId="toc-marker"
                  aria-hidden
                  className="absolute inset-y-0.5 left-0 w-[2px] rounded-full bg-gradient-to-b from-cyan to-violet"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <a
                href={`#${e.id}`}
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "block rounded px-2.5 py-1 text-xs leading-snug transition-colors",
                  isActive
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {e.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
