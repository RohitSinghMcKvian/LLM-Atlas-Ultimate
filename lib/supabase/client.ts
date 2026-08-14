"use client";

// Lazy Supabase browser client (Phase 7): the SDK is loaded with a dynamic
// import on FIRST USE, not at page load — it was ~70kB gz of every surface's
// First Load JS via the repo modules. Configuration checks stay synchronous
// (env vars are inlined at build time).
//
// Uses `@supabase/ssr`'s browser client rather than `createClient` so the auth
// session is stored in cookies instead of localStorage. That is what lets
// middleware and server components see the same session, and it is required for
// the auth.uid()-scoped RLS added in migration 0005 — every query now carries
// the caller's identity, so an unauthenticated browser simply sees nothing.

import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: Promise<SupabaseClient | null> | null = null;

/**
 * Browser Supabase client, or null when persistence isn't configured. Callers
 * must handle null gracefully — the app runs fully on local storage without
 * Supabase, and lights up sync the moment credentials are present AND the user
 * is signed in.
 */
export function getSupabaseBrowser(): Promise<SupabaseClient | null> {
  if (!url || !anonKey) return Promise.resolve(null);
  if (!cached) {
    cached = import("@supabase/ssr").then(({ createBrowserClient }) =>
      createBrowserClient(url, anonKey),
    );
  }
  return cached;
}

/** True when the public Supabase env vars are set (safe to read client-side). */
export const isSupabaseConfigured = (): boolean => Boolean(url && anonKey);

/**
 * The signed-in user's id, or null.
 *
 * Storage drivers use this to decide between the local and remote repo: with
 * 0005's policies a signed-out session can read and write nothing, so falling
 * back to local storage is the difference between working offline and silently
 * losing data.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const c = await getSupabaseBrowser();
  if (!c) return null;
  const { data } = await c.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Whether remote persistence should be used for this browser session.
 *
 * Configuration alone is no longer enough. Since migration 0005 every row is
 * gated on `auth.uid()`, so a signed-out client's inserts are rejected and its
 * selects come back empty — it would look like the app was saving while
 * quietly discarding everything. Requiring a session makes the local driver the
 * honest default, which is also what §1.5 (local-first) asks for.
 */
export async function remotePersistenceReady(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    return (await getCurrentUserId()) !== null;
  } catch {
    return false;
  }
}
