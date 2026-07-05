import { isSupabaseServerConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports whether server-side persistence (Supabase) is available. No secrets. */
export async function GET() {
  return Response.json({ configured: isSupabaseServerConfigured() });
}
