import { NextRequest } from "next/server";
import { MODELS, modelAccess } from "@/lib/catalog";

export const runtime = "nodejs";

/** Catalog read API. Supports light filtering used by the docs/SDK examples. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const license = searchParams.get("license");
  const access = searchParams.get("access"); // "free" | "byok"
  const minContext = Number(searchParams.get("minContext") ?? 0);
  const caps = searchParams.get("caps")?.split(",").filter(Boolean) ?? [];

  let models = MODELS;
  if (license) models = models.filter((m) => m.license === license);
  if (access) models = models.filter((m) => modelAccess(m) === access);
  if (minContext) models = models.filter((m) => m.contextWindow >= minContext);
  if (caps.includes("vision"))
    models = models.filter((m) => m.modalities.includes("vision"));
  if (caps.includes("reasoning"))
    models = models.filter((m) => m.capabilities.reasoning);
  if (caps.includes("tools"))
    models = models.filter((m) => m.capabilities.toolUse);

  return Response.json({ count: models.length, models });
}
