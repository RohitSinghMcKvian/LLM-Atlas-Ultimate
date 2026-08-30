import { configuredProviderIds, routeEnv } from "@/lib/router";
import { PROVIDER_LIST } from "@/lib/catalog";
import { servableModelId } from "@/lib/catalog/defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports which providers are configured — without ever exposing keys. */
export async function GET() {
  const configured = configuredProviderIds();

  // Asked of the catalog, not of a provider list.
  //
  // This used to be `nvidia || openrouter || local`, hardcoded, and it was wrong
  // in both directions. Google AI Studio and Groq are `operator-funded` — both
  // have genuinely free tiers, and Groq is the only working route for several
  // models — yet an operator whose one key was `GROQ_API_KEY` was told "No
  // operator provider connected". Meanwhile OpenRouter alone reported ready when
  // it is `metered`: unless the catalog happens to hold `:free` variants or
  // $0-priced listings, an OpenRouter-only operator can serve zero free models.
  //
  // Asking whether a free model can actually be named — through the same
  // `modelAvailability` the router routes on — answers the question exactly, and
  // cannot drift when a sixth provider is added or the catalog resyncs.
  const freeReady = servableModelId(routeEnv(), [], { free: true }) !== undefined;

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
