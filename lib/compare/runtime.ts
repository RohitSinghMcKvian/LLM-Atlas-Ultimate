"use client";

// The run controller: a module-scoped singleton that owns a comparison run.
//
// This is the piece that makes a run outlive the page. Everything about the old
// Compare lived inside the component — the `AbortController` in a ref, the
// columns in `useState` — so leaving `/compare` for another module unmounted the
// component and ended a run the user had already paid for, and a reload lost it
// outright.
//
// Inverting that is the whole design here. The runtime owns the run and the
// requests; the React component is a *subscriber*. Unmounting drops a listener
// and nothing else. Three further properties fall out of that:
//
//   * One request per lane, not one per run. A lane can then be stopped or
//     retried on its own, resume can re-issue exactly the lanes that never
//     finished, and each request gets its own 300 s budget instead of sharing
//     one.
//   * Checkpoints on every terminal lane event and again on the way out
//     (`visibilitychange`, `pagehide`), so a tab the OS discards mid-run comes
//     back from its last checkpoint.
//   * One driver per run across tabs, elected with `navigator.locks`, so opening
//     Compare twice cannot bill the same run twice.

import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { describeBrief, fallbackBrief, needsEvidence } from "./brief";
import { describeEvidence, packTokens } from "./evidence";
import { buildLaneContext } from "./context-fit";
import { analyseRun } from "./analysis";
import { decideVerdict } from "./analysis/metrics";
import { describeScores } from "./judge";
import { describeSynthesis } from "./synthesis";
import { DEPTH_PRESETS } from "./lanes";
import { laneCost } from "./cost";
import {
  CONTEXT_SAFETY,
  PROMPT_OVERHEAD_TOKENS,
  arbiterCandidates,
  pickArbiter,
  planLanes,
  type LanePlanResult,
} from "./lanes";
import { getModelById } from "@/lib/catalog";
import { compareRepo } from "./repo";
import {
  appendTurn,
  inheritedEvidence,
  newSession,
  orderedTurns,
  runId,
  setLanes,
  type CompareSession,
} from "./session";
import { fitLaneHistory, laneHistory } from "./thread";
import { planResume } from "./resume";
import {
  EMPTY_EVIDENCE,
  emptyLane,
  emptyStages,
  type Brief,
  type CompareRun,
  type EvidenceEvent,
  type LanePlan,
  type EvidencePack,
  type LaneEvent,
  type JudgeScore,
  type LaneState,
  type RunConfig,
  type Stage,
  type Synthesis,
  type SynthesisEvent,
} from "./types";
import type { RouteEnv } from "@/lib/catalog/availability";

/**
 * How often streamed text is committed to React.
 *
 * The same 48 ms the chat and playground clients use. Six lanes streaming at
 * once would otherwise be six whole-page re-renders per token.
 */
const FLUSH_MS = 48;

/**
 * How often a streaming answer is written to storage.
 *
 * Frequent enough that a tab killed without warning loses seconds rather than
 * minutes; rare enough that it is one small record write per lane rather than a
 * write per token.
 */
const CHECKPOINT_MS = 5_000;

/** Abort key for the evidence stage, which is one request rather than one per lane. */
const EVIDENCE_KEY = "stage:evidence";
const SYNTHESIS_KEY = "stage:synthesis";

/** Lock name for the tab that is allowed to drive a given run. */
const lockName = (runId: string) => `atlas-compare:${runId}`;
const channelName = (runId: string) => `atlas-compare:${runId}`;

type Listener = () => void;

export interface StartOptions {
  config: RunConfig;
  env: RouteEnv;
  /** BYOK headers from `useUserKeyHeaders()`. Forwarded, never stored. */
  headers?: Record<string, string>;
  /**
   * Attachment text, already parsed by `lib/chat/attachments.ts`.
   *
   * Held on the runtime rather than in the run record: the parsed text can be
   * megabytes and it is already inside the evidence pack once the stage runs, so
   * checkpointing it twice would double the storage a run costs.
   */
  documents?: { name: string; text: string }[];
  /** Start a temporary session: nothing it produces is written. */
  incognito?: boolean;
}

/**
 * What a subscriber sees.
 *
 * A session rather than a run, because a comparison is now a conversation: the
 * thread renders every turn and the composer asks the next one. `current` is the
 * newest turn and is the one the stage machine is driving.
 */
export interface CompareView {
  session: CompareSession;
  /** Every turn in order, including `current`. */
  turns: CompareRun[];
  current: CompareRun;
}

export interface RuntimeStatus {
  /** This tab is the one making requests. False when another tab holds the lock. */
  driving: boolean;
  /** A run is loaded, finished or not. */
  active: boolean;
}

class CompareRuntime {
  private run: CompareRun | null = null;
  /** Turns before `run`, oldest first. */
  private earlier: CompareRun[] = [];
  private session: CompareSession | null = null;
  /**
   * Rebuilt on every commit so identity comparison is enough for
   * `useSyncExternalStore` — React must never re-render on an unchanged view.
   */
  private view: CompareView | null = null;
  private listeners = new Set<Listener>();

  /** Per-lane abort handles. One request per lane is what makes this possible. */
  private aborts = new Map<string, AbortController>();

