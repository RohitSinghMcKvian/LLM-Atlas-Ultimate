"use client";

/**
 * Client-side auth operations.
 *
 * Every entry point returns `{ error: string | null }` rather than throwing, and
 * every message goes through `friendlyAuthError()` — raw Supabase strings leak
 * implementation vocabulary ("Signups not allowed for otp") into a surface where
 * a person is trying to get into their account.
 *
 * Nothing here handles a password, and nothing here should start: sign-in is
 * OAuth, a one-time link, or a one-time code, so Atlas has no credential to
 * store, leak, or reset.
 */

import { getSupabaseBrowser } from "@/lib/supabase/client";
import { resetChatRepo } from "@/lib/chat/repo";
import { resetCodeSessionsRepo } from "@/lib/code/sessions";
import { resetPlaygroundRepo } from "@/lib/playground/repo";
import { safeNext } from "@/lib/auth/routes";
import type { AuthProviderId } from "@/lib/auth/providers";
import type { Provider } from "@supabase/supabase-js";

export interface AuthResult {
  error: string | null;
}

const NOT_CONFIGURED = "Sync isn't configured for this deployment.";

/**
 * Drop cached repo drivers so the next call re-picks local vs. remote.
 *
 * Mirrors the helper in `lib/hooks/use-auth.ts`; both transitions must reset or
 * a signed-in session keeps writing to the local driver it cached while signed
 * out, and the sync the user just enabled silently does nothing.
 */
export function invalidateRepos() {
  resetChatRepo();
  resetCodeSessionsRepo();
  resetPlaygroundRepo();
}

/**
 * Turn a provider or Supabase message into something worth reading.
 *
 * Matching is on substrings because Supabase does not expose stable codes for
 * most of these. Anything unrecognized falls through unchanged rather than being
 * replaced with a generic apology — a real message the user can search for beats
 * "Something went wrong."
 */
export function friendlyAuthError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.toLowerCase();

  if (m.includes("signups not allowed") || m.includes("signup is disabled")) {
    // The deliberate account-enumeration tradeoff: telling someone their address
    // has no account is the difference between a dead end and a next step. Swap
    // this for a generic line if that tradeoff isn't right for your deployment.
    return "No Atlas account uses that address yet. Create one instead.";
  }
  if (m.includes("user already registered") || m.includes("already been registered")) {
    return "That address already has an Atlas account. Sign in instead.";
  }
  if (m.includes("rate limit") || m.includes("too many requests") || m.includes("429")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (m.includes("expired") || m.includes("invalid or has expired")) {
    return "That code has expired. Send a new one.";
  }
  if (m.includes("token has expired or is invalid") || m.includes("invalid token")) {
    return "That code isn't right. Check the six digits and try again.";
  }
  if (m.includes("invalid email") || m.includes("unable to validate email")) {
    return "That doesn't look like an email address.";
  }
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) {
    return "That sign-in method isn't enabled for this deployment.";
  }
  if (m.includes("failed to fetch") || m.includes("networkerror")) {
    return "Couldn't reach the sign-in service. Check your connection.";
  }
  return raw;
}

function redirectTarget(next: string | null | undefined): string {
  const dest = safeNext(next);
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(dest)}`;
}

/**
 * Hand off to an OAuth provider.
 *
 * On success this never returns — the browser navigates away — so callers should
 * leave their pending state set rather than clearing it in a `finally`.
 *
 * PKCE works across the redirect because `lib/supabase/client.ts` builds the
 * browser client with `createBrowserClient`, which stores the code verifier in a
 * cookie. That is the same cookie jar `app/auth/callback/route.ts` reads from on
 * the server, which is what makes the exchange possible at all.
 */
export async function signInWithProvider(
  provider: AuthProviderId,
  next?: string | null,
): Promise<AuthResult> {
  const c = await getSupabaseBrowser();
  if (!c) return { error: NOT_CONFIGURED };
  const { error } = await c.auth.signInWithOAuth({
    provider: provider as Provider,
    options: { redirectTo: redirectTarget(next) },
  });
  return { error: friendlyAuthError(error?.message) };
}

/**
 * Email a sign-in link and a six-digit code.
 *
 * One call sends both — which the recipient gets depends on the Supabase email
 * template. `{{ .Token }}` has to be in the Magic Link template or the code
 * never arrives and the OTP step has nothing to verify.
 *
 * `create` is the entire distinction between registering and signing in. On
 * `/login` it is false, so an unknown address is refused instead of quietly
 * creating an account for someone who mistyped their own.
 */
export async function sendEmailCode(
  email: string,
  { create, next }: { create: boolean; next?: string | null },
): Promise<AuthResult> {
  const c = await getSupabaseBrowser();
  if (!c) return { error: NOT_CONFIGURED };
  const { error } = await c.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: create,
      emailRedirectTo: redirectTarget(next),
    },
  });
  return { error: friendlyAuthError(error?.message) };
}

/**
 * Exchange a six-digit code for a session.
 *
 * `type: "email"` covers both a first-time signup code and a returning sign-in
 * code; Supabase resolves which from the pending flow on its side.
 */
export async function verifyEmailCode(email: string, token: string): Promise<AuthResult> {
  const c = await getSupabaseBrowser();
  if (!c) return { error: NOT_CONFIGURED };
  const { error } = await c.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email",
  });
  if (error) return { error: friendlyAuthError(error.message) };
  invalidateRepos();
  return { error: null };
}

/**
 * End the session in this tab and on the server.
 *
 * The local call clears the client's in-memory session and fires
 * `onAuthStateChange` so the UI updates immediately; the POST to
 * `/auth/signout` is what actually expires the cookies for server components
 * and middleware. Doing only the first leaves an SSR render still believing the
 * user is signed in.
 */
export async function signOutEverywhere(): Promise<void> {
  const c = await getSupabaseBrowser();
  if (c) await c.auth.signOut();
  invalidateRepos();
  try {
    await fetch("/auth/signout", { method: "POST" });
  } catch {
    // The client session is already gone; a failed cookie clear is recoverable
    // on the next request, and blocking sign-out on the network is not.
  }
}
