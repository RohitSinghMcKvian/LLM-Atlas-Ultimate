import Link from "next/link";
import { AppLink } from "@/components/nav/app-link";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { ModuleGlyph } from "@/components/brand/glyph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/reveal";
import { getModule, MODULES } from "@/lib/modules";

const FEATURES: Record<string, string[]> = {
  code: [
    "Browser IDE — Monaco editor, file tree, integrated terminal",
    "Atlas Brain live trace: plan → sub-agents → verify → diff",
    "Closed-loop verification against tests/linters in a sandbox",
    "Persistent project memory across sessions",
  ],
  flow: [
    "Drag-and-drop nodes: agents, tools, conditions, loops",
    "Compiles to a runnable Atlas Brain graph",
    "Parallel branches + human-in-the-loop gates",
    "Export/import as portable declarative definitions",
  ],
  playground: [
    "Run one prompt across many models side-by-side",
    "Tweak temperature, top-p, and system prompts live",
    "Diff outputs token-by-token",
    "Save winning prompts to Atlas Prompt",
  ],
  bench: [
    "Bring-your-own reproducible eval sets",
    "Run prompt sets against any catalog model",
    "Full reproducibility metadata (prompt set, judge, seed, date)",
    "Contribute results back to the leaderboard",
  ],
  datasets: [
    "Upload and manage corpora & knowledge bases",
    "Chunk, embed, and index for RAG",
    "Feeds memory across Chat, Compare, and Code",
    "Versioned, workspace-scoped storage",
  ],
  notebooks: [
    "Long-form research documents",
    "Embed live model runs and citations inline",
    "Save Compare results directly into a notebook",
    "Shareable, exportable research artifacts",
  ],
  news: [
    "Hourly-syncing, de-duplicated AI news feed",
    "Neutral 2–3 sentence summaries, fully attributed",
    "'What changed' model-diff cards (new / price / deprecation)",
    "Deep-links to affected models in the Leaderboard",
  ],
  router: [
    "One OpenAI-compatible API across many providers + local",
    "Cost-aware routing: cheapest model meeting constraints",
    "Automatic fallback, retries, and response caching",
    "Shares the pricing table that powers Atlas Cost",
  ],
  learn: [
    "Beginner → expert curriculum, model-connected",
    "Inline 'Run this live' playground from any lesson",
    "Auto-graded exercises via an Atlas Brain rubric agent",
    "Shareable Atlas Certificate on completion",
  ],
  prompt: [
    "Versioned prompt library with templates & variables",
    "Inline evals and changelogs",
    "Shared across Chat, Code, and Flow",
    "One-click insert into any composer",
  ],
  hub: [
    "Community registry for agents, skills, MCP servers, workflows",
    "One-click install into your workspace",
    "Ratings, usage signal, and verified publishers",
    "Portable, declarative packages",
  ],
  vault: [
    "Encrypted provider keys & tool credentials",
    "Per-workspace scoping; never exposed to the client",
    "Injected at call time by Atlas Router",
    "Full audit trail of secret usage",
  ],
};

export function ModulePlaceholder({ id }: { id: string }) {
  const mod = getModule(id);
  if (!mod) return null;
  const features = FEATURES[id] ?? [];
  const flagships = MODULES.filter((m) => m.flagship);

  return (
    <div className="relative mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
      <div className="bg-graticule pointer-events-none absolute inset-x-0 top-0 h-72" />
      <Reveal className="relative flex flex-col items-center text-center">
        <div className="relative mb-6">
          <div className="absolute -inset-6 rounded-full bg-action opacity-20 blur-2xl" />
          <div className="relative grid size-24 place-items-center rounded-3xl border border-border bg-surface shadow-glow">
            <ModuleGlyph seed={mod.id} accent={mod.accent} size={64} animated />
          </div>
        </div>
        <Badge variant="amber" className="mb-4">
          <Sparkles className="size-3" /> In active development
        </Badge>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {mod.name}
        </h1>
        <p className="mt-3 max-w-xl text-pretty text-muted-foreground">
          {mod.description}
        </p>
      </Reveal>

      {features.length > 0 && (
        <Reveal
          delay={0.1}
          className="relative mx-auto mt-12 max-w-2xl rounded-2xl border border-border bg-surface/60 p-6 shadow-glow sm:p-8"
        >
          <p className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            What&apos;s planned
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-action/10">
                  <Check className="size-3 text-action" />
                </span>
                <span className="text-pretty">{f}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      )}

      <Reveal delay={0.15} className="relative mt-12 text-center">
        <p className="mb-4 text-sm text-muted-foreground">
          While {mod.label} is being built, explore what&apos;s live today:
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {flagships.map((f) => (
            <Button key={f.id} asChild variant="secondary">
              <AppLink href={f.href}>
                <f.icon className="size-4" />
                {f.name}
              </AppLink>
            </Button>
          ))}
        </div>
        <div className="mt-8">
          <Button asChild variant="link">
            <Link href="/">
              Back to overview <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </Reveal>
    </div>
  );
}
