"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { intentHelp } from "@/lib/voice/intent";
import { MAX_RATE, MIN_RATE, RATE_STEP, rankVoices, type VoiceLike } from "@/lib/voice/voices";
import { cn } from "@/lib/utils";

/**
 * Voice, speed, captions, wake word — and what you can say.
 *
 * The vocabulary list is generated from the same tables `parseIntent` matches
 * on, with the caller's own catalog filled in, so it cannot document a phrase
 * that does not work. Hand-written command help is how every voice UI ends up
 * teaching people commands it removed two releases ago.
 */
export function VoicePanel({
  voices,
  voiceUri,
  onVoice,
  rate,
  onRate,
  captions,
  onCaptions,
  wakeWord,
  onWakeWord,
  wakeAvailable,
  models,
}: {
  voices: VoiceLike[];
  voiceUri: string;
  onVoice: (uri: string) => void;
  rate: number;
  onRate: (rate: number) => void;
  captions: boolean;
  onCaptions: (on: boolean) => void;
  wakeWord: boolean;
  onWakeWord: (on: boolean) => void;
  /** False when the flag is off, so the control explains itself rather than lying. */
  wakeAvailable: boolean;
  models?: { id: string; name: string }[];
}) {
  const ranked = React.useMemo(
    () =>
      rankVoices(
        voices,
        typeof navigator === "undefined" ? "en-US" : navigator.language,
      ).slice(0, 8),
    [voices],
  );
  const help = React.useMemo(() => intentHelp({ models }), [models]);

  return (
    <div className="flex w-full max-w-md flex-col gap-6 text-left">
      <section>
        <h3 className="text-2xs uppercase tracking-widest text-muted-foreground">Voice</h3>
        {ranked.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No voices are installed in this browser, so Atlas will use whatever the system
            provides.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {ranked.map((v, index) => {
              const id = v.voiceURI ?? v.name;
              const active = voiceUri ? voiceUri === id : index === 0;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onVoice(id)}
                    aria-pressed={active}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm sm:min-h-10",
                      active ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-surface-2",
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {v.name}
                      {index === 0 && !voiceUri && (
                        <span className="ml-2 text-2xs text-muted-foreground">best available</span>
                      )}
                    </span>
                    {active && <Check className="size-4 shrink-0 text-action" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-2xs uppercase tracking-widest text-muted-foreground">Speed</h3>
          <span className="text-2xs tabular-nums text-muted-foreground">{rate.toFixed(2)}×</span>
        </div>
        <Slider
          className="mt-3"
          min={MIN_RATE}
          max={MAX_RATE}
          step={RATE_STEP / 3}
          value={[rate]}
          onValueChange={([v]) => onRate(v)}
          aria-label="Speaking rate"
        />
        <p className="mt-2 text-2xs text-muted-foreground">
          Or say &ldquo;speak faster&rdquo; and &ldquo;slow down&rdquo;.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <label className="flex min-h-11 items-center justify-between gap-4 sm:min-h-10">
          <span className="text-sm">Show captions</span>
          <Switch checked={captions} onCheckedChange={onCaptions} />
        </label>

        <label
          className={cn(
            "flex min-h-11 items-start justify-between gap-4 sm:min-h-10",
            !wakeAvailable && "opacity-60",
          )}
        >
          <span className="min-w-0">
            <span className="block text-sm">Listen for &ldquo;Hey Atlas&rdquo;</span>
            <span className="mt-0.5 block text-2xs text-muted-foreground">
              {wakeAvailable
                ? "The microphone stays live while Atlas is open. Recognition runs in your browser and nothing is recorded."
                : "Turn on the Hey Atlas flag in Settings to use this."}
            </span>
          </span>
          <Switch
            checked={wakeWord && wakeAvailable}
            disabled={!wakeAvailable}
            onCheckedChange={onWakeWord}
          />
        </label>
      </section>

      <section>
        <h3 className="text-2xs uppercase tracking-widest text-muted-foreground">
          Things you can say
        </h3>
        <dl className="mt-2 flex flex-col gap-3">
          {help.map((group) => (
            <div key={group.group}>
              <dt className="text-2xs text-muted-foreground">{group.group}</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {group.examples.map((example) => (
                  <span
                    key={example}
                    className="rounded-full border border-border bg-surface-2 px-2 py-1 text-2xs text-foreground"
                  >
                    {example}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/**
 * The conversation so far.
 *
 * Collapsed by default and available on demand. P20's argument for hiding it —
 * a voice interface that renders a full transcript invites reading, and someone
 * reading would have been better served by typing — holds for the *default*,
 * not for making it unreachable. The commonest reason to want it is that
 * something was misheard three turns ago and the answers have been wrong since.
 */
export function VoiceTranscript({ turns }: { turns: { role: string; content: string }[] }) {
  if (turns.length === 0) {
    return (
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Nothing said yet. Ask a question, or say &ldquo;what can I say&rdquo;.
      </p>
    );
  }
  return (
    <ol className="flex w-full max-w-md flex-col gap-3 text-left">
      {turns.map((turn, i) => (
        <li key={i} className="flex flex-col gap-0.5">
          <span className="text-2xs uppercase tracking-widest text-muted-foreground">
            {turn.role === "user" ? "You" : "Atlas"}
          </span>
          <p className="text-pretty text-sm text-foreground">{turn.content || "…"}</p>
        </li>
      ))}
    </ol>
  );
}

/** Copy the whole conversation, for anyone who wants to keep it. */
export function CopyTranscript({ turns }: { turns: { role: string; content: string }[] }) {
  const [done, setDone] = React.useState(false);
  if (turns.length === 0) return null;
  return (
    <Button
      variant="ghost"
      className="min-h-11 sm:min-h-10"
      onClick={() => {
        const text = turns
          .map((t) => `${t.role === "user" ? "You" : "Atlas"}: ${t.content}`)
          .join("\n\n");
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1_600);
          },
          () => {},
        );
      }}
    >
      {done ? "Copied" : "Copy transcript"}
    </Button>
  );
}
