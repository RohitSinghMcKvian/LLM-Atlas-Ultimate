"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronRight, Menu, Search } from "lucide-react";
import { AtlasMark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { ModelSwitcher } from "@/components/shell/model-switcher";
import {
  ConnectKeyDialog,
  ConnectKeyButton,
} from "@/components/keys/connect-key-dialog";
import { SyncButton } from "@/components/auth/sync-dialog";
import { CompareRunPill } from "@/components/compare/run-pill";
import { AccountMenu } from "@/components/auth/account-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { MODULES } from "@/lib/modules";
import { useUIStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

/**
 * The bar's two control shapes. Both were spelled out inline at five call
 * sites, so a change to the chrome meant editing all five and missing one.
 */
const CONTROL =
  "border border-border bg-surface-2/60 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground";
const ICON_BUTTON = `grid size-9 place-items-center rounded-lg ${CONTROL}`;
const PILL_BUTTON = `inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 ${CONTROL}`;

function useBreadcrumb() {
  const pathname = usePathname();
  const seg = pathname.split("/").filter(Boolean)[0];
  const mod = MODULES.find((m) => m.href === `/${seg}`);
  return mod?.name ?? (seg ? seg[0].toUpperCase() + seg.slice(1) : "Workspace");
}

export function Topbar() {
  const title = useBreadcrumb();
  const setCommandOpen = useUIStore((s) => s.setCommandOpen);
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-lg sm:px-6">
      {/* Mobile menu + brand */}
      <button
        onClick={() => setMobileNavOpen(true)}
        className={cn(ICON_BUTTON, "lg:hidden")}
        aria-label="Open navigation"
      >
        <Menu className="size-[18px]" />
      </button>

      {/* Breadcrumb */}
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link
          href="/"
          className="hidden items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground sm:flex"
        >
          <AtlasMark size={18} />
          Atlas
        </Link>
        <ChevronRight className="hidden size-3.5 text-muted-foreground/60 sm:block" />
        <span className="truncate font-display font-semibold">{title}</span>
      </div>

      {/* ⌘K search */}
      <button
        onClick={() => setCommandOpen(true)}
        className="group ml-auto hidden h-9 w-full max-w-xs items-center gap-2 rounded-xl border border-border bg-surface-2/50 px-3 text-sm text-muted-foreground transition-colors hover:border-border-strong md:flex"
      >
        <Search className="size-4" />
        <span>Search or jump to…</span>
        <kbd className="ml-auto inline-flex items-center gap-0.5 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-2xs">
          ⌘K
        </kbd>
      </button>

      <button
        onClick={() => setCommandOpen(true)}
        className={cn(ICON_BUTTON, "ml-auto md:hidden")}
        aria-label="Search"
      >
        <Search className="size-[18px]" />
      </button>

      {/* A comparison keeps running after you leave /compare, so it needs to be
          visible from wherever you went. Renders nothing when none is live. */}
      <CompareRunPill className="hidden sm:inline-flex" />

      <ModelSwitcher className="hidden md:inline-flex" />

      {/* Mounted once so a key_required error anywhere can open it */}
      <ConnectKeyDialog />
      <ConnectKeyButton className={cn(PILL_BUTTON)} />

      {/* Renders nothing when Supabase isn't configured. */}
      <SyncButton className={cn(PILL_BUTTON)} />

      {/* Notifications */}
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(ICON_BUTTON, "relative")}>
          <Bell className="size-[18px]" />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-amber" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          <DropdownMenuItem className="flex-col items-start gap-0.5">
            <span className="font-medium text-foreground">
              DeepSeek R1 added to catalog
            </span>
            <span className="text-xs text-muted-foreground">
              Open reasoning model · 12m ago
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem className="flex-col items-start gap-0.5">
            <span className="font-medium text-foreground">
              GPT-4o price drop detected
            </span>
            <span className="text-xs text-muted-foreground">
              Cost engine updated · 1h ago
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ThemeToggle />

      {/* Real identity: signed-in menu, or a sign-in link carrying this route. */}
      <AccountMenu />
    </header>
  );
}
