"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Constellation } from "@/components/landing/constellation";
import { Magnetic } from "@/components/motion/magnetic";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/reveal";

export function ClosingCTA() {
  return (
    <section className="relative isolate overflow-hidden border-t border-border">
      {/* Mirrors the hero at lower intensity. The aurora wash that sat behind
          the field is gone with the rest of the brand gradients. */}
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-70">
        <Constellation variant="ambient" density={0.8} className="size-full" />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-28 text-center sm:px-6 sm:py-36">
        <Reveal>
          <h2 className="text-balance font-display text-4xl font-semibold tracking-tightest sm:text-6xl">
            The whole LLM universe,
            <br />
            <span className="italic">one workspace away.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-muted-foreground">
            Open-source, self-hostable, provider-neutral. Start mapping yours.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Magnetic strength={18}>
              <Button asChild variant="primary" size="xl" className="group">
                <Link href="/chat">
                  Open LLM Atlas
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
            </Magnetic>
            <Button asChild variant="glass" size="xl">
              <Link href="/leaderboard">Browse the catalog</Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
