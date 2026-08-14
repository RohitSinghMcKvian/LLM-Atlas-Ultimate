"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * A disclosure that opens on height.
 *
 * Local rather than `@radix-ui/react-collapsible` for the same reason the rest of
 * this repo builds small primitives: the surface needed is one animated height,
 * the app already carries framer-motion, and this way the reduced-motion path is
 * the same one every other animated component here uses rather than a second
 * mechanism to keep in step.
 *
 * Under `prefers-reduced-motion` it opens and closes instantly — no height
 * animation, no fade — because a height transition is exactly the kind of motion
 * that setting exists to stop.
 */
export function Collapsible({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduced ? { height: 0, opacity: 0 } : { height: 0, opacity: 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.22, ease: EASE }}
          className={cn("overflow-hidden", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
