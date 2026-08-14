"use client";

import * as React from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { Check, GitFork, Lock, Plug, Scale, Server } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";

const LINES: { text: string; tone?: "muted" | "ok" | "ridge" }[] = [
  { text: "$ git clone https://github.com/llm-atlas/atlas", tone: "ridge" },
  { text: "$ cp .env.example .env.local   # add a provider key", tone: "muted" },
  { text: "$ docker compose up", tone: "ridge" },
  { text: "✔ postgres        ready", tone: "ok" },
  { text: "✔ redis           ready", tone: "ok" },
  { text: "✔ atlas-api       listening :4000", tone: "ok" },
  { text: "✔ atlas-workers   news · price · bench", tone: "ok" },
  { text: "✔ atlas-brain     sandbox runners online", tone: "ok" },
  { text: "✔ web             http://localhost:3000", tone: "ok" },
  { text: "→ Atlas is live. The whole ecosystem, on your infra.", tone: "ridge" },
];

const POINTS = [
  { icon: Scale, title: "MIT licensed", body: "Code is MIT; course content is open too. No lock-in." },
  { icon: Server, title: "Self-host everything", body: "One docker compose brings up the entire stack — including the agent runtime." },
  { icon: Plug, title: "MCP-native", body: "Tools and data sources speak the Model Context Protocol, first-class." },
  { icon: GitFork, title: "Provider-neutral", body: "Frontier APIs and open weights on equal footing, via Atlas Router." },
];

function Terminal() {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduce = useReducedMotion();
  const [shown, setShown] = React.useState(0);

  React.useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setShown(LINES.length);
      return;
    }
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= LINES.length) clearInterval(t);
    }, 320);
    return () => clearInterval(t);
  }, [inView, reduce]);

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-2xl border border-border bg-code shadow-float"
    >
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
        <span className="size-3 rounded-full bg-danger/70" />
        <span className="size-3 rounded-full bg-amber/70" />
        <span className="size-3 rounded-full bg-success/70" />
        <span className="ml-3 font-mono text-2xs text-muted-foreground">
          atlas — docker compose
        </span>
      </div>
      <div className="min-h-[280px] space-y-1 p-4 font-mono text-sm leading-relaxed">
        {LINES.slice(0, shown).map((l, i) => (
          <div
            key={i}
            className={
              l.tone === "ok"
                ? "text-success"
                : l.tone === "ridge"
                  ? "text-action"
                  : "text-muted-foreground"
            }
          >
            {l.text}
          </div>
        ))}
        {shown < LINES.length && (
          <span className="inline-block h-3.5 w-2 animate-caret-blink bg-action align-middle" />
        )}
      </div>
    </div>
  );
}

export function OpenSource() {
  return (
    <section className="relative border-y border-border bg-surface/30">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <p className="mb-3 text-sm font-medium uppercase tracking-wider text-action">
            Built for the open future
          </p>
          <h2 className="text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Run the entire stack yourself
          </h2>
          <p className="mt-4 text-pretty text-muted-foreground">
            No black boxes, no rented intelligence. Atlas is open-source
            end-to-end — including the agent runtime — and designed to run on
            free-tier infrastructure with local models.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {POINTS.map((p) => (
              <div key={p.title} className="flex gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-surface">
                  <p.icon className="size-4 text-action" />
                </div>
                <div>
                  <p className="text-sm font-medium">{p.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1} y={28}>
          <Terminal />
        </Reveal>
      </div>
    </section>
  );
}
