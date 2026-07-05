"use client";

import * as React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface RevealProps extends Omit<HTMLMotionProps<"div">, "ref"> {
  delay?: number;
  y?: number;
  once?: boolean;
  as?: "div" | "section" | "li" | "article";
}

/** Fades + rises into view on scroll. Honors reduced-motion. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
  once = true,
  ...props
}: RevealProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once, margin: "-80px" }}
      transition={{ duration: 0.6, ease: EASE, delay }}
      className={cn(className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Staggered container — children should use RevealItem. */
export function RevealGroup({
  children,
  className,
  stagger = 0.07,
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  once?: boolean;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: "-60px" }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger } },
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
  y = 18,
}: {
  children: React.ReactNode;
  className?: string;
  y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      variants={{
        hidden: reduce ? { opacity: 0 } : { opacity: 0, y },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.55, ease: EASE },
        },
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}