  /** Streamed text held out of React until the next flush. */
  private buffers = new Map<string, { text: string; reasoning: string }>();
  private dirty = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private headers: Record<string, string> = {};
  /** True for a temporary session: nothing it produces is written. */
  private incognito = false;
  /** Kept so the arbiter passes can ask what is runnable without a round trip. */
  private env: RouteEnv | null = null;
  /** This run's attachment text, sent once to the evidence stage. */
  private documents: { name: string; text: string }[] = [];
  private lastCheckpoint = 0;
  private driving = false;
  private releaseLock: (() => void) | null = null;
  /** The run whose lock this tab currently holds. */
  private lockedRunId: string | null = null;
  /**
   * The outer `locks.request` promise, which settles only once the lock has
   * actually been handed back. Awaited before re-acquiring, because releasing
   * and re-requesting are not synchronous with each other.
   */
  private lockDone: Promise<unknown> | null = null;
  private channel: BroadcastChannel | null = null;
  private teardown: (() => void)[] = [];

  /* ---------------------------------------------------------------- store -- */

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /**
   * Stable snapshot for `useSyncExternalStore`.
   *
   * Every commit replaces the run object, so identity comparison is enough and
   * React never re-renders on an unchanged run.
   */
  getSnapshot = (): CompareView | null => this.view;

  /** Server render has no session, and must not read one from a browser-only store. */
  getServerSnapshot = (): CompareView | null => null;

  getStatus = (): RuntimeStatus => ({ driving: this.driving, active: this.run !== null });

