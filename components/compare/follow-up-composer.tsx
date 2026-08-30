"use client";

import * as React from "react";
import { RefreshCw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Ask the next question.
 *
 * Replaces the full composer once a session exists. The lane set, the depth and
 * the evidence are the session's now, so none of them are re-asked — the only
 * decisions left on a follow-up are what to ask and whether the answer needs new
 * sources.
 *
 * The suggestions above it come from where the models actually disagreed, which
 * turns the divergence analysis from something you read into something you act
 * on.
 */

export interface FollowUpComposerProps {
  onAsk: (question: string, opts: { refreshEvidence: boolean }) => void;
  /** Questions derived from this session's disagreements. */
  suggestions?: string[];
  disabled?: boolean;
  /** False in a tab that is following another tab's session. */
  canAsk?: boolean;
  placeholder?: string;
}

export function FollowUpComposer({
  onAsk,
  suggestions = [],
  disabled,
  canAsk = true,
  placeholder = "Ask a follow-up. Every model keeps its own thread.",
}: FollowUpComposerProps) {
  const [question, setQuestion] = React.useState("");
  const [refresh, setRefresh] = React.useState(false);
  const box = React.useRef<HTMLTextAreaElement | null>(null);

  const ready = Boolean(question.trim()) && !disabled && canAsk;

  const ask = React.useCallback(() => {
    if (!ready) return;
    onAsk(question.trim(), { refreshEvidence: refresh });
    setQuestion("");
    // The toggle is per-question, not a mode: leaving it on would quietly
    // re-research every later turn and multiply the session's cost.
    setRefresh(false);
  }, [onAsk, question, ready, refresh]);

  return (
    <div className="space-y-2">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs uppercase tracking-legend text-muted-foreground/70">
            They disagreed on
          </span>
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => {
                setQuestion(s);
                box.current?.focus();
              }}
              disabled={disabled}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-2/60 px-2.5 py-1 text-2xs text-muted-foreground transition-colors hover:border-action/40 hover:text-foreground disabled:opacity-50"
            >
              <Sparkles className="size-3 shrink-0" />
              <span className="truncate">{s}</span>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface/50 p-3 shadow-glow">
        <textarea
          ref={box}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
          }}
          rows={2}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Follow-up question"
          className="w-full resize-none bg-transparent text-body outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setRefresh((r) => !r)}
                disabled={disabled}
                aria-pressed={refresh}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-2xs transition-colors disabled:opacity-50",
                  refresh
                    ? "border-action/40 bg-action/10 text-foreground"
                    : "border-border bg-surface-2/60 text-muted-foreground hover:border-border-strong hover:text-foreground",
                )}
              >
                <RefreshCw className="size-3.5" />
                Research again
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              This session reuses the sources it already gathered, so citation numbers keep meaning
              the same thing. Turn this on when the follow-up needs facts the first search did not
              cover.
            </TooltipContent>
          </Tooltip>

          <Button variant="primary" size="sm" className="ml-auto" onClick={ask} disabled={!ready}>
            <Send className="size-4" /> Ask
          </Button>
        </div>
      </div>

      {!canAsk && (
        <p className="text-2xs text-muted-foreground">
          Another tab is running this session, so follow-ups are off here.
        </p>
      )}
    </div>
  );
}
