"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { List, Mic, MicOff, Settings2, SkipForward, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { VoiceOrb } from "./voice-orb";
import { HeardLine, VoiceCaption } from "./voice-captions";
import { VoiceConfirm } from "./voice-confirm";
import { CopyTranscript, VoicePanel, VoiceTranscript } from "./voice-settings";
import { allModels } from "@/lib/catalog";
import { atlasGraph } from "@/lib/graph/atlas-graph";
import { cachedNewsCorpus, primeNewsCorpus } from "@/lib/news/client-corpus";
import { latest as latestPromptVersion, usePromptStore } from "@/lib/store/prompt-store";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { useVoiceSession } from "@/lib/hooks/use-voice-session";
import { usePrefersReducedMotion } from "@/lib/hooks/use-media-query";
import { useFlag } from "@/lib/store/flags-store";
import { getOpenrouterKey } from "@/lib/store/keys-store";
import { useUIStore } from "@/lib/store/ui-store";
import { useVoiceStore } from "@/lib/store/voice-store";
import { describeSurface, useSurfaceStore } from "@/lib/agent/surface-context";
import { resolveCommand, useSurfaceCommandStore } from "@/lib/agent/surface-commands";
import { describeIntent, type VoiceIntent } from "@/lib/voice/intent";
import { PHASE_LABELS } from "@/lib/voice/session";
import type { VoiceLike } from "@/lib/voice/voices";
import { announce } from "@/lib/atlas-events";
import { cn } from "@/lib/utils";

/**
 * A spoken conversation with Atlas, that can also operate it.
 *
 * Its own surface rather than a mode of the dock, for the reason the dock is
 * its own surface rather than a mode of the chat page: the thing being looked
 * at is different. In a spoken turn there is nothing to read most of the time,
 * and the one piece of state that matters — whose turn it is — has to be
 * legible from across a room, not from a status line in a 400px panel.
 *
 * ### What changed from the version that could only talk
 *
 * P20 deliberately withheld `navigate`, `prompts` and `onApproval`, which left
 * a surface that could answer questions and do nothing else. The reasoning was
 * that a spoken turn has no approval prompt anyone can read. That is answered
 * here rather than overruled: the approval is *spoken*, `VoiceConfirm` shows
 * the same sentence for anyone who would rather press a button, and silence is
 * never taken as consent. Navigation is exempt by the user's own decision — it
 * is undone by the back button, and confirming every one of them out loud would
 * make the fastest thing the assistant does the slowest.
 *
 * ### Commands do not go to the model
 *
 * "Open Compare" is a `router.push`, resolved by `lib/voice/intent.ts` in the
 * browser. No retrieval, no round-trip, no tool round.
 */
