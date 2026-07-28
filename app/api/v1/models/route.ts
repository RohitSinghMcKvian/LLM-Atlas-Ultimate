import { NextRequest } from "next/server";
import { allModels, modelAccess, type CatalogModel } from "@/lib/catalog";
import { getCatalogSnapshot } from "@/lib/catalog/store";

export const runtime = "nodejs";
// Reads a runtime snapshot that changes daily; never prerender it.
export const dynamic = "force-dynamic";

/** Fields a caller almost always wants. `?fields=full` returns everything. */
type SummaryModel = Pick<
  CatalogModel,
  "id" | "name" | "provider" | "license" | "access" | "status" | "contextWindow" | "maxOutput" | "modalities" | "capabilities" | "pricing"
> & { routeProviders: string[] };

function summarize(m: CatalogModel): SummaryModel {
  return {
    id: m.id,
    name: m.name,
    provider: m.provider,
    license: m.license,
    access: modelAccess(m),
    status: m.status,
    contextWindow: m.contextWindow,
    maxOutput: m.maxOutput,
    modalities: m.modalities,
    capabilities: m.capabilities,
    pricing: m.pricing,
    routeProviders: [...new Set(m.routes.map((r) => r.provider))],
  };
}

/** Catalog read API. Supports light filtering used by the docs/SDK examples. */
export async function GET(req: NextRequest) {
  const snapshot = await getCatalogSnapshot();
  const { searchParams } = new URL(req.url);
  const license = searchParams.get("license");
  const access = searchParams.get("access"); // "free" | "byok"
  const minContext = Number(searchParams.get("minContext") ?? 0);
  const caps = searchParams.get("caps")?.split(",").filter(Boolean) ?? [];

  let models: CatalogModel[] = allModels();
  if (license) models = models.filter((m) => m.license === license);
  if (access) models = models.filter((m) => modelAccess(m) === access);
  if (minContext) models = models.filter((m) => m.contextWindow >= minContext);
  if (caps.includes("vision"))
    models = models.filter((m) => m.modalities.includes("vision"));
  if (caps.includes("reasoning"))
    models = models.filter((m) => m.capabilities.reasoning);
  if (caps.includes("tools"))
    models = models.filter((m) => m.capabilities.toolUse);

  const total = models.length;

  // This endpoint is public and unauthenticated. The catalog grew from ~100 to
  // ~400 models, so the full payload is now ~370 KB — default to a summary
  // projection and require an explicit opt-in for the rest.
  const limit = clampLimit(searchParams.get("limit"));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0) || 0);
  const page = models.slice(offset, offset + limit);
  const full = searchParams.get("fields") === "full";

  return Response.json({
    count: page.length,
    total,
    offset,
    limit,
    syncedAt: snapshot.syncedAt,
    catalogVersion: snapshot.version,
    models: full ? page : page.map(summarize),
  });
}

function clampLimit(raw: string | null): number {
  const n = Number(raw ?? 100);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(Math.trunc(n), 500);
}
