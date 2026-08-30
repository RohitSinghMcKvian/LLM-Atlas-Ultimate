import { Hero } from "@/components/landing/hero";
import { ProofStrip, type ProofStats } from "@/components/landing/proof-strip";
import { EcosystemMap } from "@/components/landing/ecosystem-map";
import { FeatureSections } from "@/components/landing/feature-sections";
import { OpenSource } from "@/components/landing/open-source";
import { Architecture } from "@/components/landing/architecture";
import { SocialProof, type CoverageData } from "@/components/landing/social-proof";
import { ClosingCTA } from "@/components/landing/closing-cta";
import { modelAvailability } from "@/lib/catalog/availability";
import { isSelectable, trendingModels } from "@/lib/catalog";
import { BENCHMARKS } from "@/lib/catalog/benchmarks";
import { PROVIDER_LIST } from "@/lib/catalog/providers";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { routeEnv } from "@/lib/router";

// The hero and proof strip used to hardcode invented numbers — "195 models",
// "13 providers" — while the catalog actually held 97. They now read the live
// snapshot at build/revalidation time.
//
// ISR rather than a client fetch: the page stays statically served (no LCP cost,
// no request waterfall) and literally implements "refresh every 24h" for the hero.
export const revalidate = 86_400;

export default async function LandingPage() {
  const snapshot = await getCatalogSnapshot();
  const env = routeEnv();

  const selectable = snapshot.models.filter(isSelectable);
  const brands = new Set(selectable.map((m) => m.provider));
  // "Free to run" is deliberately the *runnable* count, not the catalog-wide
  // `stats.free` tier: it is a promise made to a visitor, so it has to mean the
  // models this deployment's keys can actually serve today.
  const free = selectable.filter((m) => modelAvailability(m, env).kind === "free").length;

  const stats: ProofStats = {
    models: selectable.length,
    brands: brands.size,
    free,
    benchmarks: snapshot.stats.benchmarks,
  };

  // The constellation should name models that exist. Trending first, then the rest
  // in catalog order, so the list is stable between revalidations.
  //
  // `trendingModels()` is the same helper the Hub's Trending rail uses, so the
  // hero cannot drift from it. Safe to call here because `getCatalogSnapshot()`
  // above installs the snapshot pointer these selectors read.
  const trending = trendingModels();
  const trendingIds = new Set(trending.map((m) => m.id));
  const ranked = [...trending, ...selectable.filter((m) => !trendingIds.has(m.id))];

  // One model per brand. Both surfaces fed by this list — the constellation and
  // the "compare across models" card — are illustrating *breadth*, and a run of
  // near-identical siblings (three Qwen variants) reads as a narrower catalog
  // than Atlas actually has. Falls back to the plain ranking if that yields too
  // few, so a thin catalog still fills the constellation.
  const seenBrands = new Set<string>();
  const distinct = ranked.filter((m) => {
    if (seenBrands.has(m.provider)) return false;
    seenBrands.add(m.provider);
    return true;
  });
  const labels = (distinct.length >= 6 ? distinct : ranked).slice(0, 10).map((m) => m.name);

  // Coverage replaces the invented GitHub stats and testimonials that used to
  // sit here. Every figure is read off the same snapshot the rest of the page
  // uses, so the section cannot outrun what the catalog holds.
  const coverage: CoverageData = {
    brands: [...brands].sort((a, b) => a.localeCompare(b)),
    providers: PROVIDER_LIST.map((p) => p.name),
    benchmarks: BENCHMARKS.map((b) => b.label),
    modelCount: selectable.length,
    byok: snapshot.stats.byok,
    openWeights: selectable.filter((m) => m.license === "open").length,
    upcoming: snapshot.stats.upcoming,
  };

  return (
    <>
      <Hero labels={labels.length >= 6 ? labels : undefined} />
      <ProofStrip stats={stats} />
      <EcosystemMap />
      <FeatureSections labels={labels.length >= 4 ? labels : undefined} />
      <OpenSource />
      <Architecture />
      <SocialProof coverage={coverage} />
      <ClosingCTA />
    </>
  );
}
