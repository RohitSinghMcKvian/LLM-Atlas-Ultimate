import { Hero } from "@/components/landing/hero";
import { ProofStrip } from "@/components/landing/proof-strip";
import { EcosystemMap } from "@/components/landing/ecosystem-map";
import { FeatureSections } from "@/components/landing/feature-sections";
import { OpenSource } from "@/components/landing/open-source";
import { Architecture } from "@/components/landing/architecture";
import { SocialProof } from "@/components/landing/social-proof";
import { ClosingCTA } from "@/components/landing/closing-cta";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <ProofStrip />
      <EcosystemMap />
      <FeatureSections />
      <OpenSource />
      <Architecture />
      <SocialProof />
      <ClosingCTA />
    </>
  );
}
