"use client";

import * as React from "react";
import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The approval, on screen as well as out loud.
 *
 * P20 refused every write on the voice surface because "a spoken turn has no
 * approval prompt anyone can read". The objection is answered rather than
 * overruled: the question is *spoken*, and this shows the same sentence at the
 * same moment, so it can be answered by saying yes or by pressing something.
 *
 * The two must never diverge — the text here is the identical string
 * `confirm.ts` phrased for the synthesiser, not a second description written
 * for the eye. Somebody who heard one and read the other would otherwise be
 * approving two different things.
 *
 * Terrain: `--action` for the affirmative because that is the primary action,
 * and the icon carries the "this needs a decision" signal so it never rests on
 * colour alone.
 */
export function VoiceConfirm({
  question,
  onAnswer,
}: {
  question: string;
  onAnswer: (approved: boolean) => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Confirm"
      className="w-full max-w-md rounded-2xl border border-border bg-surface/90 p-4 shadow-lg backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <ShieldQuestion className="mt-0.5 size-5 shrink-0 text-action" aria-hidden />
        <p className="min-w-0 flex-1 text-pretty text-sm text-foreground">{question}</p>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        {/* Say "no" or press it — both land in the same place. */}
        <Button variant="ghost" onClick={() => onAnswer(false)} className="min-h-11 sm:min-h-10">
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onAnswer(true)} className="min-h-11 sm:min-h-10">
          Go ahead
        </Button>
      </div>
      <p className="mt-2 text-2xs text-muted-foreground">
        Or just say yes or no. Nothing happens if you say nothing.
      </p>
    </div>
  );
}
