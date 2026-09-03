"use client";

import * as React from "react";
import Link from "next/link";
import { AppLink } from "@/components/nav/app-link";
import { usePathname } from "next/navigation";
import {
  PanelLeftClose,
  PanelLeftOpen,
  ChevronsUpDown,
  Check,
  Settings,
  LifeBuoy,
} from "lucide-react";
import { AtlasMark, Wordmark } from "@/components/brand/logo";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MODULE_GROUPS, modulesByGroup, type ModuleDef } from "@/lib/modules";
import { useUIStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

function NavItem({
  module,
  collapsed,
  active,
}: {
  module: ModuleDef;
  collapsed: boolean;
  active: boolean;
}) {
  const Icon = module.icon;
  const link = (
    <AppLink
      href={module.href}
      // The workspace routes are dynamic (several read searchParams), so the
      // default "auto" strategy would only prefetch down to the nearest
      // Suspense boundary. With app/(workspace)/loading.tsx in place that is
      // already useful; asking for the full payload also warms the target's
      // client chunks, which is what makes a sidebar click feel instant.
      // These pages have no server-derived data, so there is nothing to stale.
      prefetch={true}
      data-nav-active={active || undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-surface-2 text-foreground"
          : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-colors",
          active ? "text-action" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      {!collapsed && <span className="truncate">{module.label}</span>}
      {!collapsed && module.status === "soon" && (
        <span className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
          Soon
        </span>
      )}
    </AppLink>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" className="font-medium">
          {module.name}
          <span className="ml-1.5 text-muted-foreground">{module.tagline}</span>
        </TooltipContent>
      </Tooltip>
    );
  }
  return link;
}

/**
 * The active-nav rail: one element that slides between items.
 *
 * This used to be a per-item `<motion.span layoutId="nav-active">`, which is a
 * shared-layout animation — framer-motion's most expensive primitive, measuring
 * both the old and new element every transition. It bought a 3px bar sliding a
 * few dozen pixels, and it was one of only three things keeping all 117 KB of
 * framer-motion in the chunk that every workspace route parses before its own
 * page code runs.
 *
 * The replacement is a single absolutely-positioned bar whose `translateY` is
 * read off the active item and animated by a CSS transition — the same slide,
 * on the compositor, for zero bytes of library.
 *
 * ### Why the markup is shaped the way it is
 *
 * The rail and the nav links are deliberately given the *same* offset parent:
 * the unpadded, unbordered `relative` wrapper in `Sidebar` below. That is what
 * makes `top: 0` and `offsetTop` provably share an origin, so the arithmetic
 * here is exact rather than approximately right. Two earlier versions of this
 * were not, and both produced the same visible bug — the rail pointing at
 * nothing after the sidebar was collapsed:
 *
 *  - Measuring against the padded `<nav>` meant `top: 0` and `offsetTop` were
 *    offset from each other, and the rail sat 56px below its item.
 *  - Correcting from the rail's own rendered rect looked exact but is not: for
 *    300ms after every move that rect is the interpolated position, so a change
 *    arriving mid-slide compounded the error instead of fixing it.
 *
 * `offsetTop` is also the right tool rather than a bounding rect: it is a
 * layout property, unaffected by the transform the rail is carrying and by
 * whatever the scroll position happens to be.
 *
 * `useLayoutEffect` so the measurement lands in the same frame as the paint
 * that follows a navigation; otherwise the bar would visibly jump a frame late.
 * The first pass is applied with the transition suppressed, so the rail appears
 * at the active item rather than sliding up from the top of the list.
 */
function useNavRail(pathname: string, collapsed: boolean) {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const railRef = React.useRef<HTMLSpanElement | null>(null);
  const settled = React.useRef(false);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    const rail = railRef.current;
    if (!list || !rail) return;

    const active = list.querySelector<HTMLElement>("[data-nav-active]");
    if (!active) {
      // /docs and the other footer destinations are not nav modules.
      rail.style.opacity = "0";
      return;
    }

    const y = active.offsetTop + (active.offsetHeight - rail.offsetHeight) / 2;

    if (!settled.current) {
      // First placement on this mount: put it there, don't slide it there.
      rail.style.transition = "none";
      rail.style.transform = `translateY(${y}px)`;
      rail.style.opacity = "1";
      // Force a reflow so the transition-less write is committed before the
      // property is restored; without it the browser coalesces both writes and
      // the very first placement animates after all.
      void rail.offsetHeight;
      rail.style.transition = "";
      settled.current = true;
      return;
    }

    rail.style.transform = `translateY(${y}px)`;
    rail.style.opacity = "1";
  }, [pathname, collapsed]);

  return { listRef, railRef };
}

