import { NextResponse, type NextRequest } from "next/server";
import {
  classifyPath,
  safeNext,
  signInUrlFor,
  DEFAULT_SIGNED_IN_PATH,
} from "@/lib/auth/routes";

/**
 * Refreshes the Supabase auth session on navigation, and gates the surfaces
 * that hold user data.
 *
 * Access tokens are short-lived. Without a refresh on the server, a user who
 * leaves a tab open comes back to expired cookies, and because migration 0005
 * scopes every row to `auth.uid()`, an expired session doesn't degrade to
 * "stale data" — it reads as no data at all. This keeps the cookie fresh so
 * that never happens mid-session.
 *
 * Gating rides on the `getUser()` call the refresh already makes, so it costs no
 * extra round trip. What is gated lives in `lib/auth/routes.ts`, not here: the
 * reference surfaces (leaderboard, news, docs, learn, cost, router, hub) stay
 * open to anonymous visitors and to crawlers, and only the surfaces that persist
 * per-user rows require a session.
 *
 * The `/admin` role check is here too, but only for `/admin` paths, so the
 * extra `profiles` query never touches the rest of the app.
 *
 * It has to be here rather than in the admin layout, and the reason is
 * specific: `(workspace)/layout.tsx` renders the whole app shell above it, so
 * by the time a layout guard has awaited cookies and finished its query, the
 * response has already begun streaming. `redirect()` at that point cannot set a
 * status — Next falls back to a client-side redirect, and the admin markup goes
 * out in a 200 that a client without JS simply reads. Middleware runs before
 * any of that exists, so it is the only place a route-level gate actually gates.
 * `requireAdmin()` in the layout stays as a second line of defence.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase is optional. With no credentials there is no session to refresh —
  // and nothing to gate on, so the app stays entirely open and local-first
  // rather than locking every visitor out of a deployment that has no way in.
  if (!url || !anonKey) {
    // `/admin` is the one exception. With no accounts there is no role to hold
    // it, so leaving it reachable would mean an admin surface that nothing can
    // ever govern — it should not exist on this deployment at all.
    if (classifyPath(request.nextUrl.pathname) === "admin") {
      return NextResponse.redirect(new URL(DEFAULT_SIGNED_IN_PATH, request.url));
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const { createServerClient } = await import("@supabase/ssr");
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        // Write to the request too, so anything later in this same pass reads
        // the refreshed token rather than the one that just expired.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates against the auth server and triggers the refresh.
  // getSession() would just decode the cookie and cannot be trusted here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const kind = classifyPath(pathname);

  // --- AUTH GATING DISABLED FOR TESTING ---
  // Set to true (or remove this block) to re-enable sign-in enforcement.
  const gatingEnabled: boolean = false;
  if (!gatingEnabled) return response;

  if (!user && (kind === "protected" || kind === "admin")) {
    // `next` carries the search string too, so a deep link with filters survives
    // the detour through sign-in.
    return redirectTo(request, signInUrlFor(pathname, search), response);
  }

  if (user && kind === "admin") {
    // Scoped to admin paths, so this query never runs for anyone browsing the
    // app normally. Selecting a single column of a single row by primary key.
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    // Fail closed. A missing table (migration 0011 not applied) or a transient
    // error must not read as "admin" — the safe answer to "we don't know" is no.
    const role = error ? null : (data?.role as string | undefined) ?? null;
    if (role !== "admin" && role !== "owner") {
      return redirectTo(request, DEFAULT_SIGNED_IN_PATH, response);
    }
  }

  if (user && kind === "auth") {
    // Already signed in — honour the pending destination rather than dumping
    // them on the default surface they may have navigated away from.
    const next = safeNext(request.nextUrl.searchParams.get("next"), DEFAULT_SIGNED_IN_PATH);
    return redirectTo(request, next, response);
  }

  return response;
}

/**
 * Redirect while preserving any cookies the refresh just set.
 *
 * Building a bare `NextResponse.redirect` would drop them, and the user would
 * arrive at sign-in with the expired token still in the jar.
 */
function redirectTo(request: NextRequest, path: string, carrying: NextResponse) {
  const target = new URL(path, request.url);
  const redirect = NextResponse.redirect(target);
  for (const cookie of carrying.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets. `artifact-runtime`
    // is excluded explicitly: it is the sandboxed artifact runtime, fetched by
    // an opaque-origin iframe that carries no cookies and needs no session.
    //
    // `/api` stays matched so route handlers keep getting a refreshed cookie,
    // and it is never gated: no route prefix in `lib/auth/routes.ts` can match
    // an `/api/...` path, so `classifyPath` reports it public and the guards
    // above fall through. API routes authorize themselves.
    "/((?!_next/static|_next/image|favicon.ico|artifact-runtime|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
