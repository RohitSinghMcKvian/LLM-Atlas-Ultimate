import { Hero } from "@/components/landing/hero";
import { ProofStrip, type ProofStats } from "@/components/landing/proof-strip";
import { EcosystemMap } from "@/components/landing/ecosystem-map";
import { FeatureSections } from "@/components/landing/feature-sections";
import { OpenSource } from "@/components/landing/open-source";
import { Architecture } from "@/components/landing/architecture";
import { SocialProof } from "@/components/landing/social-proof";
import { ClosingCTA } from "@/components/landing/closing-cta";
import { modelAvailability } from "@/lib/catalog/availability";
import { isSelectable } from "@/lib/catalog";
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
  const labels = [...selectable]
    .sort((a, b) => Number(Boolean(b.trending)) - Number(Boolean(a.trending)))
    .slice(0, 10)
    .map((m) => m.name);

  return (
    <>
      <Hero labels={labels.length >= 6 ? labels : undefined} />
      <ProofStrip stats={stats} />
      <EcosystemMap />
      <FeatureSections />
      <OpenSource />
      <Architecture />
      <SocialProof />
      <ClosingCTA />
    </>
  );
}
