"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Sparkles, ChevronDown, Trophy } from "lucide-react";
import { Constellation } from "@/components/landing/constellation";
import { Magnetic } from "@/components/motion/magnetic";
import { Button } from "@/components/ui/button";
import { EASE } from "@/lib/motion";

// Fallback only. The real names come from the live snapshot via the server
// component, so the constellation never advertises a model that was delisted.
const LABELS = [
  "Claude Opus 4.8",
  "GPT-5.5",
  "Gemini 3.1 Pro",
  "DeepSeek V4 Pro",
  "Llama 4 Maverick",
  "Nemotron 3 Ultra",
  "Qwen3 Max",
  "Grok 4.3",
  "GLM-5.1",
  "Kimi K2.7",
];

const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

export function Hero({ labels }: { labels?: string[] } = {}) {
  const sectionRef = React.useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  // `Constellation` re-seeds its layout when `labels` changes identity, so the
  // array must be stable for the life of the document.
  const names = React.useMemo(() => labels ?? LABELS, [labels]);

  // The field recedes as the page scrolls, so the hero reads as depth rather
  // than a backdrop that slides along with the copy.
  //
  // Measured against `scrollY` rather than `useScroll({ target })`: the latter
  // walks the offsetParent chain and warns because `<body>` is statically
  // positioned, which is not something a section should be reaching up to fix.
  const [span, setSpan] = React.useState<[number, number]>([0, 1]);
  React.useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setSpan([top, top + Math.max(1, el.offsetHeight)]);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const { scrollY } = useScroll();
  const fieldOpacity = useTransform(scrollY, span, [1, 0.25]);
  const fieldScale = useTransform(scrollY, span, [1, 1.06]);
  const fieldY = useTransform(scrollY, span, [0, 60]);

  return (
    <section ref={sectionRef} className="relative isolate overflow-hidden">
      {/* Backdrops. The aurora wash that used to sit under the graticule is
          gone with the rest of the brand gradients — the survey grid and the
          field itself carry the backdrop now. */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-graticule opacity-50" />
      <motion.div
        className="pointer-events-none absolute inset-0 -z-10"
        style={reduce ? undefined : { opacity: fieldOpacity, scale: fieldScale, y: fieldY }}
      >
        <Constellation labels={names} className="size-full" />
      </motion.div>
      {/* fade to page bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-background" />

      <div className="mx-auto flex min-h-[100svh] max-w-5xl flex-col items-center justify-center px-4 pb-24 pt-28 text-center sm:min-h-[92vh] sm:px-6 sm:pt-32">
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.09 } } }}
        >
          <motion.div variants={item} className="mb-6 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-action opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-action" />
              </span>
              Open-source · MIT · self-hostable end-to-end
            </span>
          </motion.div>

          {/* The two emphasised words used to carry the cyan→violet gradient.
              Terrain spends its one hue on actions, so the emphasis is
              typographic — Fraunces italic. */}
          <motion.h1
            variants={item}
            className="text-balance font-display text-[2.35rem] font-semibold leading-[1.02] tracking-tightest min-[420px]:text-[2.6rem] sm:text-6xl lg:text-7xl"
          >
            The entire LLM universe,
            <br className="hidden sm:block" /> <span className="italic">mapped</span> and{" "}
            <span className="italic">navigable</span>.
          </motion.h1>

          <motion.p
            variants={item}
            className="mx-auto mt-6 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg"
          >
            Learn, research, compare, cost, and build — every model and the
            agents that use them, in one open workspace you can run yourself.
          </motion.p>

          <motion.div
            variants={item}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Magnetic className="w-full max-w-[22rem] sm:w-auto sm:max-w-none">
              <Button
                asChild
                variant="primary"
                size="xl"
                className="group w-full sm:w-auto"
              >
                <Link href="/chat">
                  <Sparkles className="size-4" />
                  Launch Workspace
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
            </Magnetic>
            <Button
              asChild
              variant="glass"
              size="xl"
              className="w-full max-w-[22rem] sm:w-auto sm:max-w-none"
            >
              <Link href="/leaderboard">
                <Trophy className="size-4" />
                Explore the Leaderboard
              </Link>
            </Button>
          </motion.div>
        </motion.div>
      </div>

      {/* Scroll cue — hidden on short phone viewports where it crowds the CTAs */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="absolute inset-x-0 bottom-7 hidden justify-center sm:flex"
      >
        {/* The bob is a framer-motion loop, so the blanket
            prefers-reduced-motion rule in globals.css does not reach it — it
            only zeroes CSS animations. Gated explicitly instead. */}
        <motion.div
          animate={reduce ? undefined : { y: [0, 8, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          className="flex flex-col items-center gap-1 text-xs text-muted-foreground"
        >
          Scroll to explore
          <ChevronDown className="size-4" />
        </motion.div>
      </motion.div>
    </section>
  );
}
