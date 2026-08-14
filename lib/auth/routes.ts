/**
 * Which routes need a session, and which never should.
 *
 * The single source of truth for gating. Middleware, the admin layout guard and
 * the post-sign-in redirect all read from here, because three copies of a prefix
 * list is three chances for a surface to be quietly ungated after a rename.
 *
 * Framework-free and side-effect-free so it runs in the edge middleware, in
 * server components, and under the node vitest config alike.
 *
 * The split is drawn on one line: does the surface create rows scoped to
 * `auth.uid()` by migration 0005? Reference material — the leaderboard, news,
 * docs, the learn track, price and router comparisons — reads the same for
 * everyone, is worth indexing, and stays open. Anything that persists your work
 * needs to know whose work it is.
 */

/** Surfaces that create per-user rows. Anonymous visitors are redirected. */
export const PROTECTED_PREFIXES = [
  "/chat",
  "/code",
  "/playground",
  "/vault",
  "/notebooks",
  "/datasets",
  "/prompt",
  "/bench",
  "/flow",
] as const;

/** Requires a session AND `role in ('admin','owner')`. */
export const ADMIN_PREFIXES = ["/admin"] as const;

/** The auth surfaces themselves. A signed-in visitor gets bounced off these. */
export const AUTH_PREFIXES = ["/login", "/register"] as const;

/** Where a signed-in user lands when there is no explicit destination. */
export const DEFAULT_SIGNED_IN_PATH = "/chat";

export type PathKind = "public" | "protected" | "admin" | "auth";

/**
 * True when `pathname` is `prefix` or sits beneath it.
 *
 * The segment boundary check is the whole point: a plain `startsWith` would
 * make `/chatterbox` match a `/chat` prefix and gate a route nobody meant to.
 */
function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Classify a pathname. Admin wins over protected; unknown paths are public. */
export function classifyPath(pathname: string): PathKind {
  if (ADMIN_PREFIXES.some((p) => underPrefix(pathname, p))) return "admin";
  if (AUTH_PREFIXES.some((p) => underPrefix(pathname, p))) return "auth";
  if (PROTECTED_PREFIXES.some((p) => underPrefix(pathname, p))) return "protected";
  return "public";
}

export function requiresSession(pathname: string): boolean {
  const kind = classifyPath(pathname);
  return kind === "protected" || kind === "admin";
}

/** Control characters can truncate a header or smuggle a second line into one. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Sanitize a `next=` destination.
 *
 * Anything that isn't a plain same-origin path is discarded rather than
 * repaired, so a crafted sign-in link cannot bounce someone to another site
 * carrying a fresh session. `//evil.com` is the case worth naming: browsers read
 * a protocol-relative URL as absolute, so it survives a naive `startsWith("/")`.
 * Backslashes are rejected too, since some parsers normalize them to `/`.
 */
export function safeNext(
  raw: string | null | undefined,
  fallback = DEFAULT_SIGNED_IN_PATH,
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;
  if (hasControlChar(raw)) return fallback;
  return raw;
}

/** `/login?next=…` for a path the visitor was turned away from. */
export function signInUrlFor(pathname: string, search = ""): string {
  const target = safeNext(`${pathname}${search}`, DEFAULT_SIGNED_IN_PATH);
  return `/login?next=${encodeURIComponent(target)}`;
}
