"use client";

import * as React from "react";
import { VenetianMask } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Says that this session is not being kept.
 *
 * Deliberately a banner over the composer rather than one highlighted icon among
 * several — the same contract Atlas Chat's temporary mode uses, and for the same
 * reason: a mode where nothing is saved has to be impossible to be in by
 * accident. It states itself, names what it costs, and stays put.
 *
 * The accent hue is the shelf band, which the product already reserves for a
 * mode change rather than a per-turn option.
 */
export function IncognitoBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 py-1.5 text-2xs text-accent",
        className,
      )}
    >
      <VenetianMask className="size-3.5 shrink-0" />
      <span>
        Temporary session — nothing is saved. This comparison disappears when you leave it.
      </span>
    </div>
  );
}

/**
 * Choose whether the session about to start is kept.
 *
 * Offered before the first question and never again: the choice is a property of
 * the session, so there is no moment at which flipping it would leave half a
 * conversation on disk.
 */
export function IncognitoChoice({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      disabled={disabled}
      aria-pressed={value}
      title={
        value
          ? "This session will not be saved."
          : "Start a session that is never written to this device."
      }
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-2xs transition-colors disabled:opacity-50",
        value
          ? "border-accent/50 bg-accent/10 text-accent"
          : "border-border bg-surface-2/60 text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      <VenetianMask className="size-3.5" />
      Temporary
    </button>
  );
}
