"use client";

import * as React from "react";
import { Mic, MicOff, SkipForward, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { atlasGraph } from "@/lib/graph/atlas-graph";
import { cachedNewsCorpus, primeNewsCorpus } from "@/lib/news/client-corpus";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { useVoiceSession } from "@/lib/hooks/use-voice-session";
import { usePrefersReducedMotion } from "@/lib/hooks/use-media-query";
import { useFlag } from "@/lib/store/flags-store";
import { getOpenrouterKey } from "@/lib/store/keys-store";
import { useUIStore } from "@/lib/store/ui-store";
import { describeSurface, useSurfaceStore } from "@/lib/agent/surface-context";
import { PHASE_LABELS } from "@/lib/voice/session";
import { announce } from "@/lib/atlas-events";
import { cn } from "@/lib/utils";

/**
 * A spoken conversation with Atlas.
 *
 * Its own surface rather than a mode of the dock, for the reason the dock is
 * its own surface rather than a mode of the chat page: the thing being looked
 * at is different. In a spoken turn there is nothing to read most of the time,
 * and the one piece of state that matters — whose turn it is — has to be
 * legible from across a room, not from a status line in a 400px panel.
 *
 * ### What is on screen, and why so little
 *
 * One indicator, one line of state, and whatever the last answer was. A voice
 * interface that renders a full transcript invites reading, and someone reading
 * is someone who would have been better served by typing. The answer is kept
 * because `speech-plan.ts` deliberately does *not* read code, tables or links
 * aloud — it says they are on screen, and this is the screen it means.
 *
 * ### The indicator carries the state, and so does the text
 *
 * The ring is `--action`, which Terrain reserves for primary action and live
 * state, and it scales with the measured input level. It is never the only
 * signal: the phase is spelled out underneath, announced to assistive
 * technology on every change, and the whole thing is legible with the animation
 * off. A voice interface whose only feedback is motion is unusable for exactly
 * the people most likely to want one.
 */
export function VoiceMode({ open, onClose }: { open: boolean; onClose: () => void }) {
  const modelId = useUIStore((s) => s.activeModelId);
  const surface = useSurfaceStore((s) => s.context);
  const routeEnv = useRouteEnv();
  const reduced = usePrefersReducedMotion();
  const correct = useFlag("voiceLexicon");

  React.useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    void primeNewsCorpus(ctrl.signal);
    return () => ctrl.abort();
  }, [open]);

  const voice = useVoiceSession({
    modelId,
    openRouterKey: getOpenrouterKey() || undefined,
    surface: describeSurface(surface),
    graph: open ? atlasGraph() : null,
    correctTranscript: correct,
    atlas: {
      graph: () => atlasGraph(),
      news: () => cachedNewsCorpus(),
      routeEnv: routeEnv ?? undefined,
      // No `navigate` and no `prompts`, deliberately. A spoken turn has no
      // approval prompt anyone can read, and a page that changes under someone
      // who is not looking at it is the worst version of an agent acting on its
      // own. `onApproval` is absent for the same reason, so every write is
      // refused rather than silently allowed — the dock's rule, kept.
    },
  });

  const { start, stop } = voice;

  // Opening starts listening; closing stops everything. Tied to `open` rather
  // than to a button so the microphone can never outlive the surface.
  React.useEffect(() => {
    if (open) start();
    else stop();
  }, [open, start, stop]);

  const label = PHASE_LABELS[voice.phase];
  React.useEffect(() => {
    if (open) announce(label);
  }, [label, open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const lastAnswer = [...voice.turns].reverse().find((t) => t.role === "assistant")?.content ?? "";
  const heard = voice.partial.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice conversation"
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl"
    >
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <span className="text-2xs uppercase tracking-widest text-muted-foreground">Voice</span>
        {/* 44px at mobile, the repo's existing pattern (`artifact-panel.tsx`):
            `size="icon"` is 40, and this is the control someone reaches for
            one-handed while talking. */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="End voice conversation"
          className="size-11 sm:size-10"
        >
          <X className="size-5" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 pb-6">
        {!voice.supported ? (
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            This browser has no speech recognition. Voice conversation needs Chrome, Edge or
            Safari; everything else in Atlas works here as normal.
          </p>
        ) : (
          <>
            <Indicator level={voice.level} phase={voice.phase} reduced={reduced} />

            <p aria-live="polite" className="text-sm font-medium">
              {label}
            </p>

            {/* What is being heard, before it is committed. Shown because a
                mis-heard model name is the single most common way a spoken
                question goes wrong, and seeing it lets the person say it again
                rather than wait for an answer to something they did not ask. */}
            <p
              className={cn(
                "min-h-5 max-w-xl text-center text-sm",
                heard ? "text-muted-foreground" : "text-transparent",
              )}
            >
              {heard || " "}
            </p>

            {lastAnswer && (
              <div className="prose-atlas max-h-[38vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface/60 p-4 text-body">
                <Markdown>{lastAnswer}</Markdown>
              </div>
            )}

            {voice.note && (
              <p role="alert" className="text-2xs text-muted-foreground">
                {voice.note}
              </p>
            )}
          </>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-border px-4 py-4">
        {/* The manual half of barge-in. Talking over the answer already works;
            this is for a room too loud to be heard over, and for anyone who
            would rather press something than interrupt out loud. */}
        <Button
          variant="ghost"
          onClick={voice.interrupt}
          disabled={voice.phase !== "speaking" && voice.phase !== "thinking"}
          className="min-h-11"
        >
          <SkipForward className="size-4" />
          Skip
        </Button>
        <Button variant="danger" onClick={onClose} className="min-h-11">
          {voice.listening ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          End
        </Button>
      </footer>
    </div>
  );
}

/**
 * Whose turn it is, as one shape.
 *
 * The outer ring tracks the measured level while the microphone is open, so a
 * person can see that they are being heard before they find out from an answer.
 * While the agent is speaking it holds a steady wider ring instead: showing the
 * synthesiser's own output back as an input level would be feedback dressed as
 * information.
 */
function Indicator({
  level,
  phase,
  reduced,
}: {
  level: number;
  phase: string;
  reduced: boolean;
}) {
  const listening = phase === "listening";
  const scale = listening ? 1 + Math.min(level, 1) * 0.45 : phase === "speaking" ? 1.3 : 1.05;
  return (
    <div className="relative grid size-40 place-items-center">
      <div
        aria-hidden
        style={{ transform: `scale(${reduced ? 1.2 : scale})` }}
        className={cn(
          "absolute size-24 rounded-full border-2 border-action/40",
          // The level is sampled every 20ms; a transition just longer than that
          // turns a staircase into a swell without lagging behind the voice.
          !reduced && "transition-transform duration-75 ease-out",
          phase === "thinking" && !reduced && "animate-pulse",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "size-16 rounded-full",
          listening || phase === "speaking" ? "bg-action/20" : "bg-surface-3",
        )}
      />
      <Mic className={cn("absolute size-6", listening ? "text-action" : "text-muted-foreground")} />
    </div>
  );
}
