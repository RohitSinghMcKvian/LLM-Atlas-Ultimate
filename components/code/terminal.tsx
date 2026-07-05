"use client";

import * as React from "react";
import { Eraser } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TermLine {
  text: string;
  tone?: "cmd" | "ok" | "err" | "dim";
}

export function Terminal({
  lines,
  active,
  runtimeLabel = "sandbox",
  onCommand,
  onClear,
}: {
  lines: TermLine[];
  active: boolean;
  runtimeLabel?: string;
  /** When provided, renders an input row that executes shell commands. */
  onCommand?: (cmd: string) => void;
  onClear?: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [cmd, setCmd] = React.useState("");
  const [historyIdx, setHistoryIdx] = React.useState(-1);
  const history = React.useRef<string[]>([]);

  React.useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines]);

  function submit() {
    const c = cmd.trim();
    if (!c || !onCommand) return;
    history.current.unshift(c);
    setHistoryIdx(-1);
    setCmd("");
    onCommand(c);
  }

  return (
    <div className="flex h-full flex-col bg-[#0b0d14]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Terminal
        </span>
        <span className="ml-auto font-mono text-2xs text-muted-foreground/60">
          {runtimeLabel}
        </span>
        {onClear && lines.length > 0 && (
          <button
            title="Clear terminal"
            onClick={onClear}
            className="text-muted-foreground/60 hover:text-foreground"
          >
            <Eraser className="size-3.5" />
          </button>
        )}
      </div>
      <div
        ref={ref}
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed"
      >
        {lines.length === 0 && (
          <div className="text-muted-foreground/50">
            $ <span className="opacity-60">run a command, or let the agent work…</span>
          </div>
        )}
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-all",
              l.tone === "ok" && "text-success",
              l.tone === "err" && "text-danger",
              l.tone === "cmd" && "text-cyan",
              l.tone === "dim" && "text-muted-foreground/60",
              !l.tone && "text-foreground/85",
            )}
          >
            {l.text}
          </div>
        ))}
        {active && (
          <span className="inline-block h-3.5 w-2 animate-caret-blink bg-cyan align-middle" />
        )}
      </div>
      {onCommand && (
        <div className="flex items-center gap-2 border-t border-border/60 px-3 py-1.5">
          <span className="font-mono text-xs text-cyan">$</span>
          <input
            value={cmd}
            onChange={(e) => {
              setCmd(e.target.value);
              setHistoryIdx(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              else if (e.key === "ArrowUp") {
                e.preventDefault();
                const next = Math.min(historyIdx + 1, history.current.length - 1);
                if (history.current[next] !== undefined) {
                  setHistoryIdx(next);
                  setCmd(history.current[next]);
                }
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                const next = historyIdx - 1;
                setHistoryIdx(next);
                setCmd(next < 0 ? "" : history.current[next]);
              }
            }}
            placeholder="npm test"
            spellCheck={false}
            className="h-6 flex-1 bg-transparent font-mono text-[12px] outline-none placeholder:text-muted-foreground/40"
          />
        </div>
      )}
    </div>
  );
}
