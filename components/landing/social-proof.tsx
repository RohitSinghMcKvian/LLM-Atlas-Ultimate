"use client";

import Link from "next/link";
import { ArrowRight, Boxes, Clock, KeyRound, Route } from "lucide-react";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { CountUp } from "@/components/motion/count-up";

export interface CoverageData {
  /** Every distinct model brand in the live catalog, alphabetical. */
  brands: string[];
  /** Route providers the Atlas Router can reach. */
  providers: string[];
  /** Benchmark suite labels carried on catalog models. */
  benchmarks: string[];
  modelCount: number;
  /** Frontier models that need the visitor's own key. */
  byok: number;
  /** Models with open weights. */
  openWeights: number;
  /** Tracked but not released yet. */
  upcoming: number;
}

/**
 * What is actually in the box.
 *
 * The layout is the original: a four-card stat row above a three-card row. The
 * contents are not. The stat row used to be 2,438 GitHub stars, 312 forks, 86
 * contributors and 147 hub submissions, all hardcoded against a repository this
 * build cannot query, and the three cards below were testimonials attributed to
 * personas that do not exist. A page that opens by promising every benchmark
 * number is sourced and dated cannot then invent its own social proof.
 *
 * Everything here now comes off the same catalog snapshot the rest of the page
 * reads, so the section cannot claim coverage the product does not have.
 *
 * The four figures are deliberately not the four in the Legend strip further up
 * (models / free / brands / benchmark suites) — repeating those a screen apart
 * would read as a bug rather than as emphasis.
 */
export function SocialProof({ coverage }: { coverage: CoverageData }) {
  const stats = [
    { icon: KeyRound, value: coverage.byok, label: "On your key" },
    { icon: Boxes, value: coverage.openWeights, label: "Open weights" },
    { icon: Route, value: coverage.providers.length, label: "Route providers" },
    { icon: Clock, value: coverage.upcoming, label: "Tracked pre-release" },
  ];

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <Reveal className="mb-10 max-w-2xl">
        <p className="font-mono text-2xs uppercase tracking-legend text-action">
          Coverage
        </p>
        <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          What the map <span className="italic">actually</span> covers
        </h2>
        <p className="mt-4 text-pretty text-muted-foreground">
          Every figure on this page is read from the catalog at build time, and
          every benchmark score on a model carries the source and the date it
          was measured. Nothing here is a round number someone liked.
        </p>
      </Reveal>

      <Reveal className="mb-12">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-surface/40 py-6 text-center"
            >
              <s.icon className="mb-1 size-5 text-action" />
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

      {/* `items-start` rather than a stretched row: the brand list is four
          times the length of the other two, and stretching them to match just
          adds dead space to both. */}
      <RevealGroup className="grid items-start gap-4 md:grid-cols-3">
        <RevealItem>
          <Panel
            label={`${coverage.brands.length} brands`}
            note={`${coverage.modelCount} models, one schema`}
            items={coverage.brands}
          />
        </RevealItem>
        <RevealItem>
          <Panel
            label={`${coverage.providers.length} route providers`}
            note="one OpenAI-compatible endpoint"
            items={coverage.providers}
          />
        </RevealItem>
        <RevealItem>
          <Panel
            label={`${coverage.benchmarks.length} benchmark suites`}
            note="each score linked to its source"
            items={coverage.benchmarks}
          />
        </RevealItem>
      </RevealGroup>

      <Reveal className="mt-8">
        <Link
          href="/leaderboard"
          className="group inline-flex items-center gap-2 text-sm font-medium text-action hover:underline"
        >
          Check every number on the leaderboard
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </Reveal>
    </section>
  );
}

function Panel({
  label,
  note,
  items,
}: {
  label: string;
  note: string;
  items: string[];
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface/50 p-5">
      <p className="font-display text-lg font-semibold tracking-tight">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
      <ul className="mt-4 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-2xs text-muted-foreground"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
