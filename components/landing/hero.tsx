"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
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
  // `Constellation` re-seeds its layout when `labels` changes identity, so the
  // array must be stable for the life of the document.
  const names = React.useMemo(() => labels ?? LABELS, [labels]);
  return (
    <section className="relative isolate overflow-hidden">
      {/* Backdrops */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-aurora" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid-fade opacity-60" />
      <div className="absolute inset-0 -z-10">
        <Constellation labels={names} className="size-full" />
      </div>
      {/* fade to page bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-background" />

      <div className="mx-auto flex min-h-[92vh] max-w-5xl flex-col items-center justify-center px-4 pb-24 pt-32 text-center sm:px-6">
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.09 } } }}
        >
          <motion.div variants={item} className="mb-6 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-cyan" />
              </span>
              Open-source · MIT · self-hostable end-to-end
            </span>
          </motion.div>

          <motion.h1
            variants={item}
            className="text-balance font-display text-[2.6rem] font-semibold leading-[1.02] tracking-tightest sm:text-6xl lg:text-7xl"
          >
            The entire LLM universe,
            <br className="hidden sm:block" /> <span className="text-gradient">mapped</span> and{" "}
            <span className="text-gradient">navigable</span>.
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
            <Magnetic>
              <Button asChild variant="primary" size="xl" className="group">
                <Link href="/chat">
                  <Sparkles className="size-4" />
                  Launch Workspace
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
            </Magnetic>
            <Button asChild variant="glass" size="xl">
              <Link href="/leaderboard">
                <Trophy className="size-4" />
                Explore the Leaderboard
              </Link>
            </Button>
          </motion.div>
        </motion.div>
      </div>

      {/* Scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="absolute inset-x-0 bottom-7 flex justify-center"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
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
