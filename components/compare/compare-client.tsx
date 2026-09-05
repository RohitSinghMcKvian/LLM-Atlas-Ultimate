"use client";

import { useSurfaceContext } from "@/lib/agent/surface-context";
import { compareSurface } from "@/lib/agent/surface-summaries";
import * as React from "react";
import { ArrowLeftRight, GitCompareArrows, Info, RotateCw, Unlock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderBanner } from "@/components/provider-banner";
import { defaultCompareModels } from "@/lib/catalog/defaults";
import { resolveModelIds } from "@/lib/catalog/resolve";
import { ModelHealNotice } from "@/components/catalog/heal-notice";
import { useHealedModels } from "@/lib/hooks/use-healed-models";
import { useProviders } from "@/lib/hooks/use-providers";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { useKeysStore } from "@/lib/store/keys-store";
import { compareRuntime } from "@/lib/compare/runtime";
import { planResume, describeResume } from "@/lib/compare/resume";
import { compareRepo } from "@/lib/compare/repo";
import { headlines as runHeadlines } from "@/lib/compare/analysis";
import { getModelById } from "@/lib/catalog";
import { MAX_LANES, type Depth } from "@/lib/compare/types";
import type { Attachment } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { EvidencePanel } from "./evidence-panel";
import { MetricsPanel } from "./metrics-panel";
import { Scorecard } from "./scorecard";
import { VerdictCard } from "./verdict-card";
import { LaneGrid } from "./lane-grid";
import { RunSpine } from "./run-spine";
import { useCompareDriving, useCompareView } from "./use-compare-run";
import { FollowUpComposer } from "./follow-up-composer";
import { TurnThread } from "./turn-thread";
import { IncognitoBanner, IncognitoChoice } from "./incognito-banner";
import { SessionRail } from "./session-rail";
import { buildLedger, describeLedger } from "@/lib/compare/session-ledger";
import type { CompareSession } from "@/lib/compare/session";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { formatUSD } from "@/lib/utils";
import { suggestionsForTurn } from "@/lib/compare/follow-ups";

/**
 * Atlas Compare.
 *
 * The component is deliberately thin. Everything that used to live here — the
 * abort controller, the streamed text, the run's whole state — moved into
 * `lib/compare/runtime.ts`, a module-scoped singleton, so that leaving this page
 * for another module no longer ends the run. What is left is layout and intent:
 * read the run, render it, and tell the runtime what the user asked for.
 */

