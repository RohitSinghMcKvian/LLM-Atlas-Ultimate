import { configuredProviderIds } from "@/lib/router";
import { PROVIDER_LIST } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports which providers are configured — without ever exposing keys. */
export async function GET() {
  const configured = configuredProviderIds();
  // Free open models work as long as ANY operator provider is connected.
  const freeReady =
    configured.includes("nvidia") ||
    configured.includes("openrouter") ||
    configured.includes("local");
  // Operator key serves paid models too (no user BYOK key needed).
  const servePaid =
    process.env.OPERATOR_SERVE_PAID === "true" && configured.includes("openrouter");
  return Response.json({
    any: configured.length > 0,
    freeReady,
    servePaid,
    configured,
    // The client needs this to reach the same free/metered verdict the server
    // does — see `lib/catalog/availability.ts`. It is an operator policy knob,
    // not a secret.
    freeCeilingPerM: Number(process.env.ATLAS_FREE_OPEN_CEILING_PER_M ?? 0) || 0,
    providers: PROVIDER_LIST.map((p) => ({
      id: p.id,
      name: p.name,
      configured: configured.includes(p.id),
    })),
  });
}
