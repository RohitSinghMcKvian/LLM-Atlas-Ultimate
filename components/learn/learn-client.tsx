"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  GraduationCap,
  Play,
  Square,
  Check,
  Clock,
  CircleDot,
  Lock,
  PartyPopper,
  Award,
  ChevronRight,
  Sparkles,
  X,
} from "lucide-react";
import { AtlasMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/markdown";
import { ProviderBanner } from "@/components/provider-banner";
import {
  TRACKS,
  TOTAL_LESSONS,
  ACTIVE_LESSON,
  type Block,
} from "@/lib/learn/curriculum";
import { getModelById } from "@/lib/catalog";
import { useUIStore } from "@/lib/store/ui-store";
import { useKeysStore } from "@/lib/store/keys-store";
import { useProviders } from "@/lib/hooks/use-providers";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

export function LearnClient() {
  const [completed, setCompleted] = React.useState<Set<string>>(new Set());
  const [view, setView] = React.useState<"lesson" | "path">("lesson");
  const [celebrate, setCelebrate] = React.useState(false);

  const progress = Math.round((completed.size / TOTAL_LESSONS) * 100);
  const isDone = completed.has(ACTIVE_LESSON.lessonId);

  function complete() {
    if (isDone) return;
    setCompleted((s) => new Set(s).add(ACTIVE_LESSON.lessonId));
    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 2200);
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Learn
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Beginner to expert, hands-on — every lesson connects to a live model.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-xl border border-border bg-surface-2/60 p-0.5 text-sm">
            <button
              onClick={() => setView("lesson")}
              className={cn(
                "rounded-lg px-3 py-1.5 font-medium",
                view === "lesson" ? "bg-surface shadow-sm" : "text-muted-foreground",
              )}
            >
              Lesson
            </button>
            <button
              onClick={() => setView("path")}
              className={cn(
                "rounded-lg px-3 py-1.5 font-medium",
                view === "path" ? "bg-surface shadow-sm" : "text-muted-foreground",
              )}
            >
              Path
            </button>
          </div>
          <CertificateDialog progress={progress} />
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className="h-full rounded-full bg-gradient-primary"
            animate={{ width: `${progress}%` }}
            transition={{ type: "spring", stiffness: 200, damping: 30 }}
          />
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {completed.size} / {TOTAL_LESSONS} · {progress}%
        </span>
      </div>

      {view === "path" ? (
        <PathMap completed={completed} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <TrackSidebar completed={completed} />
          <LessonView
            isDone={isDone}
            onComplete={complete}
            celebrate={celebrate}
          />
        </div>
      )}
    </div>
  );
}

