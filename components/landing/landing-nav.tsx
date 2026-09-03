"use client";

import * as React from "react";
import Link from "next/link";
import { AppLink } from "@/components/nav/app-link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Star, Github, Menu, X, ChevronRight, ArrowRight } from "lucide-react";
import { BrandLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/motion/count-up";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { MODULE_GROUPS, modulesByGroup } from "@/lib/modules";
import { cn } from "@/lib/utils";

export function LandingNav() {
  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-border bg-background/70 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="shrink-0">
          <BrandLockup size={28} />
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          <Popover>
            <PopoverTrigger className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground">
              Modules
              <ChevronRight className="size-3.5 rotate-90 opacity-60" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[640px] max-w-[92vw] p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
                {MODULE_GROUPS.map((group) => (
                  <div key={group}>
                    <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {group}
                    </p>
                    <div className="space-y-0.5">
                      {modulesByGroup(group).map((m) => (
                        <AppLink
                          key={m.id}
                          href={m.href}
                          className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface-2"
                        >
                          <m.icon className="size-4 text-muted-foreground group-hover:text-action" />
                          {m.label}
                          {m.status === "soon" && (
                            <span className="ml-auto text-2xs uppercase text-muted-foreground/60">
                              soon
                            </span>
                          )}
                        </AppLink>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Link
            href="/leaderboard"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Leaderboard
          </Link>
          <Link
            href="/docs"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Docs
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm font-medium transition-colors hover:border-border-strong sm:inline-flex"
          >
            {/* No star count. The number here was hardcoded to 2,438 against a
                repository this build has no way to query. */}
            <Github className="size-4" />
            Source
          </a>
          <ThemeToggle />
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="primary" className="hidden sm:inline-flex">
            <Link href="/chat">Open the Workspace</Link>
          </Button>

          {/* Mobile */}
          <button
            onClick={() => setMobileOpen(true)}
            className="grid size-9 place-items-center rounded-lg border border-border bg-surface-2/60 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-[18px]" />
          </button>
        </div>
      </div>

      {/* Mobile sheet */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[86%] max-w-sm flex-col border-l border-border bg-surface p-5 shadow-float data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right md:hidden">
            <div className="flex items-center justify-between">
              <DialogPrimitive.Title asChild>
                <BrandLockup size={26} />
              </DialogPrimitive.Title>
              <DialogPrimitive.Close className="grid size-9 place-items-center rounded-lg border border-border">
                <X className="size-[18px]" />
              </DialogPrimitive.Close>
            </div>
            <div className="mt-6 flex-1 space-y-5 overflow-y-auto">
              {MODULE_GROUPS.map((group) => (
                <div key={group}>
                  <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {modulesByGroup(group).map((m) => (
                      <AppLink
                        key={m.id}
                        href={m.href}
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-surface-2"
                      >
                        <m.icon className="size-4 text-muted-foreground" />
                        {m.label}
                      </AppLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <Button asChild variant="primary" size="lg" className="w-full">
                <Link href="/chat" onClick={() => setMobileOpen(false)}>
                  Open the Workspace <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full">
                <Link href="/login" onClick={() => setMobileOpen(false)}>
                  Sign in
                </Link>
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </header>
  );
}
