// Server-only Supabase client. Uses the service-role key, which bypasses RLS —
// import ONLY from server code (API routes / server actions), never from a
// "use client" module. Returns null when persistence isn't configured.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function url() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getSupabaseServer(): SupabaseClient | null {
  const u = url();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!u || !key) return null;
  return createClient(u, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const isSupabaseServerConfigured = (): boolean =>
  Boolean(url() && process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Request-scoped client that acts AS THE SIGNED-IN USER (anon key + their
 * session cookies), so RLS applies normally. This is the opposite of
 * `getSupabaseServer()` above — use that only for operator jobs like the
 * catalog sync that legitimately need to bypass RLS.
 *
 * `cookieStore` is Next's `await cookies()`, passed in so this module stays
 * usable from both route handlers and server components.
 */
export async function getSupabaseRouteClient(cookieStore: {
  getAll: () => { name: string; value: string }[];
  set: (name: string, value: string, options?: Record<string, unknown>) => void;
}): Promise<SupabaseClient | null> {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!u || !anon) return null;
  const { createServerClient } = await import("@supabase/ssr");
  return createServerClient(u, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies; middleware handles the refresh.
        }
      },
    },
  });
}
