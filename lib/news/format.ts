import { fnv1a } from "@/lib/catalog/sync/normalize";
import type { NewsArticle, VerificationLevel } from "./types";

// Presentation helpers. Pure, so they can be used from server components and
// client components alike, and tested without a DOM.

/**
 * An absolute, locale-stable timestamp.
 *
 * This is what the server renders. `toLocaleDateString` with an explicit locale
 * and time zone is deliberate: the default would use the *server's* locale
 * during SSR and the *browser's* during hydration, which is a guaranteed
 * mismatch on a page full of timestamps.
 */
export function absoluteTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Full timestamp for a `title` attribute. */
export function fullTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return `${new Date(ms).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

/**
 * A compact relative age: "12m", "4h", "3d".
 *
 * CLIENT-ONLY. Render `absoluteTime` on the server and swap to this after
 * `useMounted()`. The retired news feed froze a literal `ago: "14m"` string into
 * its data to dodge exactly this hydration mismatch; the honest fix is to render
 * something stable first and upgrade it once the client owns the DOM.
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";

  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return absoluteTime(iso);
}

/** "3 minutes", "2 hours" — for the sync pill's cooldown copy. */
export function humanDuration(ms: number): string {
  if (ms <= 0) return "now";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Group key for the timeline layout: an ISO date in UTC. */
export function dayKey(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  return new Date(ms).toISOString().slice(0, 10);
}

/** "Today", "Yesterday", or a date. Client-only for the same reason as `relativeTime`. */
export function dayLabel(key: string, now = Date.now()): string {
  const today = new Date(now).toISOString().slice(0, 10);
  if (key === today) return "Today";
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  if (key === yesterday) return "Yesterday";
  return absoluteTime(`${key}T00:00:00.000Z`);
}

/** Compact counts for the hero stats: 1200 → "1.2k". */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value < 1000) return String(Math.round(value));
  if (value < 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(value / 1000)}k`;
}

/** Up to two letters standing in for a source when it has no logo. */
export function sourceMonogram(name: string): string {
  const words = name
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * A stable accent per source, drawn from the product's own palette.
 *
 * Deterministic from the id, so a source keeps the same colour across sessions
 * and a scrolled feed reads as organised rather than random.
 */
export const SOURCE_ACCENTS = [
  "rgb(var(--elev-0))",
  "rgb(var(--elev-1))",
  "rgb(var(--elev-2))",
  "rgb(var(--elev-3))",
  "rgb(var(--elev-4))",
  "rgb(var(--elev-5))",
] as const;

export function sourceAccent(sourceId: string): string {
  const hash = fnv1a(sourceId || "source");
  const index = parseInt(hash.slice(0, 4), 16) % SOURCE_ACCENTS.length;
  return SOURCE_ACCENTS[index];
}

/** Everything the verification badge needs, in one place. */
export interface VerificationPresentation {
  label: string;
  /** Short form for a compact row. */
  short: string;
  badge: "success" | "primary" | "default" | "amber";
  /** Long form, always rendered for screen readers even when the tooltip is not open. */
  description: string;
}

export function verificationPresentation(
  level: VerificationLevel,
  distinctDomains: number,
): VerificationPresentation {
  switch (level) {
    case "verified":
      return {
        label: "Verified",
        short: "Verified",
        badge: "success",
        description:
          "Published on the source's own domain, or corroborated across publishers including the primary source.",
      };
    case "corroborated":
      return {
        label: `${distinctDomains} sources`,
        short: `${distinctDomains}×`,
        badge: "primary",
        description: `Independently reported by ${distinctDomains} publishers on different domains.`,
      };
    case "reported":
      return {
        label: "Reported",
        short: "Reported",
        badge: "default",
        description:
          "One trusted source linking to its own article. Not yet corroborated elsewhere.",
      };
    case "unconfirmed":
      return {
        label: "Unconfirmed",
        short: "Unconfirmed",
        badge: "amber",
        description:
          "The link does not resolve to the publisher's own domain, so Atlas cannot confirm who published this.",
      };
  }
}

/** `theverge.com` from a host, for the compact rows where space is tight. */
export function shortHost(host: string): string {
  return host.replace(/^www\./, "");
}

/** Highlight query matches in a title without dangerouslySetInnerHTML. */
export interface TextSegment {
  text: string;
  match: boolean;
}

export function highlightSegments(text: string, query: string): TextSegment[] {
  const needle = query.trim().toLowerCase();
  if (!needle || needle.length < 2) return [{ text, match: false }];

  const segments: TextSegment[] = [];
  const haystack = text.toLowerCase();
  let cursor = 0;

  for (;;) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) break;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length ? segments : [{ text, match: false }];
}

/** The single line of attribution under a headline. */
export function attributionLine(article: Pick<NewsArticle, "sourceName" | "host" | "author">): string {
  return article.author ? `${article.sourceName} · ${article.author}` : article.sourceName;
}
