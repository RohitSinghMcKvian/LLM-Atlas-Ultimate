"use client";

import * as React from "react";
import { Hammer, ListChecks, Wallet, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BUILD_LIMITS } from "@/lib/chat/build-budget";
import type { AgenticMode } from "@/lib/chat/agentic";

/**
 * The one-time consent gate for automatic build mode.
 *
 * Build mode raises the tool-round cap from 4 to 20 and the output budget from
 * 16k to 32k, so a build turn can cost many times an ordinary one. Detecting a
 * build request and silently entering it would be a worse bug than the one
 * detection fixes — the point is to stop hiding a capability, not to start
 * hiding a cost.
 *
 * So the first time detection wants to escalate, it blocks here and says exactly
 * what will happen. Once, per browser. Asking on every build would recreate the
 * friction this whole change exists to remove, which is why "Always ask" is the
 * quieter option rather than the default.
 */
export function AutoBuildDialog({
  open,
  onDecide,
}: {
  open: boolean;
  /**
   * `mode` is the standing setting to save; `proceed` is whether to run the
   * message that triggered this as a build.
   *
   * Two values rather than one because "run this one as a build, but ask me
   * again next time" is a real answer and the common one.
   */
  onDecide: (choice: { mode: AgenticMode; proceed: boolean }) => void;
}) {
  return (
    <Dialog
      open={open}
      // Dismissing is not consent. Escape answers the message as an ordinary
      // chat turn and leaves the setting alone, so nothing is spent and nothing
      // is decided on the strength of a keystroke.
      onOpenChange={(next) => {
        if (!next) onDecide({ mode: "auto", proceed: false });
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hammer className="size-4 text-accent" />
            This looks like a build
          </DialogTitle>
          <DialogDescription>
            Atlas can run this as a build instead of a single reply — working through it
            over several rounds with a file workspace and a plan, the way a longer task
            actually gets done.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 rounded-xl border border-border bg-surface-2/40 p-3 text-sm">
          <li className="flex items-start gap-2.5">
            <Wrench className="mt-0.5 size-3.5 shrink-0 text-action" />
            <span>
              Up to <span className="tnum font-medium">{BUILD_LIMITS.maxRounds}</span> tool
              rounds instead of {4}, so it can write files, check them and fix what broke.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <ListChecks className="mt-0.5 size-3.5 shrink-0 text-action" />
            <span>A workspace and a task list you can watch, and that survive the turn.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <Wallet className="mt-0.5 size-3.5 shrink-0 text-amber" />
            <span>
              Capped at{" "}
              <span className="tnum font-medium">${BUILD_LIMITS.maxUsd.toFixed(2)}</span> and{" "}
              <span className="tnum font-medium">
                {Math.round(BUILD_LIMITS.maxMs / 60_000)} minutes
              </span>{" "}
              per turn. Atlas stops at the cap and tells you, rather than continuing.
            </span>
          </li>
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => onDecide({ mode: "auto", proceed: true })}
          >
            Build it
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDecide({ mode: "off", proceed: false })}
          >
            Just answer
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => onDecide({ mode: "always", proceed: true })}
          >
            Always build
          </Button>
        </div>

        <p className="text-2xs text-muted-foreground/70">
          Asked once. After this, Atlas decides per message and shows a banner above the
          composer before it spends anything — you can turn that off any time with the Agent
          control.
        </p>
      </DialogContent>
    </Dialog>
  );
}