function TrackSidebar({ completed }: { completed: Set<string> }) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
      <div className="rounded-2xl border border-border bg-surface/50 p-2">
        {TRACKS.map((track, ti) => {
          const allDone = track.lessons.every((l) => completed.has(l.id));
          return (
            <div key={track.id} className="mb-1 last:mb-0">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded text-2xs font-semibold",
                    allDone
                      ? "bg-success/15 text-success"
                      : "bg-surface-3 text-muted-foreground",
                  )}
                >
                  {ti + 1}
                </span>
                <span className="text-xs font-semibold">{track.title}</span>
              </div>
              {track.id === "foundations" && (
                <div className="ml-3 border-l border-border pl-2">
                  {track.lessons.map((l) => {
                    const done = completed.has(l.id);
                    const current = l.id === ACTIVE_LESSON.lessonId;
                    return (
                      <div
                        key={l.id}
                        className={cn(
                          "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                          current
                            ? "bg-surface-2 text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {done ? (
                          <Check className="size-3.5 text-success" />
                        ) : current ? (
                          <CircleDot className="size-3.5 text-cyan" />
                        ) : (
                          <Clock className="size-3.5 opacity-50" />
                        )}
                        <span className="truncate">{l.title}</span>
                        <span className="ml-auto text-[10px] opacity-60">
                          {l.minutes}m
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function LessonView({
  isDone,
  onComplete,
  celebrate,
}: {
  isDone: boolean;
  onComplete: () => void;
  celebrate: boolean;
}) {
  return (
    <div className="relative">
      <article className="rounded-2xl border border-border bg-surface/40 p-6 sm:p-8">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <GraduationCap className="size-3.5 text-cyan" /> Foundations
          <span>·</span>
          <Clock className="size-3.5" /> {ACTIVE_LESSON.minutes} min
        </div>
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {ACTIVE_LESSON.title}
        </h2>

        <div className="mt-6 space-y-5">
          {ACTIVE_LESSON.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          <span className="text-sm text-muted-foreground">
            Next: <span className="text-foreground">Embeddings & vector space</span>
          </span>
          <Button variant={isDone ? "secondary" : "primary"} onClick={onComplete}>
            {isDone ? (
              <>
                <Check className="size-4" /> Completed
              </>
            ) : (
              <>
                Mark complete <ChevronRight className="size-4" />
              </>
            )}
          </Button>
        </div>
      </article>

      <AnimatePresence>
        {celebrate && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="pointer-events-none absolute inset-x-0 -top-2 z-10 flex justify-center"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-popover px-4 py-2 text-sm font-medium shadow-float">
              <PartyPopper className="size-4 text-amber" /> Lesson complete — nice
              work!
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "p":
      return (
        <div className="prose prose-sm max-w-none prose-invert prose-strong:text-foreground prose-p:text-foreground/90">
          <Markdown>{block.text}</Markdown>
        </div>
      );
    case "h":
      return (
        <h3 className="font-display text-lg font-semibold tracking-tight">
          {block.text}
        </h3>
      );
    case "callout":
      return (
        <div className="rounded-xl border border-cyan/25 bg-gradient-primary-soft p-4">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-cyan">
            <Sparkles className="size-4" /> {block.title}
          </p>
          <p className="text-sm text-foreground/90">{block.text}</p>
        </div>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-xl border border-border bg-[#0b0d14] p-4 font-mono text-[12.5px] leading-relaxed text-foreground/85">
          {block.code}
        </pre>
      );
    case "live":
      return <LiveCell prompt={block.prompt} note={block.note} />;
    case "quiz":
      return <Quiz block={block} />;
  }
}

function LiveCell({ prompt, note }: { prompt: string; note: string }) {
  const providers = useProviders();
  const keyHeaders = useUserKeyHeaders();
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const activeModelId = useUIStore((s) => s.activeModelId);
  const [text, setText] = React.useState(prompt);
  const [out, setOut] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "run" | "done" | "error">(
    "idle",
  );
  const [err, setErr] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const model = getModelById(activeModelId);

  async function run() {
    setStatus("run");
    setOut("");
    setErr(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      for await (const ev of postSSE<any>(
        "/api/v1/router/chat",
        {
          modelId: activeModelId,
          messages: [
            { role: "system", content: "You are a friendly LLM tutor. Be concise." },
            { role: "user", content: text },
          ],
        },
        ctrl.signal,
        keyHeaders,
      )) {
        if (ev.type === "delta") setOut((o) => o + ev.text);
        else if (ev.type === "error") {
          if (ev.code === "key_required") setKeyModalOpen(true);
          setErr(ev.message);
          setStatus("error");
        }
      }
      setStatus((s) => (s === "error" ? s : "done"));
    } catch (e) {
      if (e instanceof SSEHttpError) {
        if (e.code === "key_required" || e.status === 402) setKeyModalOpen(true);
        setErr(e.message);
      }
      if ((e as Error).name !== "AbortError") setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-violet/30 bg-surface/60">
      <div className="flex items-center gap-2 border-b border-border bg-violet/5 px-3 py-2">
        <span className="grid size-5 place-items-center rounded bg-gradient-primary text-primary-foreground">
          <Play className="size-3" />
        </span>
        <span className="text-xs font-semibold">Run this live</span>
        <span className="ml-auto text-2xs text-muted-foreground">
          {model?.name ?? "no model"}
        </span>
      </div>
      <div className="p-3">
        {!providers.loading && !providers.any && (
          <div className="mb-3">
            <ProviderBanner />
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-border bg-surface-2/50 p-2.5 text-sm outline-none focus:border-cyan/40"
        />
        <div className="mt-2 flex items-center gap-2">
          {status === "run" ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                abortRef.current?.abort();
                setStatus("idle");
              }}
            >
              <Square className="size-3.5" /> Stop
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={run}>
              <Play className="size-3.5" /> Run
            </Button>
          )}
          <span className="text-2xs text-muted-foreground">{note}</span>
        </div>

        {(out || status === "run" || err) && (
          <div className="mt-3 rounded-lg border border-border bg-[#0b0d14] p-3 text-sm">
            {err ? (
              <span className="text-danger">{err}</span>
            ) : out ? (
              <Markdown>{out}</Markdown>
            ) : (
              <span className="text-muted-foreground">thinking…</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Quiz({
  block,
}: {
  block: Extract<Block, { type: "quiz" }>;
}) {
  const [picked, setPicked] = React.useState<number | null>(null);
  const [checked, setChecked] = React.useState(false);
  const correct = picked === block.answer;

  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <p className="mb-3 text-sm font-medium">{block.question}</p>
      <div className="space-y-2">
        {block.options.map((o, i) => {
          const isPicked = picked === i;
          const showState = checked && (i === block.answer || isPicked);
          return (
            <button
              key={i}
              disabled={checked}
              onClick={() => setPicked(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                !checked && isPicked && "border-cyan/50 bg-cyan/10",
                !checked && !isPicked && "border-border hover:border-border-strong",
                showState && i === block.answer && "border-success/50 bg-success/10",
                showState && isPicked && i !== block.answer && "border-danger/50 bg-danger/10",
                checked && !showState && "border-border opacity-60",
              )}
            >
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full border text-2xs",
                  isPicked ? "border-cyan text-cyan" : "border-border-strong text-muted-foreground",
                )}
              >
                {String.fromCharCode(65 + i)}
              </span>
              {o}
              {checked && i === block.answer && (
                <Check className="ml-auto size-4 text-success" />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        {!checked ? (
          <Button
            variant="primary"
            size="sm"
            disabled={picked === null}
            onClick={() => setChecked(true)}
          >
            Check answer
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setChecked(false);
              setPicked(null);
            }}
          >
            Try again
          </Button>
        )}
        {checked && (
          <span
            className={cn(
              "text-xs",
              correct ? "text-success" : "text-amber",
            )}
          >
            {correct ? "Correct! " : "Not quite. "}
            {block.explain}
          </span>
        )}
      </div>
    </div>
  );
}

function PathMap({ completed }: { completed: Set<string> }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/40 p-6 sm:p-8">
      <p className="mb-1 text-sm font-medium uppercase tracking-wider text-cyan">
        Learning path
      </p>
      <h2 className="font-display text-2xl font-semibold tracking-tight">
        Beginner → expert, mapped
      </h2>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Each track is a constellation in your journey. Finish a track to light it
        up; complete the capstone to earn your Atlas Certificate.
      </p>

      <div className="mt-8 flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {TRACKS.map((track, i) => {
          const doneCount = track.lessons.filter((l) => completed.has(l.id)).length;
          const allDone = doneCount === track.lessons.length;
          const started = doneCount > 0;
          return (
            <React.Fragment key={track.id}>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className={cn(
                  "flex-1 rounded-2xl border p-4 text-center transition-colors",
                  allDone
                    ? "border-cyan/40 bg-cyan/5 shadow-glow-primary"
                    : started
                      ? "border-border-strong bg-surface"
                      : "border-border bg-surface/50",
                )}
              >
                <div
                  className={cn(
                    "mx-auto mb-2 grid size-10 place-items-center rounded-xl",
                    allDone ? "bg-gradient-primary text-primary-foreground" : "bg-surface-2",
                  )}
                >
                  {allDone ? (
                    <Check className="size-5" />
                  ) : started ? (
                    <CircleDot className="size-5 text-cyan" />
                  ) : i === TRACKS.length - 1 ? (
                    <Award className="size-5 text-muted-foreground" />
                  ) : (
                    <Lock className="size-4 text-muted-foreground/60" />
                  )}
                </div>
                <p className="text-xs font-semibold">{track.title}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {doneCount}/{track.lessons.length}
                </p>
              </motion.div>
              {i < TRACKS.length - 1 && (
                <div className="hidden w-6 items-center justify-center lg:flex">
                  <div className="h-px w-full bg-border" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function CertificateDialog({ progress }: { progress: number }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Award className="size-4" /> Certificate
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <div className="gradient-border p-[1px]">
          <div className="rounded-[calc(var(--radius)-1px)] bg-surface p-8 text-center">
            <AtlasMark size={40} className="mx-auto" />
            <p className="mt-4 text-2xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Atlas Certificate
            </p>
            <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight">
              LLM Foundations
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Awarded to <span className="text-foreground">Rohit Singh</span> for
              completing the Atlas LLM curriculum.
            </p>
            <div className="my-6 flex items-center justify-center gap-2">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-gradient-primary"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="font-mono text-2xs text-muted-foreground">
                {progress}%
              </span>
            </div>
            <p className="text-2xs text-muted-foreground">
              Verifiable credential · atlas/cert/8f3a…21 · signed
            </p>
            <p className="mt-4 text-[10px] text-muted-foreground/70">
              “Atlas Certified” is a self-branded credential, not affiliated with
              MIT the institution.
            </p>
            <Button variant="primary" className="mt-5" disabled={progress < 100}>
              {progress < 100 ? "Complete the course to unlock" : "Download certificate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