  /**
   * Storage for the run in flight.
   *
   * Resolved per call rather than held, so a temporary session and a saved one
   * can exist in the same tab without either leaking into the other.
   */
  private repo() {
    return compareRepo(this.incognito);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private commit(next: CompareRun): void {
    this.run = { ...next, updatedAt: Date.now() };
    this.view = this.session
      ? { session: this.session, turns: [...this.earlier, this.run], current: this.run }
      : null;
    this.emit();
  }

  /** Replace the session header and refresh the view without touching the turn. */
  private commitSession(next: CompareSession): void {
    this.session = next;
    if (this.run) {
      this.view = { session: next, turns: [...this.earlier, this.run], current: this.run };
    }
    this.emit();
  }

  private patchLane(id: string, patch: Partial<LaneState>): void {
    if (!this.run) return;
    const lanes = this.run.lanes.map((l) => (l.id === id ? { ...l, ...patch } : l));
    this.commit({ ...this.run, lanes });
  }

  private patchStage(stage: Stage, patch: Partial<CompareRun["stages"][Stage]>): void {
    if (!this.run) return;
    this.commit({
      ...this.run,
      stages: { ...this.run.stages, [stage]: { ...this.run.stages[stage], ...patch } },
    });
  }

  /* ------------------------------------------------------------ buffering -- */

  private buffer(id: string): { text: string; reasoning: string } {
    let b = this.buffers.get(id);
    if (!b) {
      b = { text: "", reasoning: "" };
      this.buffers.set(id, b);
    }
    return b;
  }

  private schedule(): void {
    if (this.flushTimer == null) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  /**
   * Commit buffered text.
   *
   * Also called synchronously before every terminal event, so no trailing text
   * can be dropped, and on `visibilitychange` — a hidden tab has its timers
   * throttled to about once a minute, and without that flush the user would come
   * back to a minute-old view of a run that had in fact kept going.
   */
  private flush = (): void => {
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty.size || !this.run) return;
    const ids = new Set(this.dirty);
    this.dirty.clear();
    const lanes = this.run.lanes.map((l) => {
      if (!ids.has(l.id)) return l;
      const b = this.buffers.get(l.id);
      return b ? { ...l, text: b.text, reasoning: b.reasoning } : l;
    });
    this.commit({ ...this.run, lanes });

    // Checkpoint the partial answers periodically, not only when a lane
    // finishes. `pagehide` and `visibilitychange` cover a tab that is closed or
    // backgrounded, but an OS that kills a tab outright fires neither — and
    // losing four minutes of a Deep answer because nothing had settled yet is
    // exactly the failure this module exists to stop.
    const now = Date.now();
    if (now - this.lastCheckpoint >= CHECKPOINT_MS) {
      this.lastCheckpoint = now;
      const runId = this.run.id;
      const changed = lanes.filter((l) => ids.has(l.id));
      void this.repo().saveLanes(runId, changed).catch(() => {});
    }
  };

  /* --------------------------------------------------------------- driving -- */

  /**
   * Start a new run.
   *
   * Returns the run id immediately; the work continues in the background whether
   * or not anyone is still rendering it.
   */
  async start(opts: StartOptions): Promise<string> {
    this.stopAll();

    this.headers = opts.headers ?? {};
    this.env = opts.env;
    this.incognito = opts.incognito ?? false;
    this.documents = opts.documents ?? [];
    this.earlier = [];
    this.buffers.clear();
    this.dirty.clear();

    const session = newSession({
      question: opts.config.question,
      modelIds: opts.config.modelIds,
      depth: opts.config.depth,
      incognito: this.incognito,
      web: opts.config.web,
    });
    this.session = session;

    const id = await this.openTurn(opts.config, opts.env);
    await this.attach(session.id);
    if (this.driving) void this.drive(opts.env);
    return id;
  }

  /**
   * Ask a follow-up in the current session.
   *
   * The lane set comes from the session, not from the caller, so a turn cannot
   * silently change which models are being compared — `changeLanes` is the
   * explicit way to do that, and it records that the new lane starts cold.
   */
  async askFollowUp(
    question: string,
    opts: { env: RouteEnv; refreshEvidence?: boolean } = {} as { env: RouteEnv },
  ): Promise<string | null> {
    const session = this.session;
    const env = opts.env ?? this.env;
    if (!session || !env || !this.driving) return null;
    if (!question.trim()) return null;

    this.stopAll();
    // The finished turn joins the history; the new one becomes current.
    if (this.run) this.earlier = [...this.earlier, this.run];

    const config: RunConfig = {
      ...session.turnIds.length ? {} : {},
      question,
      modelIds: session.modelIds,
      depth: session.depth,
      web: session.web,
    };
    const id = await this.openTurn(config, env, { refreshEvidence: opts.refreshEvidence });
    void this.drive(env);
    return id;
  }

  /**
   * Create the next turn and record it on the session.
   *
   * Evidence is inherited from the session's earlier turns unless the caller
   * asked to research again — which is what keeps citation numbers meaning the
   * same thing for the whole session.
   */
  private async openTurn(
    config: RunConfig,
    env: RouteEnv,
    opts: { refreshEvidence?: boolean } = {},
  ): Promise<string> {
    const session = this.session!;
    const plan = planLanes({ config, env });
    const id = runId();
    const now = Date.now();

    const inherited = opts.refreshEvidence ? undefined : inheritedEvidence(this.earlier);
    const stages = emptyStages();
    if (inherited) {
      stages.evidence = {
        status: "done",
        finishedAt: now,
        note: "Reusing this session's sources",
      };
    }

    const run: CompareRun = {
      id,
      createdAt: now,
      updatedAt: now,
      sessionId: session.id,
      turnIndex: this.earlier.length,
      refreshedEvidence: opts.refreshEvidence || undefined,
      config,
      stages,
      evidence: inherited,
      lanes: plan.lanes.map(emptyLane),
    };

    this.buffers.clear();
    this.dirty.clear();
    this.commitSession(appendTurn(session, id, now));
    this.commit(run);
    await this.repo().saveSession(this.session!).catch(() => {});
    await this.repo().saveRun(run).catch(() => {});
    return id;
  }

  /** Change which models the session compares from the next turn on. */
  changeLanes(modelIds: string[]): void {
    if (!this.session) return;
    this.commitSession(setLanes(this.session, modelIds));
    void this.repo().saveSession(this.session).catch(() => {});
  }

  /** Rename, pin — session header edits that do not touch a turn. */
  updateSession(patch: Partial<Pick<CompareSession, "title" | "pinned">>): void {
    if (!this.session) return;
    this.commitSession({ ...this.session, ...patch, updatedAt: Date.now() });
    void this.repo().saveSession(this.session).catch(() => {});
  }

  /** Mark a lane as the keeper for the current turn. Toggles. */
  keepLane(laneId: string): void {
    if (!this.run) return;
    const kept = this.run.kept === laneId ? undefined : laneId;
    this.commit({ ...this.run, kept });
    void this.repo().saveRunHeader(this.run).catch(() => {});
  }

  /**
   * Run the stages in order, stopping at the first one that cannot proceed.
   *
   * Sequential because each stage genuinely feeds the next: the brief decides
   * what is searched, the evidence decides what the lanes carry, and a lane
   * cannot be planned until the pack's size is known.
   */
  private async drive(env: RouteEnv, only?: string[]): Promise<void> {
    if (!this.run) return;

    const brief = this.run.brief ?? (await this.runBrief());
    if (!this.run) return;

    // An inherited pack is already on the turn, and `runEvidence` is skipped —
    // that is what makes a follow-up cheap and keeps the citation numbers stable.
    const pack = this.run.evidence ?? (await this.runEvidence(brief));
    if (!this.run) return;

    // The pack's size is what decides each lane's context fit, so lanes are
    // planned here rather than at start — a narrow-context model gets the same
    // evidence carried a different way, never different evidence.
    const plan = planLanes({
      config: { ...this.run.config, question: brief.task },
      env,
      evidenceTokens: packTokens(pack),
    });
    this.commit({ ...this.run, lanes: mergeLanes(this.run.lanes, plan.lanes) });
    await this.driveLanes(plan, only);
    if (!this.run) return;

    await this.runAnalysis(brief);
    if (!this.run) return;
    await this.runSynthesis(brief, pack);
  }

  /**
   * Measure, then score.
   *
   * The deterministic pass always runs: it is free, it cannot fail, and it is
   * what leaves a Quick run with numbers. The judge is depth-gated and layered on
   * top, so when it is off or unavailable the measurements still stand rather
   * than the stage failing.
   */
  private async runAnalysis(brief: Brief): Promise<void> {
    if (!this.run) return;
    this.patchStage("analyse", { status: "running", startedAt: Date.now() });

    // Deterministic first, so the panels have something even if the judge fails.
    this.commit({ ...this.run, analysis: analyseRun(this.run) });

    const preset = DEPTH_PRESETS[this.run.config.depth] ?? DEPTH_PRESETS.standard;
    const answered = this.run.lanes.filter((l) => l.text.trim().length > 0);

    let scores: JudgeScore[] = [];
    let judgeName: string | undefined;
    let note: string | undefined;

    if (!preset.judge) {
      note = "Measured. Scoring is off at this depth.";
    } else if (answered.length === 0) {
      note = "Measured. No answer to score.";
    } else {
      const preferred = this.run.config.judgeModelId;
      const arbiter = pickArbiter(
        this.run.lanes.map((l) => l.id),
        preferred ? [preferred, ...arbiterCandidates()] : arbiterCandidates(),
        this.env ?? { configured: [] },
      );
      if (!arbiter) {
        note = "Measured. No model was available to judge.";
      } else {
        judgeName = arbiter.modelId;
        try {
          const res = await fetch("/api/v1/compare/analyse", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.headers },
            body: JSON.stringify({
              task: brief.task,
              rubric: brief.rubric,
              lanes: answered.map((l) => ({ id: l.id, text: l.text })),
              evidence: this.run.evidence,
              modelId: arbiter.modelId,
            }),
          });
          const data = (await res.json()) as { scores?: JudgeScore[]; reason?: string };
          scores = data.scores ?? [];
          if (scores.length === 0) {
            note = data.reason ?? "The judge returned nothing usable.";
          } else if (arbiter.isContestant) {
            // A contestant judging its own field is a real caveat, so it is
            // stated rather than hidden behind a number.
            note = "Scored by " + arbiter.modelId + ", which is also a lane.";
          }
        } catch {
          note = "The judge could not be reached.";
        }
      }
    }

