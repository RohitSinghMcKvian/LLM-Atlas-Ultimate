import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Compact number formatting: 195000 -> "195K", 1_200_000 -> "1.2M" */
export function formatCompact(n: number, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const units = [
    { v: 1e12, s: "T" },
    { v: 1e9, s: "B" },
    { v: 1e6, s: "M" },
    { v: 1e3, s: "K" },
  ];
  for (const u of units) {
    if (abs >= u.v) {
      const val = n / u.v;
      return `${val.toFixed(val >= 100 ? 0 : digits).replace(/\.0+$/, "")}${u.s}`;
    }
  }
  return String(n);
}

/** USD currency, smart precision for tiny per-token figures. */
export function formatUSD(n: number, opts?: { precise?: boolean }): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (opts?.precise && Math.abs(n) < 1) {
    return `$${n.toFixed(n < 0.01 ? 4 : 3)}`;
  }
  if (Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

/** Context window tokens -> "128K", "1M" */
export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

/** Relative "x minutes ago" formatting. */
export function timeAgo(date: Date | string | number): string {
  const d = new Date(date).getTime();
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Deterministic 0..1 hash from a string (stable layout jitter, etc.). */
export function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
