"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  useSettingsStore,
  STYLE_PRESETS,
  type StyleId,
} from "@/lib/store/settings-store";
import { cn } from "@/lib/utils";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const s = useSettingsStore();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-action" /> Personalize Atlas
          </DialogTitle>
          <DialogDescription>
            Custom instructions and a response style are added to every chat. Stored
            only in this browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <Field label="What should Atlas call you?">
            <input
              value={s.displayName}
              onChange={(e) => s.set({ displayName: e.target.value })}
              placeholder="Your name"
              className="h-9 w-full rounded-lg border border-border bg-surface-2/50 px-3 text-sm outline-none focus:border-action/40"
            />
          </Field>

          <Field label="What should Atlas know about you?">
            <textarea
              value={s.aboutYou}
              onChange={(e) => s.set({ aboutYou: e.target.value })}
              placeholder="Role, stack, preferences, domain… e.g. 'Staff engineer, TypeScript + Rust, prefer pnpm.'"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm outline-none focus:border-action/40"
            />
          </Field>

          <Field label="How should Atlas respond?">
            <textarea
              value={s.responseGuidance}
              onChange={(e) => s.set({ responseGuidance: e.target.value })}
              placeholder="e.g. 'Be direct. Show code first. Flag tradeoffs. Skip disclaimers.'"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm outline-none focus:border-action/40"
            />
          </Field>

          <Field label="Response style">
            <div className="grid grid-cols-3 gap-2">
              {STYLE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => s.set({ style: p.id as StyleId })}
                  className={cn(
                    "rounded-lg border px-2.5 py-2 text-left transition-colors",
                    s.style === p.id
                      ? "border-action/50 bg-action/10"
                      : "border-border hover:border-border-strong",
                  )}
                >
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-2xs text-muted-foreground">{p.hint}</div>
                </button>
              ))}
            </div>
          </Field>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Read replies aloud</span>
              <span className="block text-2xs text-muted-foreground">
                Speak each response with your browser&apos;s voice.
              </span>
            </span>
            <Switch
              checked={s.voiceAutoRead}
              onCheckedChange={() => s.toggle("voiceAutoRead")}
            />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Show detailed activity</span>
              <span className="block text-2xs text-muted-foreground">
                Keep the thinking and tool steps expanded instead of collapsed to one line.
              </span>
            </span>
            <Switch
              checked={s.detailedActivity}
              onCheckedChange={() => s.toggle("detailedActivity")}
            />
          </label>

          {/* Two settings rather than one, because they cost different things.
              Checking is free and local; fixing spends a model turn the user did
              not ask for. Collapsing them into a single switch would make the
              cheap, obviously-good half unavailable to anyone unwilling to pay
              for the other. */}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Check artifacts before showing them</span>
              <span className="block text-2xs text-muted-foreground">
                Run each finished artifact out of sight and report what broke. Costs nothing —
                it happens in your browser.
              </span>
            </span>
            <Switch
              checked={s.autoVerifyArtifacts}
              onCheckedChange={() => s.toggle("autoVerifyArtifacts")}
            />
          </label>

          {s.autoVerifyArtifacts && (
            <Field
              label="Fix broken artifacts automatically"
              hint="Model turns Atlas may spend repairing its own artifact when the check finds a real error. Errors it cannot have caused never spend anything."
            >
              <div className="flex gap-1.5">
                {([0, 1, 2] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => s.set({ autoRepairAttempts: n })}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                      s.autoRepairAttempts === n
                        ? "border-action/40 bg-action/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {n === 0 ? "Report only" : n === 1 ? "1 attempt" : "2 attempts"}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {/* Off by default, and phrased so that is legible as a choice rather
              than a disabled state. A build that stops at its round cap has not
              failed — but resuming it spends money the user did not ask for a
              second time, so it is opted into. Cost, time and no-progress stops
              are never resumed automatically at any setting; see
              `lib/chat/resume.ts`. */}
          <Field
            label="Continue automatically after the round cap"
            hint="Only when a build runs out of tool rounds mid-work. A cost or time limit, or a build that stopped making progress, always waits for you."
          >
            <div className="flex gap-1.5">
              {([0, 1, 2] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => s.set({ autoContinueRounds: n })}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                    s.autoContinueRounds === n
                      ? "border-action/40 bg-action/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n === 0 ? "Ask me" : n === 1 ? "Once" : "Twice"}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** One line under the label, for a setting whose cost is not self-evident. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {hint && <p className="text-2xs text-muted-foreground/80">{hint}</p>}
      {children}
    </div>
  );
}
