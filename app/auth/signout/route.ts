import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side sign-out: expires the session cookies.
 *
 * POST only, and deliberately so. As a GET this would be a URL, and any URL can
 * be put in an `<img>`, prefetched by a browser, or followed by a link crawler —
 * all of which would sign people out without them asking.
 *
 * The client calls `supabase.auth.signOut()` first so the UI updates instantly;
 * this is what makes server components and middleware agree.
 */
export async function POST(req: NextRequest) {
  const supabase = await getSupabaseRouteClient(await cookies());
  if (supabase) await supabase.auth.signOut();

  // 303 so the browser follows with GET regardless of how it got here.
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
