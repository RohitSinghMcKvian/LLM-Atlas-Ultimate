"use client";

import { Star, GitFork, Users, Boxes } from "lucide-react";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { CountUp } from "@/components/motion/count-up";

const STATS = [
  { icon: Star, value: 2438, label: "GitHub stars" },
  { icon: GitFork, value: 312, label: "Forks" },
  { icon: Users, value: 86, label: "Contributors" },
  { icon: Boxes, value: 147, label: "Hub submissions" },
];

const QUOTES = [
  {
    quote:
      "We replaced three subscriptions with one self-hosted Atlas. The cost calculator alone paid for the migration.",
    name: "Platform Lead",
    org: "Series-B fintech",
  },
  {
    quote:
      "Compare is how my team now does model selection. Seeing six answers and a synthesis side-by-side is a superpower.",
    name: "Staff ML Engineer",
    org: "Enterprise SaaS",
  },
  {
    quote:
      "The leaderboard is the first one I actually trust — every number links to its source and date.",
    name: "AI Architect",
    org: "Public sector",
  },
];

export function SocialProof() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <Reveal className="mb-12">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-surface/40 py-6 text-center"
            >
              <s.icon className="mb-1 size-5 text-cyan" />
              <div className="font-mono text-2xl font-semibold">
                <CountUp value={s.value} />
              </div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </Reveal>

      <RevealGroup className="grid gap-4 md:grid-cols-3">
        {QUOTES.map((q) => (
          <RevealItem key={q.name}>
            <figure className="flex h-full flex-col rounded-2xl border border-border bg-surface/50 p-6">
              <div className="mb-3 flex gap-0.5 text-amber">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="size-3.5 fill-current" />
                ))}
              </div>
              <blockquote className="flex-1 text-pretty text-sm text-foreground/90">
                “{q.quote}”
              </blockquote>
              <figcaption className="mt-4 text-xs">
                <span className="font-medium">{q.name}</span>
                <span className="text-muted-foreground"> · {q.org}</span>
              </figcaption>
            </figure>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  );
}