    if (!this.run) return;
    const withScores = { ...this.run, scores: scores.length ? scores : undefined };
    const verdict = decideVerdict({ lanes: withScores.lanes, scores });
    this.commit({
      ...withScores,
      verdict,
      // Recomputed with scores in hand: the efficiency frontier needs a quality
      // axis, so it is empty until now.
      analysis: analyseRun(withScores),
    });
    this.patchStage("analyse", {
      status: "done",
      finishedAt: Date.now(),
      modelId: scores.length ? judgeName : undefined,
      note: note ?? describeScores(scores, judgeName),
    });
    await this.checkpoint();
  }

  /** Merge the answers into one. */
  private async runSynthesis(brief: Brief, pack: EvidencePack): Promise<void> {
    if (!this.run) return;
    const answered = this.run.lanes.filter((l) => l.text.trim().length > 0);

    if (answered.length === 0) {
      this.patchStage("synthesis", {
        status: "skipped",
        finishedAt: Date.now(),
        note: "Nothing to merge",
      });
      return;
    }
    if (answered.length === 1) {
      // Merging one answer with itself is a paid no-op.
      this.patchStage("synthesis", {
        status: "skipped",
        finishedAt: Date.now(),
        note: "Only one answer — nothing to merge",
      });
      return;
    }

    const preferred = this.run.config.synthesisModelId;
    const arbiter = pickArbiter(
      this.run.lanes.map((l) => l.id),
      preferred ? [preferred, ...arbiterCandidates()] : arbiterCandidates(),
      this.env ?? { configured: [] },
    );
    if (!arbiter) {
      this.patchStage("synthesis", {
        status: "done",
        finishedAt: Date.now(),
        note: "No model was available to merge the answers",
      });
      return;
    }

    this.patchStage("synthesis", {
      status: "running",
      startedAt: Date.now(),
      modelId: arbiter.modelId,
    });
    const controller = new AbortController();
    this.aborts.set(SYNTHESIS_KEY, controller);

    let synthesis: Synthesis | undefined;
    let failure: string | undefined;
    try {
      for await (const ev of postSSE<SynthesisEvent>(
        "/api/v1/compare/synthesize",
        {
          task: brief.task,
          lanes: answered.map((l) => ({ id: l.id, text: l.text })),
          evidence: pack,
          clusters: this.run.analysis?.similarity.clusters,
          outlier: this.run.analysis?.similarity.outlier,
          modelId: arbiter.modelId,
        },
        controller.signal,
        this.headers,
      )) {
        if (ev.type === "synthesis_done") synthesis = ev.synthesis;
        else if (ev.type === "synthesis_error") failure = ev.message;
      }
    } catch (e) {
      if (!controller.signal.aborted) failure = (e as Error).message;
    } finally {
      this.aborts.delete(SYNTHESIS_KEY);
    }

    if (!this.run) return;
    if (synthesis) {
      this.commit({ ...this.run, synthesis });
      this.patchStage("synthesis", {
        status: "done",
        finishedAt: Date.now(),
        note: describeSynthesis(synthesis, arbiter.modelId),
      });
    } else {
      this.patchStage("synthesis", {
        status: "error",
        finishedAt: Date.now(),
        error: failure ?? "The merge could not be produced.",
        note: "The answers are still above — only the merge failed.",
      });
    }
    await this.checkpoint();
  }

  /** Prepare the run. Degrades to a generic rubric rather than failing. */
  private async runBrief(): Promise<Brief> {
    if (!this.run) return fallbackBrief("");
    const config = this.run.config;
    this.patchStage("brief", { status: "running", startedAt: Date.now() });

    const arbiter = pickArbiter(
      this.run.lanes.map((l) => l.id),
      arbiterCandidates(),
      this.env ?? { configured: [] },
    );

    let brief = fallbackBrief(config.question);
    let fallback = true;
    if (arbiter) {
      try {
        const res = await fetch("/api/v1/compare/brief", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.headers },
          body: JSON.stringify({
            question: config.question,
            modelId: arbiter.modelId,
            web: config.web,
          }),
        });
        const data = (await res.json()) as { brief?: Brief; fallback?: boolean };
        if (data.brief) {
          brief = data.brief;
          fallback = data.fallback !== false;
        }
      } catch {
        // Keep the fallback. A run that refuses to start because a preparation
        // step failed is worse than one that runs on generic criteria and says so.
      }
    }

    if (!this.run) return brief;
    this.commit({ ...this.run, brief });
    this.patchStage("brief", {
      status: "done",
      finishedAt: Date.now(),
      modelId: brief.modelId,
      note: fallback ? "Generic criteria — the brief could not be prepared" : describeBrief(brief),
    });
    await this.checkpoint();
    return brief;
  }

  /** Gather the one pack every lane answers from. */
  private async runEvidence(brief: Brief): Promise<EvidencePack> {
    if (!this.run) return EMPTY_EVIDENCE;
    const config = this.run.config;

    if (!needsEvidence(brief, config.web) && this.documents.length === 0) {
      this.patchStage("evidence", {
        status: "skipped",
        finishedAt: Date.now(),
        note: "This question needs no sources",
      });
      this.commit({ ...this.run, evidence: EMPTY_EVIDENCE });
      return EMPTY_EVIDENCE;
    }

    this.patchStage("evidence", { status: "running", startedAt: Date.now() });
    const controller = new AbortController();
    this.aborts.set(EVIDENCE_KEY, controller);

    let pack: EvidencePack = EMPTY_EVIDENCE;
    try {
      for await (const ev of postSSE<EvidenceEvent>(
        "/api/v1/compare/evidence",
        {
          question: brief.task,
          briefQueries: brief.researchQueries,
          depth: config.depth,
          documents: this.documents,
        },
        controller.signal,
        this.headers,
      )) {
        if (ev.type === "round") {
          this.patchStage("evidence", {
            note: `Round ${ev.round + 1} · ${ev.queries.length} searches · ${ev.newSources} new`,
          });
        } else if (ev.type === "evidence_done") {
          pack = ev.pack;
        }
      }
    } catch {
      // Degraded, not failed: the lanes answer without sources and the UI says
      // the evidence stage did not complete.
    } finally {
      this.aborts.delete(EVIDENCE_KEY);
    }

    if (!this.run) return pack;
    this.commit({ ...this.run, evidence: pack });
    this.patchStage("evidence", {
      status: "done",
      finishedAt: Date.now(),
      note: describeEvidence(pack),
    });
    await this.checkpoint();
    return pack;
  }

  /**
   * Re-open a run from storage and continue whatever never finished.
   *
   * The same path is used on returning to `/compare`, on a reload, and when a
   * driver tab goes away and another picks the run up.
   */
  /**
   * Re-open a stored session and continue whatever never finished.
   *
   * The same path serves returning to `/compare`, a reload, and one tab picking
   * up a run another tab was driving.
   */
  async openSession(
    id: string,
    env: RouteEnv,
    headers?: Record<string, string>,
  ): Promise<boolean> {
    const loaded = await this.repo().loadSession(id).catch(() => undefined);
    if (!loaded || loaded.runs.length === 0) return false;

    this.stopAll();
    this.headers = headers ?? this.headers;
    this.env = env;
    this.incognito = loaded.session.incognito;
    this.buffers.clear();
    this.dirty.clear();

    const turns = orderedTurns(loaded.session, loaded.runs);
    const current = turns[turns.length - 1];
    this.session = loaded.session;
    this.earlier = turns.slice(0, -1);
    for (const lane of current.lanes) {
      this.buffers.set(lane.id, { text: lane.text, reasoning: lane.reasoning });
    }
    this.commit(current);

    await this.attach(loaded.session.id);
    if (!this.driving) return true;

    const plan = planResume(current);
    if (plan.complete) return true;
    void this.drive(env, plan.laneIds.length ? plan.laneIds : undefined);
    return true;
  }

  async resume(runId: string, env: RouteEnv, headers?: Record<string, string>): Promise<boolean> {
    const stored = await this.repo().loadRun(runId).catch(() => undefined);
    if (!stored) return false;
    // A run stored before sessions existed is shown as a session of one.
    if (stored.sessionId) return this.openSession(stored.sessionId, env, headers);
    this.session = newSession({
      question: stored.config.question,
      modelIds: stored.config.modelIds,
      depth: stored.config.depth,
      now: stored.createdAt,
    });
    this.session = appendTurn(this.session, stored.id, stored.updatedAt);
    this.earlier = [];

    this.headers = headers ?? this.headers;
    this.env = env;
    this.buffers.clear();
    this.dirty.clear();
    // Rehydrate the buffers from what was checkpointed, so a lane that resumes
    // appends to its existing answer rather than restarting the text.
    for (const lane of stored.lanes) {
      this.buffers.set(lane.id, { text: lane.text, reasoning: lane.reasoning });
    }
    this.commit(stored);

    await this.attach(runId);
    if (!this.driving) return true;

    const plan = planResume(stored);
    if (plan.complete) return true;
    // `drive` re-runs only what is missing: a stored brief and pack are reused
    // rather than paid for twice.
    void this.drive(env, plan.laneIds.length ? plan.laneIds : undefined);
    return true;
  }

  /**
   * Take the driver lock if it is free, and mirror to other tabs either way.
   *
   * `ifAvailable` rather than waiting: a second tab must render the run
   * immediately as an observer, not block until the first one closes. A separate
   * un-gated request waits in the background so this tab takes over if the
   * driver disappears.
   */
  private async attach(runId: string): Promise<void> {
    // Re-attaching to the run this tab already drives — which is what returning
    // to the page and continuing an unfinished run both do. Releasing the lock
    // only to ask for it again would race: the release has not landed by the
    // time `ifAvailable` looks, so the tab would decide another tab held it and
    // refuse to drive its own run.
    const keepLock = this.lockedRunId === runId && this.driving;

    await this.detach({ keepLock });
    this.openChannel(runId);
    this.bindLifecycle();

    if (keepLock) {
      this.driving = true;
      this.emit();
      return;
    }

    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) {
      // No Web Locks (older Safari). Driving is the safe default: a run that
      // nobody drives is worse than one driven twice, and the second tab would
      // have to be opened deliberately.
      this.driving = true;
      this.emit();
      return;
    }

    // The lock is held for as long as this tab drives, by returning a promise
    // that only settles on release. That promise must NOT be the one we await —
    // awaiting it would block here until the run ended, so `driving` would never
    // become true and nothing would ever start. `acquired` settles the moment
    // the outcome is known; the holding promise keeps running behind it.
    const acquired = new Promise<boolean>((resolve) => {
      this.lockDone = locks
        .request(lockName(runId), { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          this.lockedRunId = runId;
          resolve(true);
          return new Promise<void>((release) => {
            this.releaseLock = release;
          });
        })
        .catch(() => resolve(false));
    });

    this.driving = await acquired;
    this.emit();

    if (!this.driving) void this.awaitHandover(runId);
  }

  /**
   * Wait for the driving tab to go away, then take over.
   *
   * Without this, closing the tab that started a run would leave the other tab
   * showing it frozen forever.
   */
  private async awaitHandover(runId: string): Promise<void> {
    const locks = navigator?.locks;
    if (!locks) return;
    // Un-gated: this waits, by design, until the driving tab releases. Not
    // awaited by the caller for the same reason as above.
    void locks
      .request(lockName(runId), () => {
        // The user may have moved to a different run while this was queued.
        if (this.run?.id !== runId) return;
        this.driving = true;
        this.emit();
        return new Promise<void>((release) => {
          this.releaseLock = release;
        });
      })
      .catch(() => {});
  }

  private openChannel(runId: string): void {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(channelName(runId));
    channel.onmessage = (ev: MessageEvent<CompareRun>) => {
      // Observers mirror the driver. The driver ignores its own echo, and a
      // stale message for a run this tab has moved on from is dropped.
      if (this.driving) return;
      if (!ev.data || ev.data.id !== this.run?.id) return;
      this.run = ev.data;
      this.emit();
    };
    this.channel = channel;
  }

  private broadcast(): void {
    if (!this.driving || !this.channel || !this.run) return;
    try {
      this.channel.postMessage(this.run);
    } catch {
      // A run carrying very large answers can exceed the structured-clone
      // budget. Mirroring is a convenience; failing it must not stop the run.
    }
  }

  /**
   * Checkpoint on the way out.
   *
   * `visibilitychange` fires reliably when a tab is backgrounded and is the last
   * moment a discarded tab is guaranteed to run code; `pagehide` covers the
   * navigation and close cases. Both write, because neither alone covers every
   * browser.
   */
  private bindLifecycle(): void {
    if (typeof document === "undefined") return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        this.flush();
        void this.checkpoint();
      } else {
        // Timers were throttled while hidden; catch the view up at once.
        this.flush();
      }
    };
    const onPageHide = () => {
      this.flush();
      void this.checkpoint();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    this.teardown.push(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    });
  }

  /**
   * Let go of everything tied to the current run.
   *
   * Awaits the lock actually coming back rather than just asking for it, so a
   * caller that re-acquires immediately afterwards is not competing with itself.
   */
  private async detach(opts: { keepLock?: boolean } = {}): Promise<void> {
    for (const fn of this.teardown) fn();
    this.teardown = [];
    this.channel?.close();
    this.channel = null;

    if (opts.keepLock) return;

    const done = this.lockDone;
    this.releaseLock?.();
    this.releaseLock = null;
    this.lockedRunId = null;
    this.lockDone = null;
    this.driving = false;
    if (done) await done.catch(() => {});
  }

  /** Write everything currently known. Used at boundaries and on the way out. */
  private async checkpoint(): Promise<void> {
    if (!this.run) return;
    try {
      await this.repo().saveRunHeader(this.run);
      await this.repo().saveLanes(this.run.id, this.run.lanes);
    } catch {
      // Storage can be unavailable (private mode, quota). A run that cannot be
      // checkpointed still runs; it just cannot be resumed.
    }
  }

  /* ----------------------------------------------------------------- lanes -- */

  /**
   * Run the lanes stage.
   *
   * `only` restricts the work to specific lane ids, which is what resume and
   * per-lane retry both use. Concurrency is enforced here rather than on the
   * server because each lane is now its own request.
   */
  private async driveLanes(plan: LanePlanResult, only?: string[]): Promise<void> {
    if (!this.run) return;
    const wanted = new Set(only ?? plan.lanes.filter((l) => !l.blocked).map((l) => l.id));
    const queue = plan.lanes.filter((l) => !l.blocked && wanted.has(l.id));
    if (queue.length === 0) {
      this.patchStage("lanes", { status: "done", finishedAt: Date.now() });
      await this.checkpoint();
      return;
    }

    this.patchStage("lanes", { status: "running", startedAt: Date.now() });

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < queue.length) {
        const lane = queue[next++];
        await this.runLane(lane.id, lane.modelId, lane.maxTokens);
      }
    };

    await Promise.all(Array.from({ length: plan.concurrency }, worker));

    const failed = this.run?.lanes.filter((l) => l.status === "error").length ?? 0;
    this.patchStage("lanes", {
      status: "done",
      finishedAt: Date.now(),
      note: failed ? `${failed} lane${failed === 1 ? "" : "s"} failed` : undefined,
    });
    await this.checkpoint();
  }

  private async runLane(id: string, modelId: string, maxTokens: number): Promise<void> {
    if (!this.run) return;
    const runId = this.run.id;
    const controller = new AbortController();
    this.aborts.set(id, controller);

    const buffer = this.buffer(id);
    buffer.text = "";
    buffer.reasoning = "";
    this.patchLane(id, {
      status: "streaming",
      text: "",
      reasoning: "",
      error: undefined,
      errorCode: undefined,
      startedAt: Date.now(),
    });

    try {
      for await (const ev of postSSE<LaneEvent>(
        "/api/v1/compare/lanes",
        {
          runId,
          question: this.run.brief?.task ?? this.run.config.question,
          systemPrompt: this.run.config.systemPrompt,
          temperature: this.run.config.temperature,
          sharedContext: this.contextFor(id),
          history: this.historyFor(id, modelId, maxTokens),
          lanes: [{ id, modelId, maxTokens }],
        },
        controller.signal,
        this.headers,
      )) {
        this.applyLaneEvent(ev);
      }
      this.flush();
    } catch (e) {
      this.flush();
      if (controller.signal.aborted || (e as Error)?.name === "AbortError") {
        // Stop is a decision, not a failure. `stopLane` already set the state.
        return;
      }
      const err = e as SSEHttpError;
      this.patchLane(id, {
        status: "error",
        error: err.message ?? "This lane failed.",
        errorCode: err.code,
        finishedAt: Date.now(),
      });
    } finally {
      this.aborts.delete(id);
      const lane = this.run?.lanes.find((l) => l.id === id);
      if (lane) await this.repo().saveLane(runId, lane).catch(() => {});
      this.broadcast();
    }
  }

  /**
   * The evidence this lane carries.
   *
   * Every lane gets the same pack unless its own context window could not hold
   * it — the retrieval and summarising paths land in Phase 3; until then the
   * shared text is used verbatim.
   */
  /**
   * This lane's own prior answers, fitted to its window.
   *
   * Only this lane's. Handing it another model's text would make every later
   * turn a comparison of how well each model continues someone else's
   * reasoning, which is not the question being asked.
   */
  private historyFor(
    laneId: string,
    modelId: string,
    maxTokens: number,
  ): { role: string; content: string }[] | undefined {
    if (!this.session || this.earlier.length === 0) return undefined;
    const history = laneHistory(this.session, this.earlier, laneId);
    if (history.length === 0) return undefined;

    const model = getModelById(modelId);
    const evidenceTokens = this.run?.evidence ? packTokens(this.run.evidence) : 0;
    const fitted = fitLaneHistory(history, model ?? undefined, maxTokens + evidenceTokens);
    return fitted.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : "",
    }));
  }

  private contextFor(laneId: string): string | undefined {
    const pack = this.run?.evidence;
    if (!pack) return undefined;
    const lane = this.run?.lanes.find((l) => l.id === laneId);
    if (!lane) return undefined;

    const model = getModelById(lane.modelId);
    // What is left of the window once the answer and the scaffolding are
    // reserved. `stuff` ignores it — the planner already decided the pack fits —
    // and the other fits select against it.
    const budget =
      Math.floor((model?.contextWindow ?? 0) * CONTEXT_SAFETY) - lane.maxTokens - PROMPT_OVERHEAD_TOKENS;

    return buildLaneContext(
      pack,
      lane.fit,
      Math.max(0, budget),
      this.run?.brief?.task ?? this.run?.config.question ?? "",
    );
  }

  private applyLaneEvent(ev: LaneEvent): void {
    switch (ev.type) {
      case "lane_meta":
        this.patchLane(ev.id, { provider: ev.provider });
        break;
      case "lane_delta": {
        const b = this.buffer(ev.id);
        b.text += ev.text;
        this.dirty.add(ev.id);
        this.schedule();
        break;
      }
      case "lane_reasoning": {
        const b = this.buffer(ev.id);
        b.reasoning += ev.text;
        this.dirty.add(ev.id);
        this.schedule();
        break;
      }
      case "lane_usage": {
        const lane = this.run?.lanes.find((l) => l.id === ev.id);
        const meters = {
          ...lane?.meters,
          promptTokens: ev.promptTokens,
          completionTokens: ev.completionTokens,
          imageTokens: ev.imageTokens,
        };
        this.patchLane(ev.id, {
          meters: { ...meters, costUsd: laneCost({ modelId: lane?.modelId ?? ev.id, meters }) },
        });
        break;
      }
      case "lane_continue": {
        const lane = this.run?.lanes.find((l) => l.id === ev.id);
        this.patchLane(ev.id, {
          meters: { ...lane?.meters, continuations: (lane?.meters.continuations ?? 0) + 1 },
        });
        break;
      }
      case "lane_done": {
        this.flush();
        const lane = this.run?.lanes.find((l) => l.id === ev.id);
        this.patchLane(ev.id, {
          status: "done",
          finishReason: ev.finishReason,
          finishedAt: Date.now(),
          meters: {
            ...lane?.meters,
            totalMs: ev.ms,
            ttftMs: ev.ttftMs,
            failovers: ev.failovers,
            continuations: ev.continuations ?? lane?.meters.continuations,
            // `length` after the continuation budget ran out is a genuinely
            // unfinished answer, and the UI has to be able to say so.
            truncated: ev.finishReason === "length",
          },
        });
        break;
      }
      case "lane_error":
        this.flush();
        this.patchLane(ev.id, {
          status: "error",
          error: ev.message,
          errorCode: ev.code,
          finishedAt: Date.now(),
        });
        break;
    }
  }

  /* -------------------------------------------------------------- controls -- */

  /** Stop one lane. The others keep streaming. */
  stopLane(id: string): void {
    this.flush();
    this.patchLane(id, { status: "stopped", finishedAt: Date.now() });
    this.aborts.get(id)?.abort();
    this.aborts.delete(id);
  }

  /** Stop everything still in flight. */
  stopAll(): void {
    this.flush();
    for (const [id, controller] of this.aborts) {
      // The evidence stage shares the abort map but is not a lane, so patching a
      // lane by that key would be a silent no-op rather than an error.
      if (id === EVIDENCE_KEY) {
        this.patchStage("evidence", { status: "done", finishedAt: Date.now(), note: "Stopped" });
      } else if (id === SYNTHESIS_KEY) {
        this.patchStage("synthesis", { status: "done", finishedAt: Date.now(), note: "Stopped" });
      } else {
        this.patchLane(id, { status: "stopped", finishedAt: Date.now() });
      }
      controller.abort();
    }
    this.aborts.clear();
  }

  /** Re-run one lane from scratch. Used for the failed-lane retry. */
  async retryLane(id: string, env: RouteEnv): Promise<void> {
    if (!this.run || !this.driving) return;
    const lane = this.run.lanes.find((l) => l.id === id);
    if (!lane || lane.blocked) return;
    // Planned against the evidence that actually exists, not against an empty
    // pack: without this a retry gets a larger `maxTokens` and possibly a
    // `stuff` fit for a window that cannot hold the pack, so the retry fails
    // differently from the attempt it is repeating.
    const plan = planLanes({
      config: this.run.config,
      env,
      evidenceTokens: this.run.evidence ? packTokens(this.run.evidence) : 0,
    });
    const planned = plan.lanes.find((l) => l.id === id);
    if (planned) this.patchLane(id, { fit: planned.fit, maxTokens: planned.maxTokens });
    await this.runLane(id, lane.modelId, planned?.maxTokens ?? lane.maxTokens);
  }

  /** Drop the run from memory. Storage keeps it; history can reopen it. */
  close(): void {
    this.stopAll();
    void this.checkpoint();
    void this.detach();
    this.run = null;
    this.session = null;
    this.earlier = [];
    this.view = null;
    this.buffers.clear();
    this.dirty.clear();
    this.emit();
  }
}

/**
 * Fold a freshly-computed plan into the lanes already on screen.
 *
 * Lanes are planned twice — once at `start`, so the grid has cards to render
 * immediately, and again once the evidence pack's size is known, which is what
 * decides each lane's context fit and output ceiling. Merging rather than
 * replacing keeps whatever a lane has already streamed.
 */
function mergeLanes(existing: LaneState[], planned: LanePlan[]): LaneState[] {
  const byId = new Map(existing.map((l) => [l.id, l]));
  return planned.map((plan) => {
    const current = byId.get(plan.id);
    if (!current) return emptyLane(plan);
    return { ...current, fit: plan.fit, maxTokens: plan.maxTokens, budgetUsd: plan.budgetUsd };
  });
}

/**
 * The singleton.
 *
 * Module scope is the point: it survives every unmount and every route change
 * inside the app, which is exactly what "the run keeps going when you switch
 * tabs" requires.
 */
export const compareRuntime = new CompareRuntime();
