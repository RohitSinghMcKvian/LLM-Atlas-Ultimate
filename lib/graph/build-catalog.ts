import type {
  BenchmarkDef,
  CatalogModel,
  ModelPricing,
} from "@/lib/catalog/types";
import type { ProviderMeta } from "@/lib/catalog/providers";
import { emptyDelta, nodeId, type GraphDelta, type GraphEdge, type GraphNode } from "./types";

/**
 * The catalog half of the graph.
 *
 * Pure and isomorphic: it takes the data it needs as arguments and touches no
 * browser global, because the same function runs in the browser (from the
 * hydrated snapshot) and on the server (for the public MCP endpoint). Importing
 * `allModels()` here instead would have bound it to the client store and made
 * the server path impossible.
 *
 * Everything below is *derived from the snapshot*, never invented. Where a
 * derived fact is a judgement — the price bands — the thresholds are stated in
 * the code and carried on the node as props, so a reader can disagree with the
 * bucketing without being misled about the number.
 */

/**
 * Price bands, in USD per 1M tokens of blended input+output at a 3:1 ratio.
 *
 * They exist because "cheap models" is a real question and a bag-of-words
 * embedder cannot get there from "$0.35": tokenisation drops the currency and
 * the decimal, leaving the bare number 35, which matches nothing useful. A band
 * gives the question a word to land on and the traversal an edge to follow.
 *
 * The 3:1 weighting matches `blendedPrice()` in `lib/catalog/index.ts` so the
 * band and the number the UI prints cannot disagree.
 */
export const PRICE_BANDS = [
  { id: "budget", label: "Budget", max: 1, about: "under $1 per 1M blended tokens" },
  { id: "mid-priced", label: "Mid-priced", max: 10, about: "$1–$10 per 1M blended tokens" },
  { id: "premium", label: "Premium", max: Infinity, about: "over $10 per 1M blended tokens" },
] as const;

/** Same 3:1 input:output weighting as `blendedPrice()`. */
export function blendedRate(p: ModelPricing): number {
  return (p.inputPerM * 3 + p.outputPerM) / 4;
}

export function priceBandFor(p: ModelPricing): (typeof PRICE_BANDS)[number] {
  const rate = blendedRate(p);
  return PRICE_BANDS.find((b) => rate < b.max) ?? PRICE_BANDS[PRICE_BANDS.length - 1];
}

const CAPABILITY_LABELS: Record<string, { label: string; about: string }> = {
  toolUse: { label: "Tool use", about: "Can call functions and tools." },
  structuredOutput: { label: "Structured output", about: "Can be constrained to JSON or a schema." },
  reasoning: { label: "Reasoning", about: "Exposes extended thinking before answering." },
  caching: { label: "Prompt caching", about: "Bills repeated prefixes at a reduced rate." },
};

const MODALITY_LABELS: Record<string, string> = {
  text: "Text",
  vision: "Images in",
  audio: "Audio in",
  image: "Images out",
};

export interface CatalogGraphInput {
  models: CatalogModel[];
  benchmarks: BenchmarkDef[];
  providers: ProviderMeta[];
}

