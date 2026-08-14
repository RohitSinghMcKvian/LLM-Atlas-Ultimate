import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Github, Terminal } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Docs & Help" };

const SECTIONS = [
  {
    title: "Quickstart",
    body: "Clone the repo, copy .env.example to .env.local, add a provider key, and run npm run dev.",
    icon: Terminal,
  },
  {
    title: "Concepts",
    body: "The shared substrate: one catalog, one cost engine, one memory layer, one Atlas Brain runtime.",
    icon: BookOpen,
  },
  {
    title: "Contributing",
    body: "MIT-licensed. Good-first-issues, ADR log, and a plugin model via Atlas Hub.",
    icon: Github,
  },
];

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <Reveal>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Docs &amp; Help
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          LLM Atlas is fully open-source and self-hostable end-to-end. These
          docs are a placeholder in this build — the full documentation site
          lives in <code className="text-action">apps/docs</code>.
        </p>
      </Reveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {SECTIONS.map((s, i) => (
          <Reveal key={s.title} delay={i * 0.08}>
            <Card interactive className="h-full">
              <CardContent className="pt-6">
                <s.icon className="mb-3 size-5 text-action" />
                <h2 className="font-display text-base font-semibold">
                  {s.title}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
              </CardContent>
            </Card>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.2} className="mt-10">
        <Button asChild variant="link">
          <Link href="/">
            Back to overview <ArrowRight className="size-4" />
          </Link>
        </Button>
      </Reveal>
    </div>
  );
}
