"use client";

// ATLAS.md learning (Depth v2 B.1): after a task, the agent proposes durable
// conventions as an approvable addition to the project's persistent memory.

import * as React from "react";
import { BookMarked, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AtlasMdProposal({
  additions,
  onResolve,
}: {
  additions: string;
  onResolve: (text: string | null) => void;
}) {
  const [text, setText] = React.useState(additions);
  return (
    <div className="border-t border-cyan/30 bg-cyan/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <BookMarked className="mt-0.5 size-4 shrink-0 text-cyan" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Remember this for next time?</p>
          <p className="text-2xs text-muted-foreground">
            The agent proposes appending these durable conventions to ATLAS.md (edit before saving).
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(6, Math.max(2, text.split("\n").length))}
            className={cn(
              "mt-2 w-full resize-none rounded-lg border border-border bg-surface/80 p-2",
              "font-mono text-2xs outline-none focus:border-cyan/40",
            )}
          />
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" variant="primary" disabled={!text.trim()} onClick={() => onResolve(text)}>
              <Check className="size-3.5" /> Save to ATLAS.md
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onResolve(null)}>
              <X className="size-3.5" /> Skip
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
