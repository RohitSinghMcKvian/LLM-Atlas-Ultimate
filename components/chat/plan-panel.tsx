"use client";

import * as React from "react";
import { Check, ChevronRight, Loader2, ListChecks, Pencil, Square, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import type { ChatPlan } from "@/lib/agent/plan";
import { planProgress } from "@/lib/agent/plan";
import { cn } from "@/lib/utils";

/**
 * The plan a multi-step turn will follow, and the gate in front of it.
 *
 * The whole point of plan mode is that the user sees what Atlas intends *before*
 * it acts, so this panel is the approval gate itself, not a progress readout
 * that happens to appear first. Two consequences shape it:
 *
 *  - **A draft is editable.** Approving a plan you cannot change is a worse
 *    prompt than no plan at all — the only options would be accept-all or
 *    start-over. Steps can be reworded or dropped while the plan is a draft, and
 *    `lib/agent/plan.ts` refuses those edits in every other state.
 *  - **Approve is never the default action.** There is no auto-approve after a
 *    timeout and no "always approve" checkbox. A plan can call tools that touch
 *    real accounts, and the run costs several model calls.
 *
 * Rendering only; every transition goes through the pure state machine.
 */
export function PlanPanel({
  plan,
  busy,
  onApprove,
  onReject,
  onEditStep,
  onRemoveStep,
  onAbort,
  onDismiss,
}: {
  plan: ChatPlan;
  /** True while a step is streaming, so edits and re-approval stay disabled. */
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEditStep: (stepId: string, text: string) => void;
  onRemoveStep: (stepId: string) => void;
  onAbort: () => void;
  onDismiss: () => void;
}) {
  const [editing, setEditing] = React.useState<{ id: string; text: string } | null>(null);
  const draft = plan.status === "draft";
  const running = plan.status === "running";
  const { done, total, failed } = planProgress(plan);

  // A draft is the approval gate, so it never folds — hiding what you are about
  // to approve behind a chevron is the one thing this panel must not do. A live
  // plan stays open too, because the step list *is* the progress. A finished one
  // folds: it sits directly above the composer, and by then it is history.
  const foldable = !draft && !running;
  const [open, setOpen] = React.useState(true);
  const wasFoldable = React.useRef(foldable);
  React.useEffect(() => {
    if (foldable && !wasFoldable.current) setOpen(false);
    wasFoldable.current = foldable;
  }, [foldable]);
  // Same rule as the activity row: a failure is never collapsed over.
  React.useEffect(() => {
    if (failed) setOpen(true);
  }, [failed]);
  const shown = !foldable || open;

  const summary = draft
    ? "Plan — review before Atlas starts"
    : running
      ? `Running step ${Math.min(done + 1, total)} of ${total}`
      : plan.status === "done"
        ? failed
          ? `Plan finished — ${done} of ${total} done, ${failed} failed`
          : `Plan complete — ${total} step${total === 1 ? "" : "s"}`
        : plan.status === "aborted"
          ? (plan.stoppedBy ?? "Plan stopped")
          : "Plan rejected";

  return (
    <div
      className={cn(
        "mx-auto mb-3 max-w-3xl rounded-xl border px-3 py-2.5",
        draft ? "border-accent/40 bg-accent/[0.06]" : "border-border bg-surface-2/40",
      )}
    >
      <div className="flex items-center gap-2">
        {/* The disclosure and the dismiss are siblings, not nested: one button
            inside another is invalid, and the two do different things. */}
        <button
          type="button"
          onClick={() => foldable && setOpen((v) => !v)}
          aria-expanded={foldable ? shown : undefined}
          disabled={!foldable}
          className={cn(
            "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left sm:min-h-0",
            foldable && "-mx-1 px-1 hover:bg-surface-2/60",
          )}
        >
          {running ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-action" />
          ) : (
            <ListChecks className={cn("size-3.5 shrink-0", draft ? "text-accent" : "text-action")} />
          )}
          <span className="min-w-0 flex-1 truncate text-2xs font-medium">{summary}</span>
          {foldable && (
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                shown && "rotate-90",
              )}
            />
          )}
        </button>
        {foldable && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss plan"
            className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2/60 hover:text-foreground sm:size-6"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <Collapsible open={shown}>
      <p className="mt-1 break-words pl-5 text-2xs text-muted-foreground">{plan.goal}</p>

      <ol className="mt-1.5 space-y-1">
        {plan.steps.map((s, i) => (
          <li key={s.id} className="flex items-start gap-2 pl-5 text-xs">
            <StepMark status={s.status} index={i} />
            {editing?.id === s.id ? (
              <input
                autoFocus
                value={editing.text}
                onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onEditStep(s.id, editing.text);
                    setEditing(null);
                  }
                  if (e.key === "Escape") setEditing(null);
                }}
                onBlur={() => {
                  onEditStep(s.id, editing.text);
                  setEditing(null);
                }}
                aria-label={`Step ${i + 1}`}
                className="min-w-0 flex-1 rounded border border-accent/40 bg-surface px-1.5 py-0.5 text-xs outline-none"
              />
            ) : (
              <span
                className={cn(
                  "min-w-0 flex-1",
                  s.status === "done" && "text-muted-foreground",
                  s.status === "failed" && "text-danger",
                )}
              >
                {s.text}
              </span>
            )}
            {draft && !editing && (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => setEditing({ id: s.id, text: s.text })}
                  aria-label={`Edit step ${i + 1}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3" />
                </button>
                {/* Hidden on the last step: removing it would leave nothing to
                    approve, and the state machine refuses it anyway. */}
                {plan.steps.length > 1 && (
                  <button
                    onClick={() => onRemoveStep(s.id)}
                    aria-label={`Remove step ${i + 1}`}
                    className="text-muted-foreground hover:text-danger"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>

      {draft && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-5">
          <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
            Atlas will run these one at a time. Nothing happens until you approve.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onReject}
            disabled={busy}
          >
            Discard
          </Button>
          <Button size="sm" onClick={onApprove} disabled={busy}>
            <Check className="size-3.5" /> Approve &amp; run
          </Button>
        </div>
      )}

      {running && (
        <div className="mt-2 flex justify-end pl-5">
          <Button variant="danger" size="sm" onClick={onAbort}>
            <Square className="size-3.5" /> Stop plan
          </Button>
        </div>
      )}
      </Collapsible>
    </div>
  );
}

function StepMark({ status, index }: { status: string; index: number }) {
  if (status === "active") return <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-action" />;
  if (status === "done") return <Check className="mt-0.5 size-3 shrink-0 text-action" />;
  if (status === "failed") return <X className="mt-0.5 size-3 shrink-0 text-danger" />;
  return (
    <span className="mt-px w-3 shrink-0 text-center text-2xs text-muted-foreground">
      {index + 1}
    </span>
  );
}
