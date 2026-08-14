"use client";

import * as React from "react";
import { Settings2, Type, AlignLeft, Focus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLearnStore, type ReadingPrefs } from "@/lib/store/learn-store";
import { cn } from "@/lib/utils";

/**
 * Reader controls.
 *
 * Not decoration. This is a page people read for forty minutes at a stretch,
 * and the right measure and text size differ by display, by eyesight, and by
 * whether the reader is on a laptop or a 27" monitor. Choosing one and calling
 * it correct is how a long-form reader annoys half its audience.
 */

const SIZES: { value: ReadingPrefs["size"]; label: string }[] = [
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
];

/** Prose measure per setting. Wide is still bounded — full-bleed prose is worse. */
export const MEASURE_CLASS: Record<ReadingPrefs["measure"], string> = {
  comfortable: "max-w-[68ch]",
  wide: "max-w-[82ch]",
};

/** Body type scale per setting. Line height rises with size, as it should. */
export const SIZE_CLASS: Record<ReadingPrefs["size"], string> = {
  s: "text-body leading-[1.72]",
  m: "text-[17px] leading-[1.75]",
  l: "text-[19px] leading-[1.78]",
};

export function ReadingPrefsMenu() {
  const prefs = useLearnStore((s) => s.readingPrefs);
  const setReadingPrefs = useLearnStore((s) => s.setReadingPrefs);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Reading preferences"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-2.5 py-1.5 text-2xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
        >
          <Settings2 className="size-3.5" />
          <span className="hidden sm:inline">Reading</span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-60 p-3" align="end">
        <p className="mb-2.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Reading
        </p>

        <Row icon={Type} label="Text size">
          <div
            role="radiogroup"
            aria-label="Text size"
            className="inline-flex rounded-lg border border-border bg-surface-2/70 p-0.5"
          >
            {SIZES.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={prefs.size === s.value}
                onClick={() => setReadingPrefs({ size: s.value })}
                className={cn(
                  "w-7 rounded-md py-0.5 text-2xs font-semibold transition-colors",
                  prefs.size === s.value
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Row>

        <Row icon={AlignLeft} label="Line width">
          <div
            role="radiogroup"
            aria-label="Line width"
            className="inline-flex rounded-lg border border-border bg-surface-2/70 p-0.5"
          >
            {(["comfortable", "wide"] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={prefs.measure === m}
                onClick={() => setReadingPrefs({ measure: m })}
                className={cn(
                  "rounded-md px-2 py-0.5 text-2xs font-medium capitalize transition-colors",
                  prefs.measure === m
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "comfortable" ? "Normal" : "Wide"}
              </button>
            ))}
          </div>
        </Row>

        <Row icon={Focus} label="Focus mode">
          <button
            role="switch"
            aria-checked={prefs.focus}
            aria-label="Focus mode"
            onClick={() => setReadingPrefs({ focus: !prefs.focus })}
            className={cn(
              "relative h-4 w-7 rounded-full transition-colors",
              prefs.focus ? "bg-action" : "bg-surface-3",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-3 rounded-full bg-surface shadow-sm transition-transform",
                prefs.focus ? "translate-x-3.5" : "translate-x-0.5",
              )}
            />
          </button>
        </Row>

        <p className="mt-2 border-t border-border pt-2 text-2xs leading-relaxed text-muted-foreground">
          Focus mode dims the contents and notes rails while you read. Saved on
          this device.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 last:mb-0">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-xs">{label}</span>
      <span className="ml-auto">{children}</span>
    </div>
  );
}