export function CompareClient({ initialIds }: { initialIds?: string[] }) {
  const providers = useProviders();
  const env = useRouteEnv();
  const keyHeaders = useUserKeyHeaders();
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);

  const view = useCompareView();
  const run = view?.current ?? null;
  const session = view?.session ?? null;
  // Every turn before the one in flight, oldest first.
  const earlier = React.useMemo(() => view?.turns.slice(0, -1) ?? [], [view]);
  const driving = useCompareDriving();

  const [question, setQuestion] = React.useState("");
  const [depth, setDepth] = React.useState<Depth>("standard");
  const [selected, setSelected] = React.useState<string[]>(() => {
    const init = resolveModelIds(initialIds ?? []);
    return (init.length ? init : defaultCompareModels()).slice(0, MAX_LANES);
  });
  const [syncScroll, setSyncScroll] = React.useState(false);
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [resumeOffer, setResumeOffer] = React.useState<{ id: string; label: string } | null>(null);
  const [tab, setTab] = React.useState<View>("answers");
  const [web, setWeb] = React.useState<boolean | undefined>(undefined);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  /**
   * Chosen before the session starts and frozen for its life.
   *
   * Deliberately unlike chat, where the mode is global and flippable: a
   * per-session choice cannot leak by being forgotten, and there is never half
   * a session on disk.
   */
  const [incognito, setIncognito] = React.useState(false);
  const [sessions, setSessions] = React.useState<CompareSession[]>([]);
  const [railOpen, setRailOpen] = React.useState(true);

  /** Re-read the rail. Cheap: headers only, no answers. */
  const refreshSessions = React.useCallback(() => {
    void compareRepo()
      .listSessions(50)
      .then(setSessions)
      .catch(() => {});
  }, []);

  // The rail follows the runtime: a new turn touches `updatedAt`, and a session
  // whose title changed has to move.
  React.useEffect(() => {
    refreshSessions();
  }, [refreshSessions, session?.id, session?.updatedAt, session?.title, session?.pinned]);

  // Sweep expired sessions once per mount rather than on a timer, so a tab that
  // is never opened never sweeps.
  React.useEffect(() => {
    void compareRepo()
      .pruneSessions()
      .then((n) => {
        if (n > 0) refreshSessions();
      })
      .catch(() => {});
  }, [refreshSessions]);

  const ledger = React.useMemo(
    () => (view ? buildLedger(view.session, view.turns) : null),
    [view],
  );

  const openSession = React.useCallback(
    (id: string) => {
      if (!env) return;
      void compareRuntime.openSession(id, env, keyHeaders);
    },
    [env, keyHeaders],
  );

  const newSessionFrom = React.useCallback((temporary: boolean) => {
    compareRuntime.close();
    setIncognito(temporary);
    setQuestion("");
    setResumeOffer(null);
  }, []);

  // A model can be retired by the daily catalog sync while a link, a bookmark or
  // this very tab still names it. The shared repair remaps a superseded model to
  // its successor, drops one that is genuinely gone, and — unlike the silent
  // version this replaces — says which, because a comparison that loses a column
  // without explanation is a comparison the reader will misread.
  const heal = useHealedModels(selected, setSelected, { fallback: defaultCompareModels });

  // Coming back to the page: if a run was left unfinished, offer to continue it
  // rather than silently spending money again on a question the user may have
  // moved on from.
  React.useEffect(() => {
    if (run || !env) return;
    let cancelled = false;
    void (async () => {
      // The newest session whose last turn never finished. Sessions rather than
      // loose runs, because a run only means something as a turn of one.
      const sessions = await compareRepo().listSessions(5);
      for (const session of sessions) {
        if (cancelled || session.incognito) continue;
        if (Date.now() - session.updatedAt > 6 * 3600_000) continue;
        const loaded = await compareRepo().loadSession(session.id);
        const last = loaded?.runs.sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0)).at(-1);
        if (!last) continue;
        const plan = planResume(last);
        if (plan.complete) continue;
        if (!cancelled) setResumeOffer({ id: last.id, label: describeResume(plan) });
        return;
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [run, env]);

  const sourceCount = run?.evidence?.sources.length ?? 0;

  // Suggestions come from the last turn that actually produced a merge — the
  // turn in flight has nothing to disagree about yet.
  const suggestions = React.useMemo(
    () => suggestionsForTurn(run?.synthesis ? run : earlier.at(-1)),
    [run, earlier],
  );

  // Findings worth surfacing without the reader going looking for them.
  const headlines = React.useMemo(() => {
    if (!run?.analysis) return [];
    return runHeadlines(run, run.analysis, (laneId) => {
      const lane = run.lanes.find((l) => l.id === laneId);
      return getModelById(lane?.modelId ?? laneId)?.name ?? laneId;
    });
  }, [run]);

  const running = React.useMemo(
    () => Boolean(run?.lanes.some((l) => l.status === "streaming" || l.status === "queued")),
    [run],
  );

  // "how are these two doing" means something different while lanes are still
  // streaming, so the state of the run is part of the summary rather than only
  // the models in it.
  useSurfaceContext(compareSurface({ modelIds: selected, running, question }));

  const toggleModel = React.useCallback((id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(0, MAX_LANES)));
  }, []);

  const start = React.useCallback(() => {
    if (!env) return;
    setResumeOffer(null);
    setFocusedId(null);
    void compareRuntime.start({
      config: { question, modelIds: selected, depth, web },
      env,
      incognito,
      headers: keyHeaders,
      // Only the parsed text travels: an image attachment has no text for a
      // shared evidence pack, and a failed parse would put its error message
      // into every lane's prompt.
      documents: attachments
        .filter((a) => a.text && !a.failed)
        .map((a) => ({ name: a.name, text: a.text as string })),
    });
  }, [env, question, selected, depth, web, incognito, attachments, keyHeaders]);

  const askFollowUp = React.useCallback(
    (text: string, opts: { refreshEvidence: boolean }) => {
      if (!env) return;
      void compareRuntime.askFollowUp(text, { env, refreshEvidence: opts.refreshEvidence });
    },
    [env],
  );

  const resume = React.useCallback(async () => {
    if (!env || !resumeOffer) return;
    const id = resumeOffer.id;
    setResumeOffer(null);
    await compareRuntime.resume(id, env, keyHeaders);
  }, [env, resumeOffer, keyHeaders]);

  const retryLane = React.useCallback(
    (id: string) => {
      if (!env) return;
      void compareRuntime.retryLane(id, env);
    },
    [env],
  );

  // Keyboard: run, stop, lock scrolling, focus a lane by number. Registered on
  // the document so they work wherever focus happens to be, except in a field.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "Enter" && question.trim()) {
        e.preventDefault();
        start();
        return;
      }
      if (mod && e.key === ".") {
        e.preventDefault();
        compareRuntime.stopAll();
        return;
      }
      if (typing) return;
      if (mod && e.key === "\\") {
        e.preventDefault();
        setSyncScroll((s) => !s);
        return;
      }
      if (!mod && /^[1-6]$/.test(e.key) && run) {
        const lane = run.lanes[Number(e.key) - 1];
        if (lane) setFocusedId((cur) => (cur === lane.id ? null : lane.id));
      }
      if (e.key === "Escape") setFocusedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [question, start, run]);

  const rail = (
    <SessionRail
      sessions={sessions}
      activeId={session?.id ?? null}
      onNew={newSessionFrom}
      onSelect={openSession}
      onRename={(id, title) => {
        if (id === session?.id) compareRuntime.updateSession({ title });
        else
          void compareRepo()
            .loadSession(id)
            .then((l) => l && compareRepo().saveSession({ ...l.session, title, updatedAt: Date.now() }))
            .then(refreshSessions)
            .catch(() => {});
      }}
      onTogglePin={(id) => {
        const target = sessions.find((s) => s.id === id);
        if (!target) return;
        if (id === session?.id) compareRuntime.updateSession({ pinned: !target.pinned });
        else
          void compareRepo()
            .saveSession({ ...target, pinned: !target.pinned, updatedAt: Date.now() })
            .then(refreshSessions)
            .catch(() => {});
      }}
      onDelete={(id) => {
        if (id === session?.id) compareRuntime.close();
        void compareRepo().deleteSession(id).then(refreshSessions).catch(() => {});
      }}
      footer={
        ledger && ledger.turns > 0 ? (
          <p className="flex items-center justify-between px-1 text-2xs text-muted-foreground">
            <span>{describeLedger(ledger)}</span>
            <span className="font-mono tabular-nums">
              {ledger.costIncomplete ? "~" : ""}
              {formatUSD(ledger.costUsd, { precise: true })}
            </span>
          </p>
        ) : null
      }
    />
  );

  return (
    <div className="flex">
      <aside
        className={cn(
          "sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 border-r border-border bg-surface/40 transition-[width] duration-300 lg:block",
          railOpen ? "w-64" : "w-0 overflow-hidden border-r-0",
        )}
      >
        {railOpen && rail}
      </aside>

      <div className="min-w-0 flex-1">
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-6 flex items-start gap-3">
        <button
          onClick={() => setRailOpen((o) => !o)}
          aria-label={railOpen ? "Hide comparison history" : "Show comparison history"}
          className="mt-1 hidden size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground lg:grid"
        >
          {railOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </button>
        <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Compare</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One question, up to {MAX_LANES} models, all answering from the same evidence — then
          scored, and merged into a single answer.
        </p>
        </div>
      </div>

      {!providers.loading && !providers.any && (
        <div className="mb-5">
          <ProviderBanner />
        </div>
      )}

      {resumeOffer && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-action/25 bg-action/10 px-4 py-3 text-sm">
          <RotateCw className="size-4 shrink-0 text-action" />
          <span className="min-w-0 flex-1">
            A run was left unfinished. {resumeOffer.label}
          </span>
          <Button size="sm" variant="primary" onClick={resume}>
            Continue
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setResumeOffer(null)}>
            Discard
          </Button>
        </div>
      )}

      {session?.incognito && <IncognitoBanner className="mb-2" />}

      <ModelHealNotice notice={heal.notice} onDismiss={heal.dismiss} className="mb-2" />

      <Composer
        question={question}
        onQuestionChange={setQuestion}
        selected={selected}
        onToggleModel={toggleModel}
        depth={depth}
        onDepthChange={setDepth}
        web={web}
        onWebChange={setWeb}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        env={env}
        disabled={running}
        onRun={start}
        collapsed={Boolean(run)}
        beforeRun={
          session ? null : (
            <IncognitoChoice value={incognito} onChange={setIncognito} disabled={running} />
          )
        }
      />

      {run && (
        <div className="mt-5 space-y-4">
          <RunSpine run={run} running={running} onStop={() => compareRuntime.stopAll()} />

          {!driving && (
            <p className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/50 px-3.5 py-2.5 text-2xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" />
              Another tab is running this comparison. This one is following along — its controls stay
              off so the run is not paid for twice.
            </p>
          )}

          {earlier.length > 0 && <TurnThread turns={earlier} />}

          <VerdictCard run={run} headlines={headlines} onOpenScores={() => setTab("scores")} />

          <div className="flex flex-wrap items-center gap-2">
            <nav className="flex items-center gap-1" aria-label="Run views">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setTab(v.id)}
                  aria-current={tab === v.id ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-2xs font-medium transition-colors",
                    tab === v.id
                      ? "bg-surface-2 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v.label}
                  {v.id === "evidence" && sourceCount > 0 && (
                    <span className="ml-1.5 font-mono text-muted-foreground">{sourceCount}</span>
                  )}
                </button>
              ))}
            </nav>

            {tab === "answers" && (
              <ViewToggle
                active={syncScroll}
                onClick={() => setSyncScroll((s) => !s)}
                icon={syncScroll ? ArrowLeftRight : Unlock}
                className="ml-auto"
              >
                {syncScroll ? "Scrolling together" : "Scroll each lane"}
              </ViewToggle>
            )}
          </div>

          {tab === "answers" && (
            <LaneGrid
              lanes={run.lanes}
              syncScroll={syncScroll}
              focusedId={focusedId}
              onFocus={setFocusedId}
              onStop={(id) => compareRuntime.stopLane(id)}
              onRetry={driving ? retryLane : undefined}
              onConnectKey={() => setKeyModalOpen(true)}
            />
          )}
          {tab === "scores" && <Scorecard run={run} />}
          {tab === "metrics" && <MetricsPanel run={run} />}
          {tab === "evidence" && <EvidencePanel run={run} />}

          <FollowUpComposer
            onAsk={askFollowUp}
            suggestions={suggestions}
            disabled={running}
            canAsk={driving}
          />
        </div>
      )}

      {!run && (
        <div className="mt-10 rounded-2xl border border-dashed border-border p-12 text-center">
          <GitCompareArrows className="mx-auto mb-3 size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Pick your models and ask a question. The run keeps going if you switch tabs.
          </p>
        </div>
      )}
    </div>
      </div>
    </div>
  );
}

/**
 * The run's views.
 *
 * Switching between them never touches the run — they are projections over the
 * same state in the runtime, so reading the evidence while six lanes stream is
 * free and cannot interrupt anything.
 */
type View = "answers" | "scores" | "metrics" | "evidence";

const VIEWS: { id: View; label: string }[] = [
  { id: "answers", label: "Answers" },
  { id: "scores", label: "Scores" },
  { id: "metrics", label: "Metrics" },
  { id: "evidence", label: "Evidence" },
];

function ViewToggle({
  active,
  onClick,
  icon: Icon,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-2xs transition-colors",
        active
          ? "border-action/40 bg-action/10 text-foreground"
          : "border-border bg-surface-2/60 text-muted-foreground hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}
