"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  MessagesSquare,
  GitCompareArrows,
  Trophy,
  Calculator,
  Menu,
  Command as CommandIcon,
  X,
} from "lucide-react";
import { BrandLockup } from "@/components/brand/logo";
import { MODULE_GROUPS, modulesByGroup } from "@/lib/modules";
import { useUIStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/leaderboard", label: "Board", icon: Trophy },
  { href: "/cost", label: "Cost", icon: Calculator },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);
  const setCommandOpen = useUIStore((s) => s.setCommandOpen);

  return (
    <>
      {/* Floating ⌘K */}
      <button
        onClick={() => setCommandOpen(true)}
        aria-label="Open command palette"
        className="fixed bottom-20 right-4 z-40 grid size-12 place-items-center rounded-2xl bg-action text-action-foreground shadow-lift lg:hidden"
      >
        <CommandIcon className="size-5" />
      </button>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-background/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] lg:hidden">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              prefetch={true}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-2xs font-medium transition-colors",
                active ? "text-action" : "text-muted-foreground",
              )}
            >
              <t.icon className="size-[20px]" />
              {t.label}
            </Link>
          );
        })}
        <button
          onClick={() => setMobileNavOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-2xs font-medium text-muted-foreground"
        >
          <Menu className="size-[20px]" />
          More
        </button>
      </nav>
    </>
  );
}

export function MobileDrawer() {
  const pathname = usePathname();
  const open = useUIStore((s) => s.mobileNavOpen);
  const setOpen = useUIStore((s) => s.setMobileNavOpen);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-[84%] max-w-xs flex-col border-r border-border bg-surface shadow-float duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
          <div className="flex h-16 items-center justify-between border-b border-border px-4">
            <DialogPrimitive.Title asChild>
              <BrandLockup size={26} />
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground">
              <X className="size-[18px]" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {MODULE_GROUPS.map((group) => (
              <div key={group} className="space-y-1">
                <p className="px-2.5 pb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground/70">
                  {group}
                </p>
                {modulesByGroup(group).map((m) => {
                  const active = pathname === m.href;
                  const Icon = m.icon;
                  return (
                    <Link
                      key={m.id}
                      href={m.href}
                      prefetch={true}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-surface-2 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-[18px]",
                          active ? "text-action" : "",
                        )}
                      />
                      {m.label}
                      {m.status === "soon" && (
                        <span className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-2xs uppercase text-muted-foreground">
                          Soon
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
