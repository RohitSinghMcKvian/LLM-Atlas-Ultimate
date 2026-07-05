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
            <Sparkles className="size-4 text-cyan" /> Personalize Atlas
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
              className="h-9 w-full rounded-lg border border-border bg-surface-2/50 px-3 text-sm outline-none focus:border-cyan/40"
            />
          </Field>

          <Field label="What should Atlas know about you?">
            <textarea
              value={s.aboutYou}
              onChange={(e) => s.set({ aboutYou: e.target.value })}
              placeholder="Role, stack, preferences, domain… e.g. 'Staff engineer, TypeScript + Rust, prefer pnpm.'"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm outline-none focus:border-cyan/40"
            />
          </Field>

          <Field label="How should Atlas respond?">
            <textarea
              value={s.responseGuidance}
              onChange={(e) => s.set({ responseGuidance: e.target.value })}
              placeholder="e.g. 'Be direct. Show code first. Flag tradeoffs. Skip disclaimers.'"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm outline-none focus:border-cyan/40"
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
                      ? "border-cyan/50 bg-cyan/10"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
