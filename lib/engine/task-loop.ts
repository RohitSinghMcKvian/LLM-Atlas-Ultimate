// The Task Loop (Depth Spec v2 A.1): the state machine that turns ONE prompt
// into a completed, verified task.
//
//   INTAKE → CLARIFY? → EXPLORE → PLAN → (approve) → EXECUTE ⇄ VERIFY
//     → SELF-CORRECT (bounded) → REVIEW → DELIVER
//
// Design: a pure reducer (`taskReducer`, exhaustively unit-tested) drives all
// state transitions; the async driver (`runTaskLoop`) sequences phases by
// calling `runAgent` once per phase through the injected TaskPorts. Trivial
// tasks degrade to a single legacy-style agent call — no ceremony.

import { debugProtocol, hasDebugMarkers } from "./debug";
import { intakeSystemPrompt, intakeUserPrompt, parseIntake } from "./intake";
import type { AgentPhaseResult, TaskPorts } from "./ports";
import { parseSetTodos, SET_TODOS_TOOL, UPDATE_TODO_TOOL } from "./task-tools";
import type {
  Phase,
  ReportCard,
  TaskClassification,
  TaskState,
  Todo,
  TodoStatus,
  Verdict,
} from "./types";
import { describeFailures, detectChecks, runChecks, type CheckDef } from "./verify";

// ── Reducer (pure, tested) ──────────────────────────────────────────────────

export type TaskEvent =
  | { type: "classified"; classification: TaskClassification; questions: string[] }
  | { type: "phase"; phase: Phase }
  | { type: "explored"; summary: string }
  | { type: "planned"; todos: Todo[] }
  | { type: "todos_edited"; todos: Todo[] }
  | { type: "todo_active"; id: string }
  | { type: "todo_status"; id: string; status: TodoStatus }
  | { type: "verdicts"; todoId: string; verdicts: Verdict[] }
  /** One self-correct attempt. REJECTED (state unchanged) when the strategy
   *  repeats the previous one or the budget is exhausted. */
  | { type: "attempt"; todoId: string; strategy: string }
  | { type: "steering_queued"; text: string }
  | { type: "steering_drained" }
  | { type: "paused"; paused: boolean }
  | { type: "report"; report: ReportCard }
  | { type: "stopped" };

export function initialTaskState(id: string, goal: string, attemptBudget = 3): TaskState {
  return {
    id,
    goal,
    phase: "intake",
    classification: "bounded",
    todos: [],
    attemptBudget,
    steeringQueue: [],
    paused: false,
    stopAfterStep: false,
  };
}

/** Can this todo consume another self-correct attempt with this strategy? */
export function canAttempt(state: TaskState, todoId: string, strategy: string): boolean {
  const todo = state.todos.find((t) => t.id === todoId);
  if (!todo) return false;
  if (todo.attempts >= state.attemptBudget) return false;
  const last = todo.strategyLog[todo.strategyLog.length - 1];
  // Retrying the identical fix is prohibited (A.1) — a strategy change is
  // required between attempts.
  if (last !== undefined && last.trim().toLowerCase() === strategy.trim().toLowerCase())
    return false;
  return true;
}

export function taskReducer(state: TaskState, ev: TaskEvent): TaskState {
  switch (ev.type) {
    case "classified":
      return { ...state, classification: ev.classification };
    case "phase":
      return { ...state, phase: ev.phase };
    case "explored":
      return { ...state, exploreSummary: ev.summary };
    case "planned":
    case "todos_edited":
      return { ...state, todos: ev.todos };
    case "todo_active":
      return {
        ...state,
        todos: state.todos.map((t) =>
          t.id === ev.id ? { ...t, status: "active" } : t,
        ),
      };
    case "todo_status":
      return {
        ...state,
        todos: state.todos.map((t) => (t.id === ev.id ? { ...t, status: ev.status } : t)),
      };
    case "verdicts":
      return {
        ...state,
        todos: state.todos.map((t) =>
          t.id === ev.todoId ? { ...t, verdicts: [...t.verdicts, ...ev.verdicts] } : t,
        ),
      };
    case "attempt": {
      if (!canAttempt(state, ev.todoId, ev.strategy)) return state;
      return {
        ...state,
        todos: state.todos.map((t) =>
          t.id === ev.todoId
            ? { ...t, attempts: t.attempts + 1, strategyLog: [...t.strategyLog, ev.strategy] }
            : t,
        ),
      };
    }
    case "steering_queued":
      return { ...state, steeringQueue: [...state.steeringQueue, ev.text] };
    case "steering_drained":
      return { ...state, steeringQueue: [] };
    case "paused":
      return { ...state, paused: ev.paused };
    case "report":
      return { ...state, report: ev.report };
    case "stopped":
      return { ...state, phase: "stopped" };
  }
}

