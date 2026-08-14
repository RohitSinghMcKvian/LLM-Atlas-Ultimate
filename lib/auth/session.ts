import "server-only";

/**
 * Server-side session and role reads.
 *
 * Built on `getSupabaseRouteClient`, which acts *as the signed-in user* — the
 * anon key plus their cookies — so RLS applies and a bug here leaks nothing.
 * `getSupabaseServer()` (service role) is deliberately not used: an auth guard
 * that bypasses RLS to decide what someone may see is the wrong shape.
 *
 * The role check lives here rather than in middleware because it costs a query.
 * Middleware runs on every request in the app; the admin layout runs on the
 * handful that actually ask for `/admin`.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseRouteClient } from "@/lib/supabase/server";
import { signInUrlFor, DEFAULT_SIGNED_IN_PATH } from "@/lib/auth/routes";
import type { Profile, UserRole } from "@/lib/supabase/types";

export interface SessionUser {
  id: string;
  email: string | null;
}

async function client() {
  return getSupabaseRouteClient(await cookies());
}

/**
 * The signed-in user, or null.
 *
 * `getUser()` rather than `getSession()`: the latter only decodes the cookie,
 * which is attacker-controlled input. A guard has to ask the auth server.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const c = await client();
  if (!c) return null;
  const { data, error } = await c.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** The caller's profile row, or null when signed out or before migration 0011. */
export async function getProfile(): Promise<Profile | null> {
  const c = await client();
  if (!c) return null;
  const { data: auth } = await c.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await c
    .from("profiles")
    .select("id, email, display_name, avatar_url, role, created_at, updated_at")
    .eq("id", auth.user.id)
    .maybeSingle();
  // A missing table (0011 not applied) must not 500 the page — the app still
  // works without a profile, it just has no name or role to show.
  if (error) return null;
  return (data as Profile) ?? null;
}

export function isAdminRole(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "owner";
}

/** Redirects to sign-in when there is no session. Returns the user otherwise. */
export async function requireUser(returnTo = DEFAULT_SIGNED_IN_PATH): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(signInUrlFor(returnTo));
  return user;
}

/**
 * Requires an admin. Sends anonymous callers to sign in and everyone else home.
 *
 * A signed-in non-admin gets a redirect rather than a 403 page, so `/admin`
 * never confirms to a curious account that it exists.
 */
export async function requireAdmin(returnTo = "/admin"): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) {
    const user = await getSessionUser();
    if (!user) redirect(signInUrlFor(returnTo));
    redirect(DEFAULT_SIGNED_IN_PATH);
  }
  if (!isAdminRole(profile.role)) redirect(DEFAULT_SIGNED_IN_PATH);
  return profile;
}
