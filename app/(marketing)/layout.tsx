import { LandingNav } from "@/components/landing/landing-nav";
import { Footer } from "@/components/landing/footer";
import { AgentDockMount } from "@/components/agent/agent-dock-mount";

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
      {/*
        Here as well as in the workspace, so "anywhere" means anywhere.

        This route is tuned for First Load JS — the model switcher is already
        code-split for exactly that reason — which is why only the rail lands
        here. The agent bundle itself stays behind the dynamic import inside
        this mount and is fetched on first open, so a visitor who never asks
        anything downloads a button and nothing else.
      */}
      <AgentDockMount />
    </div>
  );
}
