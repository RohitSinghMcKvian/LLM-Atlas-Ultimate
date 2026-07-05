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
