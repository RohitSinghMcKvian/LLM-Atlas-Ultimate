"use client";

import * as React from "react";

/**
 * Chart colour, drawn from the elevation ramp.
 *
 * Every chart in the app used to hardcode a dark-theme hex, so nothing
 * responded to the theme toggle and the light theme rendered near-invisible
 * series on white. There were also three colours in those tables — `#34C799`,
 * `#38BDF8`, `#F472B6` — that existed nowhere else in the design system.
 *
 * Two ways to consume this:
 *
 *   • `SERIES` / `CHART_INK` are CSS-variable strings. recharts passes
 *     `fill` and `stroke` straight through to SVG attributes, so a `var()`
 *     resolves there and follows the theme with no re-render. Prefer these.
 *   • `useChartColors()` returns resolved hex, for the handful of props
 *     recharts parses itself rather than forwarding — tooltip `contentStyle`,
 *     axis `tick.fill`, `CartesianGrid stroke` — plus canvas and Monaco.
 */

/** The ramp, in order: deep water → shelf → lowland → upland → ridge → summit. */
export const SERIES = [
  "rgb(var(--elev-0))",
  "rgb(var(--elev-1))",
  "rgb(var(--elev-2))",
  "rgb(var(--elev-3))",
  "rgb(var(--elev-4))",
  "rgb(var(--elev-5))",
] as const;

/**
 * A categorical series colour. The ramp is an ordered scale, so this is only
 * correct where the categories genuinely have no order — benchmark suites, for
 * instance. Where a value *is* ordered, index the ramp by the value.
 */
export function seriesAt(index: number): string {
  return SERIES[index % SERIES.length];
}

/** Non-data chart furniture. */
export const CHART_INK = {
  grid: "rgb(var(--border))",
  axis: "rgb(var(--muted-foreground))",
  cursor: "rgb(var(--border-strong))",
  surface: "rgb(var(--popover))",
  border: "rgb(var(--border-strong))",
  text: "rgb(var(--foreground))",
  action: "rgb(var(--action))",
  accent: "rgb(var(--accent))",
} as const;

type Resolved = Record<keyof typeof CHART_INK, string> & { series: string[] };

const SSR: Resolved = {
  grid: "#292B2E",
  axis: "#90929A",
  cursor: "#3A3D42",
  surface: "#1D1F21",
  border: "#3A3D42",
  text: "#E9E9EA",
  action: "#D9752F",
  accent: "#46B3AE",
  series: ["#2C5F8A", "#2E8F8C", "#5DA84E", "#D9B740", "#D9752F", "#E8E4DA"],
};

function readVar(cs: CSSStyleDeclaration, name: string, fallback: string) {
  const parts = cs.getPropertyValue(name).trim().split(/[\s,]+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return `#${parts
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Resolved hex for the current theme, re-read when the theme class flips.
 *
 * The `MutationObserver` matters: `next-themes` swaps a class on `<html>`
 * rather than remounting, so without it a chart keeps its old colours until
 * something else happens to re-render it.
 */
export function useChartColors(): Resolved {
  const [colors, setColors] = React.useState<Resolved>(SSR);

  React.useEffect(() => {
    const el = document.documentElement;
    const read = () => {
      const cs = getComputedStyle(el);
      setColors({
        grid: readVar(cs, "--border", SSR.grid),
        axis: readVar(cs, "--muted-foreground", SSR.axis),
        cursor: readVar(cs, "--border-strong", SSR.cursor),
        surface: readVar(cs, "--popover", SSR.surface),
        border: readVar(cs, "--border-strong", SSR.border),
        text: readVar(cs, "--foreground", SSR.text),
        action: readVar(cs, "--action", SSR.action),
        accent: readVar(cs, "--accent", SSR.accent),
        series: SSR.series.map((fb, i) => readVar(cs, `--elev-${i}`, fb)),
      });
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  return colors;
}
