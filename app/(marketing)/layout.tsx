import { LandingNav } from "@/components/landing/landing-nav";
import { Footer } from "@/components/landing/footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-background">
      <LandingNav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
