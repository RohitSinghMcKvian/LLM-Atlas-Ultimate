"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for every interactive lesson visualization.
 *
 * One frame keeps ten different widgets reading as one system: same header
 * treatment, same control rail, same caption placement. Widgets supply only
 * their body and their controls.
 */
export function VizFrame({
  label,
  hint,
  controls,
  footer,
  children,
  className,
  bodyClassName,
}: {
  label: string;
  hint?: string;
  controls?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-surface/60 shadow-glow",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-action/10 px-3.5 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="size-3.5 text-action" aria-hidden />
          {label}
        </span>
        {hint && (
          <span className="hidden text-2xs text-muted-foreground sm:inline">
            {hint}
          </span>
        )}
        {controls && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {controls}
          </div>
        )}
      </div>
      <div className={cn("p-3.5 sm:p-4", bodyClassName)}>{children}</div>
      {footer && (
        <div className="border-t border-border bg-surface-2/40 px-3.5 py-2 text-2xs text-muted-foreground">
          {footer}
        </div>
      )}
    </figure>
  );
}

/** A labelled range input, styled to match the rest of the viz suite. */
export function VizSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  accent = "ridge",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  accent?: "ridge" | "shelf" | "upland";
}) {
  const id = React.useId();
  return (
    <div className="min-w-[9rem] flex-1">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-2xs font-medium text-muted-foreground">
          {label}
        </label>
        <span
          className={cn(
            "font-mono text-2xs tnum",
            accent === "ridge" && "text-action",
            accent === "shelf" && "text-accent",
            accent === "upland" && "text-amber",
          )}
        >
          {format ? format(value) : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-[rgb(var(--elev-1))]"
      />
    </div>
  );
}

/** A small segmented control — used where a slider would be overkill. */
export function VizToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-border bg-surface-2/70 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2 py-1 text-2xs font-medium transition-colors",
            value === o.value
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Compact metric readout used along the bottom of several widgets. */
export function VizStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: "ridge" | "shelf" | "upland" | "success" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 px-2.5 py-1.5">
      <p className="text-2xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "font-mono text-sm font-semibold tnum",
          accent === "ridge" && "text-action",
          accent === "shelf" && "text-accent",
          accent === "upland" && "text-amber",
          accent === "success" && "text-success",
          accent === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
    </div>
  );
}
