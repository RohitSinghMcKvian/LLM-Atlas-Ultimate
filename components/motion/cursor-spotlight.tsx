"use client";

import * as React from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

interface CursorSpotlightProps {
  className?: string;
  /** Diameter of the glow, in px. */
  size?: number;
  /** Peak tint strength, 0–1. */
  intensity?: number;
}

const SPRING = { stiffness: 140, damping: 22, mass: 0.6 };

/**
 * A brand-tinted glow that trails the cursor across its parent section, lit
 * over the constellation canvas so the mesh warms where you point.
 *
 * Fills its parent, so drop it into any `relative` container *after* the canvas
 * layer — the blend mode composites against whatever is painted beneath it.
 * Transform-only, so it stays on the compositor and costs nothing per frame.
 * Sits out entirely for reduced motion and coarse pointers.
 */
export function CursorSpotlight({
  className,
  size = 520,
  intensity = 0.16,
}: CursorSpotlightProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [enabled, setEnabled] = React.useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useMotionValue(0);
  const sx = useSpring(x, SPRING);
  const sy = useSpring(y, SPRING);
  const so = useSpring(opacity, { stiffness: 120, damping: 26 });

  React.useEffect(() => {
    if (reduce) return;
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    const parent = hostRef.current?.parentElement;
    if (!parent) return;

    setEnabled(true);

    let primed = false;
    const onMove = (e: PointerEvent) => {
      const rect = parent.getBoundingClientRect();
      const nx = e.clientX - rect.left;
      const ny = e.clientY - rect.top;
      if (!primed) {
        // Appear where the cursor already is instead of flying in.
        x.jump(nx);
        y.jump(ny);
        primed = true;
      }
      x.set(nx);
      y.set(ny);
      opacity.set(1);
    };
    const onLeave = () => {
      opacity.set(0);
      primed = false;
    };

    parent.addEventListener("pointermove", onMove, { passive: true });
    parent.addEventListener("pointerleave", onLeave);
    return () => {
      parent.removeEventListener("pointermove", onMove);
      parent.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce, x, y, opacity]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      {enabled ? (
        <motion.div
          style={{
            x: sx,
            y: sy,
            opacity: so,
            width: size,
            height: size,
            marginLeft: -size / 2,
            marginTop: -size / 2,
            willChange: "transform, opacity",
            background: `radial-gradient(circle, rgb(var(--elev-1) / ${intensity}) 0%, rgb(var(--elev-0) / ${
              intensity * 0.6
            }) 38%, transparent 70%)`,
          }}
          // Lighten over the dark field; on light surfaces the same tint has to
          // darken instead, or it reads as a smudge of white.
          className="absolute left-0 top-0 rounded-full mix-blend-multiply dark:mix-blend-plus-lighter"
        />
      ) : null}
    </div>
  );
}
