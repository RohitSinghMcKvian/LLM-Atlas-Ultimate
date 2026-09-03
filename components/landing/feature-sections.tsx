"use client";

import Link from "next/link";
import { AppLink } from "@/components/nav/app-link";
import { ArrowRight, Check } from "lucide-react";
import {
  PreviewCompare,
  PreviewBrainTrace,
  PreviewLeaderboard,
  PreviewCost,
} from "@/components/landing/previews";
import { Reveal } from "@/components/motion/reveal";
import { cn } from "@/lib/utils";

interface Feature {
  eyebrow: string;
  title: string;
  desc: string;
  bullets: string[];
  href: string;
  cta: string;
  preview: React.ReactNode;
}

const FEATURES: Feature[] = [
  {
    eyebrow: "Atlas Compare",
    title: "One question. Every model. In parallel.",
    desc: "Fan a query out to as many models as you want, watch them stream side-by-side, then read a single synthesized answer with agreements and divergences surfaced.",
    bullets: [
      "Parallel streaming across providers",
      "Synthesis with agreements & divergences",
      "Cost preview before you run",
    ],
    href: "/compare",
    cta: "Open Compare",
    preview: <PreviewCompare />,
  },
  {
    eyebrow: "Atlas Code · Atlas Brain",
    title: "Autonomous work you can actually trust",
    desc: "The Atlas Brain plans, spawns sub-agents in parallel lanes, runs them in a sandbox, and gates every change on closed-loop verification before showing you a diff.",
    bullets: [
      "Plan → sub-agents → verify → diff",
      "Parallel sub-agent lanes",
      "Closed-loop verification in a sandbox",
    ],
    href: "/code",
    cta: "See Atlas Code",
    preview: <PreviewBrainTrace />,
  },
  {
    eyebrow: "Atlas Leaderboard",
    title: "Better than a price list",
    desc: "The most complete catalog of LLMs — capabilities, benchmarks, and pricing merged into one open, self-hostable surface. Filter and sort, and rows re-rank instantly.",
    bullets: [
      "Faceted filters with FLIP re-ranking",
      "Every benchmark attributed & dated",
      "Existing and upcoming models",
    ],
    href: "/leaderboard",
    cta: "Open the Leaderboard",
    preview: <PreviewLeaderboard />,
  },
  {
    eyebrow: "Atlas Cost",
    title: "Procurement-grade clarity, live",
    desc: "Model your real workload across frontier APIs and open self-hosting. Drag an input and the cost-vs-capability frontier recomputes in real time.",
    bullets: [
      "Self-host TCO & break-even analysis",
      "Cost-vs-capability frontier chart",
      "Export a report for procurement",
    ],
    href: "/cost",
    cta: "Open Cost",
    preview: <PreviewCost />,
  },
];

export function FeatureSections() {
  return (
    <section className="mx-auto max-w-6xl space-y-24 px-4 py-20 sm:px-6 sm:py-28 lg:space-y-36">
      {FEATURES.map((f, i) => {
        const reverse = i % 2 === 1;
        return (
          <div
            key={f.title}
            className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16"
          >
            <Reveal className={cn(reverse && "lg:order-2")}>
              <p className="mb-3 text-sm font-medium uppercase tracking-wider text-action">
                {f.eyebrow}
              </p>
              <h3 className="text-balance font-display text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
                {f.title}
              </h3>
              <p className="mt-4 text-pretty text-muted-foreground">{f.desc}</p>
              <ul className="mt-6 space-y-2.5">
                {f.bullets.map((b) => (
                  <li key={b} className="flex items-center gap-2.5 text-sm">
                    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-action/10">
                      <Check className="size-3 text-action" />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              <AppLink
                href={f.href}
                className="group mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-action"
              >
                {f.cta}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </AppLink>
            </Reveal>

            <Reveal
              delay={0.1}
              y={28}
              className={cn("relative", reverse && "lg:order-1")}
            >
              <div className="absolute -inset-4 -z-10 rounded-3xl bg-action opacity-10 blur-2xl" />
              {f.preview}
            </Reveal>
          </div>
        );
      })}
    </section>
  );
}
