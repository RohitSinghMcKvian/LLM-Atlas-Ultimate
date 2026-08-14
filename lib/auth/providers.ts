/**
 * OAuth providers offered on the sign-in surfaces.
 *
 * Which providers actually work is decided in the Supabase dashboard, not here
 * — enabling one needs a client id and secret that only the operator has. So the
 * button list is driven by `NEXT_PUBLIC_AUTH_PROVIDERS` rather than hardcoded:
 * a provider renders only when the deployment says it is configured. The
 * alternative is a Google button that 400s on a deployment where Google was
 * never set up, which is worse than no Google button.
 *
 * Ordering in `AUTH_PROVIDERS` is the display order; the env var only filters.
 */

export type AuthProviderId =
  | "google"
  | "github"
  | "azure"
  | "apple"
  | "gitlab"
  | "discord";

export interface AuthProviderMeta {
  id: AuthProviderId;
  /** Shown as "Continue with {label}". */
  label: string;
  /**
   * Brand tint for the icon well, as a Tailwind arbitrary colour. Only the mark
   * carries brand colour — the buttons themselves stay in the Atlas palette, so
   * six providers don't turn the panel into a sticker sheet.
   */
  tint: string;
}

export const AUTH_PROVIDERS: readonly AuthProviderMeta[] = [
  { id: "google", label: "Google", tint: "#EA4335" },
  { id: "github", label: "GitHub", tint: "#8B91A3" },
  { id: "azure", label: "Microsoft", tint: "#00A4EF" },
  { id: "apple", label: "Apple", tint: "#A1A1AA" },
  { id: "gitlab", label: "GitLab", tint: "#FC6D26" },
  { id: "discord", label: "Discord", tint: "#5865F2" },
] as const;

const BY_ID = new Map(AUTH_PROVIDERS.map((p) => [p.id, p]));

/**
 * Providers enabled for this deployment, in display order.
 *
 * `NEXT_PUBLIC_AUTH_PROVIDERS` is inlined at build time, so this is a synchronous
 * read with no client-side cost. Unknown ids are dropped silently: a typo should
 * cost one missing button, not a crashed sign-in page.
 */
export function enabledProviders(): AuthProviderMeta[] {
  const raw = process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "";
  const wanted = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  if (wanted.size === 0) return [];
  return AUTH_PROVIDERS.filter((p) => wanted.has(p.id));
}

export function providerMeta(id: string): AuthProviderMeta | undefined {
  return BY_ID.get(id as AuthProviderId);
}