export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const { listRef, railRef } = useNavRail(pathname, collapsed);

  return (
    <aside
      className={cn(
        // No `backdrop-blur` here, but `bg-surface/60` stays.
        //
        // The sidebar is a flex *sibling* of the scrolling main column, not an
        // overlay — nothing ever passes underneath it, so the filter had
        // nothing to blur but the flat page background and contributed no
        // pixels. What it did contribute was a full-height `backdrop-filter`
        // region that the compositor re-rasterizes whenever anything beneath it
        // is invalidated, which on a workspace route is every scroll and every
        // navigation.
        //
        // The alpha is deliberately untouched: `surface` at 60% over
        // `background` is a different colour from `surface`, and the blur was
        // never what produced it. Same pixels, no filter.
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface/60 transition-[width] duration-300 ease-out lg:flex",
        collapsed ? "w-[68px]" : "w-[252px]",
      )}
    >
      {/* Workspace switcher */}
      <div className="flex h-16 items-center gap-2 border-b border-border px-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-surface-2",
              collapsed && "justify-center px-0",
            )}
          >
            <AtlasMark size={26} />
            {!collapsed && (
              <>
                <span className="flex min-w-0 flex-col leading-tight">
                  <Wordmark className="text-sm" />
                  <span className="truncate text-xs text-muted-foreground">
                    Personal workspace
                  </span>
                </span>
                <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
              </>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            <DropdownMenuItem>
              <AtlasMark size={18} />
              Personal workspace
              <Check className="ml-auto size-4 text-action" />
            </DropdownMenuItem>
            <DropdownMenuItem>
              <span className="grid size-[18px] place-items-center rounded bg-surface-3 text-2xs font-semibold">
                A
              </span>
              Acme Inc · Team
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Settings />
              Workspace settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 no-scrollbar">
        {/* The rail's positioning context, and the links'. No padding and no
            border on this element, on purpose: that is what makes `top: 0` on
            the rail and `offsetTop` on a link the same origin. The `space-y-5`
            lives one level further in, so the rail is not a sibling in that
            chain — as a sibling it silently added a 20px margin to the first
            group and moved the very items it points at. */}
        <div ref={listRef} className="relative">
          <span
            ref={railRef}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-5 w-[3px] rounded-full bg-action opacity-0 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
          />
          <div className="space-y-5">
            {MODULE_GROUPS.map((group) => (
              <div key={group} className="space-y-1">
                {!collapsed && (
                  <p className="px-2.5 pb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground/70">
                    {group}
                  </p>
                )}
                {modulesByGroup(group).map((m) => (
                  <NavItem
                    key={m.id}
                    module={m}
                    collapsed={collapsed}
                    active={pathname === m.href || pathname.startsWith(m.href + "/")}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="space-y-1 border-t border-border p-3">
        <Link
          href="/docs"
          className={cn(
            "flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2/60 hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          <LifeBuoy className="size-[18px]" />
          {!collapsed && "Docs & help"}
        </Link>
        <button
          onClick={toggle}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2/60 hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-[18px]" />
          ) : (
            <>
              <PanelLeftClose className="size-[18px]" />
              Collapse
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
