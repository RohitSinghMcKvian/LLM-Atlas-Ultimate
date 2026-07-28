import { NextRequest } from "next/server";
import { allModels, getModelById, type CatalogModel } from "@/lib/catalog";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import {
  apiMonthlyCost,
  DEFAULT_WORKLOAD,
  type Workload,
} from "@/lib/cost/engine";

export const runtime = "nodejs";

interface Body {
  workload?: Partial<Workload>;
  modelIds?: string[];
}

/** Estimate monthly API cost per model for a workload profile. */
export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    /* use defaults */
  }
  await getCatalogSnapshot();

  const workload: Workload = { ...DEFAULT_WORKLOAD, ...(body.workload ?? {}) };
  const models =
    body.modelIds && body.modelIds.length
      ? body.modelIds.map(getModelById).filter(Boolean)
      : allModels().filter((m) => m.status !== "upcoming");

  const results = (models as CatalogModel[])
    .map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      license: m.license,
      cost: apiMonthlyCost(m, workload),
    }))
    .sort((a, b) => a.cost.total - b.cost.total);

  return Response.json({ workload, results });
}
