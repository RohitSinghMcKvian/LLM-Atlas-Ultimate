"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { EASE } from "@/lib/motion";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  return (
    // Opacity-only, and short. The previous 300ms y-translate animated the
    // whole page subtree underneath the sidebar's and topbar's backdrop-blur
    // layers, forcing the compositor to re-rasterize both blurs every frame
    // after every navigation — the single largest contributor to navigation
    // feeling sluggish. Fading is composited and costs nothing.
    <motion.div
      key={pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.18, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
