import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { MobileTabBar, MobileDrawer } from "@/components/shell/mobile-nav";
import { CommandPalette } from "@/components/command-palette";
import { Shortcuts } from "@/components/shortcuts";
import { PageTransition } from "@/components/shell/page-transition";
import { CatalogHeal } from "@/components/catalog/catalog-heal-mount";
import { AgentDockMount } from "@/components/agent/agent-dock-mount";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 pb-24 lg:pb-0">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <MobileTabBar />
      <MobileDrawer />
      <CommandPalette />
      <Shortcuts />
      <CatalogHeal />
      <AgentDockMount />
    </div>
  );
}
