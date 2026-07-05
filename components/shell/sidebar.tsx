"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
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
    <Link
      href={module.href}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-surface-2 text-foreground"
          : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gradient-primary"
          transition={{ type: "spring", stiffness: 500, damping: 36 }}
        />
      )}
      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-colors",
          active ? "text-cyan" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      {!collapsed && <span className="truncate">{module.label}</span>}
      {!collapsed && module.status === "soon" && (
        <span className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          Soon
        </span>
      )}
    </Link>
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

export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface/40 backdrop-blur-xl transition-[width] duration-300 ease-out lg:flex",
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
              <Check className="ml-auto size-4 text-cyan" />
            </DropdownMenuItem>
            <DropdownMenuItem>
              <span className="grid size-[18px] place-items-center rounded bg-surface-3 text-[10px] font-semibold">
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
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4 no-scrollbar">
        {MODULE_GROUPS.map((group) => (
          <div key={group} className="space-y-1">
            {!collapsed && (
              <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
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