// ── Phase prompts ───────────────────────────────────────────────────────────

const EXPLORE_PROMPT = `You are Atlas Code in EXPLORE phase — build a mental map BEFORE anything is edited. Your tools are read-only.

Investigate: entry points, conventions, existing utilities worth reusing, and how the project is tested/verified. Delegate broad sweeps to spawn_subagent.

Finish with an "Explore summary" (markdown, ≤300 words): relevant files with one-line roles, conventions to follow, and anything that constrains the plan.`;

const PLAN_PROMPT = `You are Atlas Code in PLAN phase. Using the explore summary and read-only investigation, produce the plan as a STRUCTURED todo list.

Call the set_todos tool exactly once with 2–8 todos. Each todo:
- text: one concrete step (smallest-diff-first; prefer editing over rewriting)
- acceptance: a machine-checkable done-condition (a command that must pass, or an observable result)

After set_todos, stop calling tools and reply with a one-paragraph rationale.`;

const executePrompt = (
  todo: Todo,
  exploreSummary: string | undefined,
  goal: string,
) => `You are Atlas Code executing ONE todo of an approved plan. Work on THIS todo only — do not start other todos.

Overall goal: ${goal}
${exploreSummary ? `\nExplore summary:\n${exploreSummary}\n` : ""}
Current todo: ${todo.text}
Acceptance criterion: ${todo.acceptance}

Rules:
- Read before editing; prefer edit_file with minimal, surgical diffs.
- Verify your own work with run_command where cheap (the harness runs the full check ladder after you finish).
- Never delete or weaken a failing test to make it pass. Never silence errors with empty catch blocks. Never hard-code expected values to satisfy an assertion.
- When the acceptance criterion is met, call update_todo with status "done", then reply with a 1-2 sentence summary. If you cannot meet it, call update_todo with status "failed" and explain.`;

