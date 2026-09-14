import { PROVIDERS } from "@/lib/catalog";
import { configuredProviderIds } from "@/lib/router";
import { hasCreditGrant } from "@/lib/catalog/providers";
import { laneQuotas } from "@/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How much of each operator-funded free tier is left.
 *
 * **Operator lanes only, on purpose.** A lane running on the user's own key is
 * counted in their browser, not here: the quota is theirs, the server never
 * sees the key, and a server-side figure would be a guess about an allowance it
 * cannot observe. The response says which lanes it is reporting on so the UI
 * never has to infer it.
 *
 * Lanes with a *grant* rather than a recurring tier (Cerebras' trial, xAI's
 * credits) appear with `kind: "grant"` and no numbers — there is no window to
 * count and no balance Atlas can read. Showing "Credits" beats inventing a bar.
 */
export async function GET() {
  const configured = configuredProviderIds();
  const quotas = await laneQuotas(configured);
  const now = Date.now();

  const lanes = configured.map((id) => {
    const meta = PROVIDERS[id];
    const windows = quotas.get(id) ?? [];
    return {
      id,
      name: meta.name,
      kind: meta.freeTier?.quota.kind ?? null,
      /** True only for a genuinely free, resetting allowance. */
      credits: hasCreditGrant(meta),
      windows: windows.map((w) => ({
        window: w.kind,
        unit: w.unit,
        limit: w.limit,
        used: w.used,
        remaining: Math.max(0, w.limit - w.used),
        resetsAt: w.resetsAt,
      })),
    };
  });

  return Response.json({
    now,
    /** The subject these counters belong to. See lib/quota/index.ts. */
    subject: "operator",
    /** False when nothing is persisted, so the UI can caveat the numbers. */
    durable: Boolean(
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
        process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    lanes,
  });
}
