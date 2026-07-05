"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useMounted } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative inline-flex size-9 items-center justify-center rounded-lg border border-border bg-surface-2/60 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={mounted ? (isDark ? "moon" : "sun") : "placeholder"}
          initial={{ opacity: 0, rotate: -45, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 45, scale: 0.6 }}
          transition={{ duration: 0.2 }}
          className="absolute inline-flex"
        >
          {!mounted ? (
            <Sun className="size-[18px]" />
          ) : isDark ? (
            <Moon className="size-[18px]" />
          ) : (
            <Sun className="size-[18px]" />
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
