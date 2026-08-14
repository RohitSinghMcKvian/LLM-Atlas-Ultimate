import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Magic-link / OAuth landing point. Supabase redirects here with a one-time
 * `code`; exchanging it sets the session cookies that middleware then keeps
 * fresh, and that RLS reads `auth.uid()` from.
 *
 * Always redirects rather than rendering, so the single-use code never sticks
 * around in the address bar or in history.
 *
 * Failures go back to `/login` carrying a coarse reason code rather than to a
 * dedicated error page: whatever went wrong, the next thing the person wants is
 * the sign-in form, and an error page would be a dead end in front of it. The
 * reason is a closed vocabulary `AuthForm` knows how to explain — provider error
 * text is never echoed into the URL, because it can carry both the address that
 * was attempted and text an attacker chose.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  // Only ever a same-origin path, so a crafted link can't bounce the user off-site.
  const next = safeNext(searchParams.get("next"));

  const fail = (reason: string) =>
    NextResponse.redirect(
      `${origin}/login?error=${reason}&next=${encodeURIComponent(next)}`,
    );

  // A provider that refused reports it here rather than sending a code — this is
  // the "user clicked Cancel on the Google consent screen" path, which is not an
  // error so much as a change of mind.
  const providerError = searchParams.get("error");
  if (providerError) {
    return fail(providerError === "access_denied" ? "access_denied" : "provider");
  }

  if (!code) return fail("missing_code");

  const supabase = await getSupabaseRouteClient(await cookies());
  if (!supabase) return fail("not_configured");

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // An expired or already-used link is by far the most common failure, and it
    // deserves a different page than a genuine fault.
    const m = error.message.toLowerCase();
    const expired =
      m.includes("expired") || m.includes("invalid") || m.includes("already");
    return fail(expired ? "expired" : "exchange");
  }

  return NextResponse.redirect(`${origin}${next}`);
}