export function VoiceMode({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const modelId = useUIStore((s) => s.activeModelId);
  const surface = useSurfaceStore((s) => s.context);
  const surfaceCommands = useSurfaceCommandStore((s) => s.handler);
  const routeEnv = useRouteEnv();
  const reduced = usePrefersReducedMotion();
  const correct = useFlag("voiceLexicon");
  const commandsEnabled = useFlag("voiceCommands");
  const wakeAvailable = useFlag("voiceWake");
  const prefs = useVoiceStore();

  const [tab, setTab] = React.useState<"live" | "transcript" | "settings">("live");
  const [voices, setVoices] = React.useState<VoiceLike[]>([]);

  React.useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    void primeNewsCorpus(ctrl.signal);
    return () => ctrl.abort();
  }, [open]);

  // The graph is built off the render path. Previously this ran during render,
  // which blocked the overlay's first paint behind a walk of the whole catalog.
  const [graph, setGraph] = React.useState<ReturnType<typeof atlasGraph> | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setGraph(atlasGraph()), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Voices arrive asynchronously in Chrome: the first `getVoices()` is empty,
  // which is exactly why an unconfigured page ends up on the platform default.
  React.useEffect(() => {
    if (!open || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const read = () => setVoices(window.speechSynthesis.getVoices());
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", read);
  }, [open]);

  const models = React.useMemo(
    () => (open ? allModels().map((m) => ({ id: m.id, name: m.name })) : []),
    [open],
  );

  /**
   * Carry out a recognised command.
   *
   * Returns what to say back, or null when it could not be done — the driver
   * then falls through to the model rather than dead-ending on a command it
   * half-understood.
   */
  const onCommand = React.useCallback(
    (intent: VoiceIntent): string | null => {
      switch (intent.kind) {
        case "navigate": {
          const params = new URLSearchParams();
          if (intent.modelIds?.length) {
            if (intent.moduleId === "compare") params.set("models", intent.modelIds.join(","));
            else if (intent.moduleId === "chat" || intent.moduleId === "cost")
              params.set("model", intent.modelIds[0]);
          }
          if (intent.access && intent.moduleId === "leaderboard") params.set("access", intent.access);
          const query = params.toString();
          router.push(`${intent.href}${query ? `?${query}` : ""}`);
          return describeIntent(intent);
        }
        case "back":
          router.back();
          return "Going back.";
        case "select":
        case "filter": {
          const resolved = resolveCommand(intent, surfaceCommands);
          if (!resolved) return null;
          if (resolved.kind === "unsupported") return resolved.message;
          if (resolved.kind === "surface") {
            const ok = surfaceCommands?.run(resolved.command) ?? false;
            return ok ? describeIntent(intent) : null;
          }
          router.push(resolved.href);
          return `${describeIntent(intent)}, on ${resolved.moduleName}.`;
        }
        case "playback":
          if (intent.op === "faster" || intent.op === "slower") {
            prefs.nudge(intent.op);
            return describeIntent(intent);
          }
          if (intent.op === "reset_rate") {
            prefs.set({ rate: 1.05 });
            return "Normal speed.";
          }
          return describeIntent(intent);
        case "session":
          if (intent.op === "help") {
            setTab("settings");
            return "Here is what you can say.";
          }
          return null;
        default:
          return null;
      }
    },
    [prefs, router, surfaceCommands],
  );

  const voice = useVoiceSession({
    modelId,
    openRouterKey: getOpenrouterKey() || undefined,
    surface: describeSurface(surface),
    graph,
    correctTranscript: correct,
    commands: commandsEnabled,
    models,
    onCommand,
    voiceUri: prefs.voiceUri,
    rate: prefs.rate,
    backchannel: prefs.backchannel,
    wakeWord: prefs.wakeWord && wakeAvailable,
    onEnd: onClose,
    atlas: {
      graph: () => atlasGraph(),
      news: () => cachedNewsCorpus(),
      routeEnv: routeEnv ?? undefined,
      // Wired at last. `atlas_open` navigates without asking (reversible, and
      // the person chose that); everything else that writes is read aloud and
      // waits for a yes — see `use-voice-session.ts`.
      navigate: (href) => router.push(href as Parameters<typeof router.push>[0]),
      prompts: {
        list: () =>
          usePromptStore.getState().prompts.map((p) => {
            const v = latestPromptVersion(p);
            return { id: p.id, title: p.title, tags: p.tags, body: v.body, version: v.v };
          }),
        save: ({ id, title, body, note, tags }) => {
          const store = usePromptStore.getState();
          const existing = store.prompts.find((p) => p.id === id);
          if (!existing) {
            store.add({ id, title, tags: [...tags], body });
            return { created: true, version: 1 };
          }
          store.saveVersion(id, body, note);
          return { created: false, version: latestPromptVersion(existing).v + 1 };
        },
      },
    },
  });

  const { start, stop, holdStart, holdEnd } = voice;

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

  // Escape closes; hold Space to talk. Space is ignored while focus is in a
  // control, so the buttons keep working the way buttons do.
  React.useEffect(() => {
    if (!open) return;
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable ||
        t.tagName === "BUTTON");
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.code === "Space" && !e.repeat && !isTyping(e.target)) {
        e.preventDefault();
        holdStart();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        e.preventDefault();
        holdEnd();
      }
    };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
    };
  }, [open, onClose, holdStart, holdEnd]);

  if (!open) return null;

  const lastAnswer = [...voice.turns].reverse().find((t) => t.role === "assistant")?.content ?? "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice conversation"
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        <span className="flex items-center gap-2 text-2xs uppercase tracking-widest text-muted-foreground">
          Voice
          {voice.held && <span className="text-action">holding</span>}
        </span>
        <div className="flex items-center gap-1">
          <TabButton active={tab === "live"} onClick={() => setTab("live")} label="Live">
            <Sparkles className="size-4" />
          </TabButton>
          <TabButton
            active={tab === "transcript"}
            onClick={() => setTab("transcript")}
            label="Transcript"
          >
            <List className="size-4" />
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")} label="Settings">
            <Settings2 className="size-4" />
          </TabButton>
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
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 pb-6">
        {!voice.supported ? (
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            This browser has no speech recognition. Voice conversation needs Chrome, Edge or
            Safari; everything else in Atlas works here as normal.
          </p>
        ) : tab === "transcript" ? (
          <>
            <VoiceTranscript turns={voice.turns} />
            <CopyTranscript turns={voice.turns} />
          </>
        ) : tab === "settings" ? (
          <VoicePanel
            voices={voices}
            voiceUri={prefs.voiceUri}
            onVoice={(voiceUri) => prefs.set({ voiceUri })}
            rate={prefs.rate}
            onRate={(rate) => prefs.set({ rate })}
            captions={prefs.captions}
            onCaptions={(captions) => prefs.set({ captions })}
            wakeWord={prefs.wakeWord}
            onWakeWord={(wakeWord) => prefs.set({ wakeWord })}
            wakeAvailable={wakeAvailable}
            models={models}
          />
        ) : (
          <>
            <VoiceOrb
              phase={voice.phase}
              level={voice.level}
              getAnalyser={voice.getAnalyser}
              reduced={reduced}
            />

            <p aria-live="polite" className="text-sm font-medium">
              {label}
            </p>

            {/* The recognised command, named before it is carried out. */}
            {voice.chip && (
              <p className="rounded-full border border-action/30 bg-action/10 px-3 py-1 text-2xs text-foreground">
                {voice.chip}
              </p>
            )}

            {voice.pending ? (
              <VoiceConfirm question={voice.pending.question} onAnswer={voice.approve} />
            ) : (
              <>
                <HeardLine text={voice.partial} />

                {prefs.captions && voice.speaking ? (
                  <VoiceCaption
                    text={voice.speaking.text}
                    charIndex={voice.speaking.charIndex}
                    className="max-w-2xl"
                  />
                ) : (
                  lastAnswer && (
                    <div className="prose-atlas max-h-[34vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface/60 p-4 text-body">
                      <Markdown>{lastAnswer}</Markdown>
                    </div>
                  )
                )}
              </>
            )}

            {voice.note && (
              <p role="alert" className="text-2xs text-muted-foreground">
                {voice.note}
              </p>
            )}
          </>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-3 border-t border-border px-4 py-4">
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
        <Button
          variant={voice.held ? "primary" : "secondary"}
          onPointerDown={holdStart}
          onPointerUp={holdEnd}
          onPointerLeave={holdEnd}
          className="min-h-11 touch-none"
        >
          <Mic className="size-4" />
          Hold to talk
        </Button>
        <Button variant="danger" onClick={onClose} className="min-h-11">
          {voice.listening ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          End
        </Button>
      </footer>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn("size-11 sm:size-10", active && "bg-surface-2 text-foreground")}
    >
      {children}
    </Button>
  );
}
