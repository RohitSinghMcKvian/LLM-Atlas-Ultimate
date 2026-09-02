"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useMounted } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * The theme toggle.
 *
 * Both icons are always in the DOM, stacked, and CSS cross-fades between them
 * on the `data-dark` attribute. That is what the `<AnimatePresence>` here used
 * to do — and because this sits in the always-mounted Topbar, that one 200ms
 * icon swap was a third of the reason all of framer-motion was parsed on every
 * workspace route. Two composited transforms cost nothing and need no library.
 *
 * Before hydration `data-dark` is absent, so the sun shows — exactly what the
 * `mounted` placeholder key rendered previously, and the same reason: the
 * resolved theme is not knowable on the server.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      data-dark={mounted && isDark ? "" : undefined}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "group relative inline-flex size-9 items-center justify-center rounded-lg border border-border bg-surface-2/60 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      <Sun className="absolute size-[18px] rotate-0 scale-100 opacity-100 transition-[transform,opacity] duration-200 group-data-[dark]:-rotate-45 group-data-[dark]:scale-[0.6] group-data-[dark]:opacity-0 motion-reduce:transition-none" />
      <Moon className="absolute size-[18px] rotate-45 scale-[0.6] opacity-0 transition-[transform,opacity] duration-200 group-data-[dark]:rotate-0 group-data-[dark]:scale-100 group-data-[dark]:opacity-100 motion-reduce:transition-none" />
    </button>
  );
}
