"use client";

import { Archive, X } from "lucide-react";
import { healSentence, type HealNotice } from "@/lib/hooks/use-healed-models";
import { cn } from "@/lib/utils";

/**
 * "Your selection changed, and here is why."
 *
 * Deliberately not a toast. The change already happened to something on screen,
 * so the explanation belongs beside it and should stay until dismissed — a
 * notice that disappears after four seconds is one the user will not have read
 * before wondering why their comparison lost a column.
 */
export function ModelHealNotice({
  notice,
  onDismiss,
  className,
}: {
  notice: HealNotice | null;
  onDismiss: () => void;
  className?: string;
}) {
  const sentence = healSentence(notice);
  if (!sentence) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-xl border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-foreground",
        className,
      )}
    >
      <Archive className="mt-0.5 size-3.5 shrink-0 text-amber" aria-hidden />
      <span className="min-w-0 flex-1">{sentence}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