const selfCorrectPrompt = (
  todo: Todo,
  failures: string,
  priorStrategies: string[],
  protocol: string,
) => `Verification FAILED for the current todo. Fix it.

Todo: ${todo.text}
Acceptance: ${todo.acceptance}

Failure evidence:
${failures}

${priorStrategies.length ? `Strategies already tried (you MUST take a different approach):\n${priorStrategies.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n` : ""}
Debugging protocol (A.3):
${protocol}

Start your reply with one line: "STRATEGY: <your new approach in one sentence>". Do not retry an identical fix. Never delete tests, hard-code expected values, or add empty catch blocks.`;

const REVIEW_PROMPT = `You are a fresh-context REVIEWER. You did not write this change. Read the original request and the diff below, then investigate the workspace read-only as needed.

Report (markdown, ≤200 words):
- Does the change satisfy the request? Any misses?
- Dead code, leftover TODOs/debug logging, deleted or weakened tests?
- Verdict line: "REVIEW: pass" or "REVIEW: concerns".`;

// ── Driver ──────────────────────────────────────────────────────────────────

export interface TaskLoopOptions {
  taskId: string;
  goal: string;
  ports: TaskPorts;
  attemptBudget?: number;
  signal?: AbortSignal;
  /** Observe every state transition (the store mirrors this into zustand). */
  onState?: (s: TaskState) => void;
}

const STRATEGY_RE = /STRATEGY:\s*(.+)/i;
const MAX_REVIEW_DIFF = 12_000;

export async function runTaskLoop(opts: TaskLoopOptions): Promise<TaskState> {
  const { ports, signal } = opts;
  let state = initialTaskState(opts.taskId, opts.goal, opts.attemptBudget ?? 3);

  const emit = (ev: TaskEvent) => {
    state = taskReducer(state, ev);
    opts.onState?.(state);
  };
  const phase = (to: Phase, note?: string) => {
    const from = state.phase;
    emit({ type: "phase", phase: to });
    ports.trace({
      kind: "phase_change",
      id: ports.uid(),
      taskId: state.id,
      from,
      to,
      note,
    });
  };
  const traceTodos = () =>
    ports.trace({ kind: "todo", id: ports.uid(), taskId: state.id, todos: state.todos });
  const aborted = () => signal?.aborted ?? false;
  const boundary = async () => {
    if (aborted()) throw new DOMException("aborted", "AbortError");
    await ports.gate?.();
  };

  try {
    // ── INTAKE ──────────────────────────────────────────────────────────────
    const paths = await ports.listPaths().catch(() => [] as string[]);
    const intakeRaw = await ports
      .llm(intakeSystemPrompt(), intakeUserPrompt(opts.goal, paths.slice(0, 200).join("\n")), 400)
      .catch(() => "");
    const intake = parseIntake(intakeRaw);
    emit({ type: "classified", classification: intake.classification, questions: intake.questions });
    ports.trace({
      kind: "system",
      id: ports.uid(),
      taskId: state.id,
      text: `Intake: ${intake.classification}${
        intake.assumptions.length ? ` — assuming: ${intake.assumptions.join("; ")}` : ""
      }`,
      tone: "info",
    });

    // Trivial ⇒ exactly the pre-v2 single agent call. No ceremony.
    if (intake.classification === "trivial") {
      phase("execute");
      await ports.agent({ goal: opts.goal, phase: "execute", readonly: false });
      phase("done");
      return state;
    }

    // ── CLARIFY (batched, once) ─────────────────────────────────────────────
    let goalContext = opts.goal;
    if (intake.questions.length && ports.clarify) {
      phase("clarify");
      const answer = await ports.clarify(intake.questions);
      await boundary();
      if (answer?.trim()) {
        goalContext += `\n\nClarifications from the user:\n${answer.trim()}`;
        ports.trace({
          kind: "steering",
          id: ports.uid(),
          taskId: state.id,
          text: answer.trim(),
        });
      }
    }

    // ── EXPLORE (complex only) ──────────────────────────────────────────────
    if (state.classification === "complex") {
      await boundary();
      phase("explore");
      const res = await ports.agent({
        goal: `Explore the workspace to prepare for this task:\n${goalContext}`,
        phase: "explore",
        readonly: true,
        systemPrompt: EXPLORE_PROMPT,
      });
      if (res.summary.trim()) emit({ type: "explored", summary: res.summary.trim() });
    }

    // ── PLAN ────────────────────────────────────────────────────────────────
    let todos: Todo[] | null = null;
    if (state.classification === "complex") {
      await boundary();
      phase("plan");
      let captured: Todo[] | null = null;
      await ports.agent({
        goal: `Plan this task as todos:\n${goalContext}`,
        phase: "plan",
        readonly: true,
        systemPrompt: PLAN_PROMPT,
        extraTools: [SET_TODOS_TOOL],
        onCustomTool: async (name, argsJson) => {
          if (name !== "set_todos") return null;
          const parsed = parseSetTodos(argsJson, ports.uid);
          if (!parsed) return { result: "set_todos needs a non-empty todos array.", isError: true };
          captured = parsed;
          return { result: `Plan recorded (${parsed.length} todos).`, display: `${parsed.length} todos` };
        },
      });
      // Assertion: `captured` is assigned inside the onCustomTool closure,
      // which TS's control-flow narrowing can't see.
      todos = captured as Todo[] | null;
    }
    // Bounded tasks — or a plan phase that never called set_todos — get one
    // implicit todo so verify/self-correct still apply.
    if (!todos || todos.length === 0) {
      todos = [
        {
          id: ports.uid(),
          text: goalContext.split("\n")[0].slice(0, 200),
          acceptance: "the change is applied and the project's checks pass",
          status: "pending",
          verdicts: [],
          attempts: 0,
          strategyLog: [],
        },
      ];
    }

    // A.2: tests are part of the task. If the project has no test check and
    // this isn't trivial, add a todo to write them.
    const pkgJson = await ports.readFile("package.json");
    const checks: CheckDef[] = detectChecks(pkgJson, paths);
    if (!checks.some((c) => c.check === "unit")) {
      todos.push({
        id: ports.uid(),
        text: "Add minimal tests covering the change (happy path + one edge case)",
        acceptance: "the new tests run and pass via a project command",
        status: "pending",
        verdicts: [],
        attempts: 0,
        strategyLog: [],
      });
    }

    emit({ type: "planned", todos });
    traceTodos();

    // Plan approval (Ask-mode UX) — edited todos come back, null stops.
    if (ports.approvePlan) {
      const approved = await ports.approvePlan(state.todos);
      await boundary();
      if (approved === null) {
        phase("stopped", "plan discarded");
        return state;
      }
      if (approved !== state.todos) {
        emit({ type: "todos_edited", todos: approved });
        traceTodos();
      }
    }

    // ── EXECUTE ⇄ VERIFY ⇄ SELF-CORRECT ────────────────────────────────────
    // Re-detect checks lazily after the first todo (it may add a test script).
    let liveChecks = checks;
    for (const todo of state.todos) {
      await boundary();

      // Steering messages join between todos (the host traces them at queue
      // time, so they're already visible in the timeline).
      const steering = ports.drainSteering?.() ?? [];
      let steeringNote = "";
      if (steering.length) {
        emit({ type: "steering_drained" });
        steeringNote = `\n\nUser update (take into account): ${steering.join(" | ")}`;
      }

      emit({ type: "todo_active", id: todo.id });
      traceTodos();
      await ports.snapshot(`todo: ${todo.text.slice(0, 48)}`);
      const changeMarker = ports.changeCount?.() ?? 0;

      phase("execute");
      const runExec = (goal: string): Promise<AgentPhaseResult> =>
        ports.agent({
          goal,
          phase: "execute",
          readonly: false,
          systemPrompt: undefined, // built-in execute prompt (rules live in the goal)
          extraTools: [UPDATE_TODO_TOOL],
          onCustomTool: async (name, argsJson) => {
            if (name !== "update_todo") return null;
            try {
              const args = JSON.parse(argsJson || "{}");
              return { result: `Recorded: todo ${args.status}.`, display: `todo ${args.status}` };
            } catch {
              return { result: "update_todo needs {status}.", isError: true };
            }
          },
        });

      await runExec(executePrompt(todo, state.exploreSummary, goalContext) + steeringNote);

      // ── VERIFY ────────────────────────────────────────────────────────────
      phase("verify");
      const pkgNow = await ports.readFile("package.json");
      liveChecks = detectChecks(pkgNow, await ports.listPaths().catch(() => paths));
      const runLadder = async (): Promise<Verdict[]> => {
        const verdicts = await runChecks(liveChecks, ports.exec, {
          onVerdict: (v) =>
            ports.trace({
              kind: "verdict",
              id: ports.uid(),
              taskId: state.id,
              phase: "verify",
              verdict: v,
              todoId: todo.id,
            }),
        });
        const smoke = await ports.smoke?.().catch(() => null);
        if (smoke) {
          verdicts.push(smoke);
          ports.trace({
            kind: "verdict",
            id: ports.uid(),
            taskId: state.id,
            phase: "verify",
            verdict: smoke,
            todoId: todo.id,
          });
        }
        // A.3: leftover instrumentation is a failure — the agent must remove
        // every ATLAS-DEBUG line before a todo can pass.
        if (verdicts.every((v) => v.pass)) {
          const dirty = ports
            .changes()
            .filter((c) => c.after !== null && hasDebugMarkers(c.after!))
            .map((c) => c.path);
          if (dirty.length) {
            const v: Verdict = {
              check: "custom",
              command: "scan for ATLAS-DEBUG instrumentation markers",
              pass: false,
              evidence: `Temporary instrumentation left behind in: ${[...new Set(dirty)].join(", ")}. Remove every line containing ATLAS-DEBUG.`,
              durationMs: 0,
              ts: Date.now(),
            };
            verdicts.push(v);
            ports.trace({
              kind: "verdict",
              id: ports.uid(),
              taskId: state.id,
              phase: "verify",
              verdict: v,
              todoId: todo.id,
            });
          }
        }
        return verdicts;
      };

      let verdicts = await runLadder();
      emit({ type: "verdicts", todoId: todo.id, verdicts });

      // ── SELF-CORRECT (bounded; strategy change required) ──────────────────
      while (verdicts.some((v) => !v.pass)) {
        await boundary();
        phase("self_correct");
        const failures = describeFailures(verdicts);
        const prior = state.todos.find((t) => t.id === todo.id)?.strategyLog ?? [];
        if (prior.length >= state.attemptBudget) break;

        // A.3 hypothesis-driven protocol: stack frames + escalation ladder.
        const { prompt: protocol } = debugProtocol(
          failures,
          prior.length,
          ports.hasCheckpoints?.() ?? false,
        );
        const res = await runExec(selfCorrectPrompt(todo, failures, prior, protocol));
        const strategy =
          STRATEGY_RE.exec(res.summary)?.[1]?.trim() ||
          `attempt ${prior.length + 1}: unstated strategy`;
        const before = state;
        emit({ type: "attempt", todoId: todo.id, strategy });
        if (state === before) {
          // Rejected — identical strategy or exhausted budget. Stop retrying.
          ports.trace({
            kind: "system",
            id: ports.uid(),
            taskId: state.id,
            text: `Self-correct stopped: ${
              prior[prior.length - 1]?.toLowerCase() === strategy.toLowerCase()
                ? "the agent repeated its previous strategy"
                : "attempt budget exhausted"
            }.`,
            tone: "error",
          });
          break;
        }
        ports.trace({
          kind: "hypothesis",
          id: ports.uid(),
          taskId: state.id,
          phase: "self_correct",
          text: strategy,
          todoId: todo.id,
        });

        phase("verify");
        verdicts = await runLadder();
        emit({ type: "verdicts", todoId: todo.id, verdicts });
      }

      const pass = verdicts.every((v) => v.pass);
      emit({ type: "todo_status", id: todo.id, status: pass ? "done" : "failed" });
      traceTodos();

      // B.3: group this todo's edits into a reviewable change set.
      if (ports.reviewChangeSet && ports.changesSince) {
        const records = ports.changesSince(changeMarker);
        if (records.length) {
          await ports.reviewChangeSet(
            records,
            `${todo.text.slice(0, 48)}`,
            ports.lastCheckpointId?.() ?? "",
            todo.id,
          );
          await boundary();
        }
      }

      // A.6: stop-after-current-step — graceful, not a kill.
      if (ports.shouldStopAfterStep?.()) {
        phase("stopped", "stopped after current step");
        return state;
      }
    }

    // ── REVIEW (fresh context; complex only) ───────────────────────────────
    if (state.classification === "complex") {
      await boundary();
      phase("review");
      const diffs = ports
        .changes()
        .map(
          (c) =>
            `--- ${c.path}\n${c.before === null ? "(new file)" : ""}${
              c.after === null ? "(deleted)" : c.after.slice(0, 2_000)
            }`,
        )
        .join("\n\n")
        .slice(0, MAX_REVIEW_DIFF);
      const review = await ports.agent({
        goal: `Original request:\n${goalContext}\n\nDiff (truncated):\n${diffs || "(no changes recorded)"}`,
        phase: "review",
        readonly: true,
        systemPrompt: REVIEW_PROMPT,
        history: [],
      });
      if (review.summary.trim())
        ports.trace({
          kind: "system",
          id: ports.uid(),
          taskId: state.id,
          text: `Reviewer: ${review.summary.trim().slice(0, 1_500)}`,
          tone: review.summary.includes("REVIEW: concerns") ? "error" : "info",
        });
    }

    // ── DELIVER ─────────────────────────────────────────────────────────────
    phase("deliver");
    const changes = ports.changes();
    const fileKinds = new Map<string, "new" | "modified" | "deleted">();
    for (const c of changes) {
      if (c.after === null) fileKinds.set(c.path, "deleted");
      else if (!fileKinds.has(c.path)) fileKinds.set(c.path, c.before === null ? "new" : "modified");
    }
    const allVerdicts = state.todos.flatMap((t) => t.verdicts);
    const usage = ports.usage?.() ?? { costUsd: 0, tokens: 0 };
    const report: ReportCard = {
      files: [...fileKinds.entries()].map(([path, kind]) => ({ path, kind })),
      commands: [...new Set(allVerdicts.map((v) => v.command))],
      verdicts: allVerdicts,
      verified: [
        ...new Set(allVerdicts.filter((v) => v.pass).map((v) => `${v.check} (${v.command})`)),
      ],
      assumed: intake.assumptions,
      leftUndone: state.todos.filter((t) => t.status === "failed").map((t) => t.text),
      costUsd: usage.costUsd,
      tokens: usage.tokens,
    };
    emit({ type: "report", report });

    // B.1 ATLAS.md learning: propose durable conventions from this task.
    if (ports.proposeAtlasMd && report.files.length) {
      const summary = [
        `Goal: ${opts.goal}`,
        `Files: ${report.files.map((f) => `${f.kind} ${f.path}`).join(", ")}`,
        `Verified: ${report.verified.join("; ") || "none"}`,
        state.exploreSummary ? `Notes: ${state.exploreSummary.slice(0, 800)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      await ports.proposeAtlasMd(summary).catch(() => false);
    }

    phase("done");
    return state;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      emit({ type: "stopped" });
      return state;
    }
    ports.trace({
      kind: "system",
      id: ports.uid(),
      taskId: state.id,
      text: `Task loop error: ${(e as Error).message}`,
      tone: "error",
    });
    emit({ type: "stopped" });
    return state;
  }
}
