"use client";

// Lazy Supabase browser client (Phase 7): `@supabase/supabase-js` is loaded
// with a dynamic import on FIRST USE, not at page load — it was ~70kB gz of
// every surface's First Load JS via the repo modules. Configuration checks
// stay synchronous (env vars are inlined at build time).

import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: Promise<SupabaseClient | null> | null = null;

/**
 * Browser Supabase client, or null when persistence isn't configured. Callers
 * must handle null gracefully — the app runs fully in-memory without Supabase,
 * and lights up saving/recall the moment credentials are present.
 */
export function getSupabaseBrowser(): Promise<SupabaseClient | null> {
  if (!url || !anonKey) return Promise.resolve(null);
  if (!cached) {
    cached = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      }),
    );
  }
  return cached;
}

/** True when the public Supabase env vars are set (safe to read client-side). */
export const isSupabaseConfigured = (): boolean => Boolean(url && anonKey);
