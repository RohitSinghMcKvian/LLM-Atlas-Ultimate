"use client";

import * as React from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CountUpProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  /** Format with thousands separators. */
  separator?: boolean;
}

/** Counts up from 0 to `value` when scrolled into view. */
export function CountUp({
  value,
  duration = 1.6,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
  separator = true,
}: CountUpProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = React.useState(0);

  React.useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      // easeOutExpo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduce]);

  const formatted = React.useMemo(() => {
    const n = display.toFixed(decimals);
    if (!separator) return n;
    const [int, dec] = n.split(".");
    const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return dec ? `${withSep}.${dec}` : withSep;
  }, [display, decimals, separator]);

  return (
    <span ref={ref} className={cn("tnum tabular-nums", className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