export function buildCatalogGraph(input: CatalogGraphInput): GraphDelta {
  const delta = emptyDelta();
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const add = (n: GraphNode) => {
    const prev = nodes.get(n.id);
    if (!prev || n.text.length > prev.text.length) nodes.set(n.id, n);
  };
  const link = (
    from: string,
    kind: GraphEdge["kind"],
    to: string,
    weight: number,
    props?: GraphEdge["props"],
  ) => {
    edges.push({ from, to, kind, weight, props });
  };

  const benchmarkById = new Map(input.benchmarks.map((b) => [b.key, b]));

  for (const b of input.benchmarks) {
    add({
      id: nodeId("benchmark", b.key),
      kind: "benchmark",
      label: b.label,
      summary: `${b.label} — ${b.about} Measured in ${b.unit === "elo" ? "Elo" : "percent"}, ${b.higherBetter ? "higher is better" : "lower is better"}.`,
      text: `${b.label} ${b.key} benchmark ${b.category} ${b.about}`,
      props: { key: b.key, category: b.category, unit: b.unit, max: b.max },
    });
  }

  for (const p of input.providers) {
    add({
      id: nodeId("provider", p.id),
      kind: "provider",
      label: p.name,
      summary: `${p.name} — ${p.about}`,
      text: `${p.name} ${p.short} ${p.id} inference provider ${p.about} ${p.billing}`,
      props: { providerId: p.id, billing: p.billing, baseUrl: p.defaultBaseUrl },
    });
  }

  for (const band of PRICE_BANDS) {
    add({
      id: nodeId("tag", `price-${band.id}`),
      kind: "tag",
      label: band.label,
      summary: `${band.label} pricing — ${band.about}. Band derived from the catalog's own blended rate; the exact price is on each model.`,
      text: `${band.label} price band ${band.about} cheap affordable expensive cost`,
      props: { derived: true, kind: "price-band" },
    });
  }

  for (const cap of Object.keys(CAPABILITY_LABELS)) {
    const meta = CAPABILITY_LABELS[cap];
    add({
      id: nodeId("capability", cap),
      kind: "capability",
      label: meta.label,
      summary: `${meta.label} — ${meta.about}`,
      text: `${meta.label} ${cap} capability ${meta.about}`,
      props: { capability: cap },
    });
  }

  for (const m of input.models) {
    const modelNode = nodeId("model", m.id);
    const band = priceBandFor(m.pricing);
    const scored = m.benchmarks
      .map((s) => {
        const def = benchmarkById.get(s.key);
        return def ? `${def.label} ${s.score}${def.unit === "%" ? "%" : ""}` : null;
      })
      .filter((s): s is string => s !== null);

    const capabilities = Object.entries(m.capabilities)
      .filter(([, on]) => on)
      .map(([k]) => CAPABILITY_LABELS[k]?.label ?? k);

    add({
      id: modelNode,
      kind: "model",
      label: m.name,
      summary: summarizeModel(m, band.label),
      // Aliases matter more than prose here: the question says "llama 3.1" or
      // "the 70b" or "Meta's model", and every one of those has to land.
      text: [
        m.name,
        m.id,
        m.provider,
        m.family,
        m.license === "open" ? "open weights open licence" : "proprietary closed",
        m.status,
        `${band.label} price band`,
        `${m.contextWindow} context window`,
        ...capabilities,
        ...(m.tags ?? []),
        ...scored,
        m.blurb,
      ]
        .filter(Boolean)
        .join(" "),
      props: {
        modelId: m.id,
        brand: m.provider,
        family: m.family,
        license: m.license,
        status: m.status,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
        inputPerM: m.pricing.inputPerM,
        outputPerM: m.pricing.outputPerM,
        blendedPerM: Number(blendedRate(m.pricing).toFixed(4)),
        releaseDate: m.releaseDate,
        ...(m.latencyMs ? { latencyMs: m.latencyMs } : {}),
        ...(m.throughputTps ? { throughputTps: m.throughputTps } : {}),
        ...(m.metaConfidence ? { metaConfidence: m.metaConfidence } : {}),
      },
    });

    // Brand
    const brand = nodeId("brand", m.provider);
    add({
      id: brand,
      kind: "brand",
      label: m.provider,
      summary: `${m.provider} — a model developer in the Atlas catalog.`,
      text: `${m.provider} brand developer lab model family`,
      props: { name: m.provider },
    });
    link(modelNode, "made_by", brand, 0.55);

    // Family
    if (m.family) {
      const family = nodeId("family", `${m.provider}-${m.family}`);
      add({
        id: family,
        kind: "family",
        label: m.family,
        summary: `${m.family} — a model family from ${m.provider}.`,
        text: `${m.family} family ${m.provider} generation series`,
        props: { name: m.family, brand: m.provider },
      });
      link(modelNode, "in_family", family, 0.7);
      link(family, "made_by", brand, 0.6);
    }

    // Routes → providers. Weighted highest of the structural edges: which
    // provider serves a model is the fact that decides whether the user can run
    // it at all.
    for (const r of m.routes) {
      link(modelNode, "routed_via", nodeId("provider", r.provider), 0.75, {
        providerModel: r.model,
      });
    }

    // Benchmarks. The strongest edge in the graph: a score is the comparison
    // the whole leaderboard is built on, and it is what a relational question
    // is almost always actually about.
    for (const s of m.benchmarks) {
      const def = benchmarkById.get(s.key);
      if (!def) continue;
      link(modelNode, "scored_on", nodeId("benchmark", s.key), 0.95, {
        score: s.score,
        unit: def.unit,
        source: s.source,
        measuredAt: s.measuredAt,
      });
    }

    for (const [cap, on] of Object.entries(m.capabilities)) {
      if (on && CAPABILITY_LABELS[cap]) link(modelNode, "has_capability", nodeId("capability", cap), 0.4);
    }

    for (const mod of m.modalities) {
      const id = nodeId("modality", mod);
      add({
        id,
        kind: "modality",
        label: MODALITY_LABELS[mod] ?? mod,
        summary: `${MODALITY_LABELS[mod] ?? mod} — an input modality.`,
        text: `${MODALITY_LABELS[mod] ?? mod} ${mod} input modality`,
        props: { modality: mod, direction: "in" },
      });
      link(modelNode, "accepts", id, 0.35);
    }

    for (const mod of m.outputModalities ?? []) {
      const id = nodeId("modality", `out-${mod}`);
      add({
        id,
        kind: "modality",
        label: MODALITY_LABELS[mod] ?? mod,
        summary: `${MODALITY_LABELS[mod] ?? mod} — an output modality.`,
        text: `${MODALITY_LABELS[mod] ?? mod} ${mod} output modality generates`,
        props: { modality: mod, direction: "out" },
      });
      link(modelNode, "emits", id, 0.5);
    }

    const license = nodeId("license", m.license);
    add({
      id: license,
      kind: "license",
      label: m.license === "open" ? "Open weights" : "Proprietary",
      summary:
        m.license === "open"
          ? "Open weights — the model can be downloaded and self-hosted."
          : "Proprietary — available only through the provider's API.",
      text:
        m.license === "open"
          ? "open weights open source self-host downloadable licence"
          : "proprietary closed hosted api only licence",
      props: { license: m.license },
    });
    link(modelNode, "licensed_as", license, 0.3);

    link(modelNode, "tagged", nodeId("tag", `price-${band.id}`), 0.35);

    for (const t of m.tags ?? []) {
      const id = nodeId("tag", t);
      add({
        id,
        kind: "tag",
        label: t,
        summary: `Models tagged “${t}” in the Atlas catalog.`,
        text: `${t} tag category`,
        props: { tag: t },
      });
      // Weakest edge in the graph, deliberately. A tag shared by two hundred
      // models is a hub: given real weight it would drag every expansion
      // through it and drown the specific evidence the question needed.
      link(modelNode, "tagged", id, 0.15);
    }
  }

  delta.nodes = [...nodes.values()];
  delta.edges = edges;
  return delta;
}

function summarizeModel(m: CatalogModel, bandLabel: string): string {
  const price = `$${m.pricing.inputPerM}/M in, $${m.pricing.outputPerM}/M out`;
  const ctx = `${formatCount(m.contextWindow)} context`;
  const lic = m.license === "open" ? "open weights" : "proprietary";
  const status = m.status === "ga" ? "" : ` (${m.status})`;
  return `${m.name} by ${m.provider}${status} — ${lic}, ${ctx}, ${price} (${bandLabel.toLowerCase()}).`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
