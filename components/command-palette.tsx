"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ArrowRight,
  Moon,
  Sun,
  GitCompareArrows,
  MessagesSquare,
  Cpu,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { MODULES } from "@/lib/modules";
import { useUIStore } from "@/lib/store/ui-store";

// The palette is mounted in the workspace layout, so its imports are parsed on
// every route — including /docs, /datasets and /notebooks, which have nothing
// to do with models. The module list (from lib/modules.ts) is tiny and stays
// static so ⌘K is never empty; only the catalog-backed model page is split out.
// It is prefetched right after hydration so the chunk is warm before first use.
const ModelsPage = dynamic(
  () => import("./command-palette-models").then((m) => m.ModelsPage),
  { ssr: false },
);
const ActiveModelName = dynamic(
  () => import("./command-palette-models").then((m) => m.ActiveModelName),
  { ssr: false, loading: () => null },
);

export function CommandPalette() {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const open = useUIStore((s) => s.commandOpen);
  const setOpen = useUIStore((s) => s.setCommandOpen);
  const setActiveModel = useUIStore((s) => s.setActiveModel);
  const activeModelId = useUIStore((s) => s.activeModelId);
  const [page, setPage] = React.useState<"root" | "models">("root");

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUIStore.getState().toggleCommand();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (!open) setPage("root");
  }, [open]);

  // Warm the catalog chunk once the page is idle, so the first ⌘K → "Switch
  // active model" is instant rather than waiting on a network round-trip.
  // Shared with the topbar's ModelSwitcher, so this pays for both.
  React.useEffect(() => {
    const warm = () => void import("./command-palette-models");
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (ric) {
      const id = ric(warm);
      return () => (window as unknown as { cancelIdleCallback?: (id: number) => void })
        .cancelIdleCallback?.(id);
    }
    const t = setTimeout(warm, 1200);
    return () => clearTimeout(t);
  }, []);

  const run = React.useCallback(
    (fn: () => void) => {
      setOpen(false);
      // let the dialog close before navigating for a smoother transition
      requestAnimationFrame(fn);
    },
    [setOpen],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        className="max-w-xl gap-0 overflow-hidden p-0 shadow-float"
      >
        <Command loop>
          <CommandInput
            placeholder={
              page === "models"
                ? "Switch active model…"
                : "Search modules, models, actions…"
            }
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            {page === "root" && (
              <>
                <CommandGroup heading="Actions">
                  <CommandItem
                    onSelect={() => run(() => router.push("/compare"))}
                  >
                    <GitCompareArrows />
                    Run a multi-model compare
                    <CommandShortcut>⏎</CommandShortcut>
                  </CommandItem>
                  <CommandItem
                    onSelect={() => run(() => router.push("/chat"))}
                  >
                    <MessagesSquare />
                    New chat
                  </CommandItem>
                  <CommandItem onSelect={() => setPage("models")}>
                    <Cpu />
                    Switch active model
                    <CommandShortcut>
                      <ActiveModelName modelId={activeModelId} />
                    </CommandShortcut>
                  </CommandItem>
                  <CommandItem
                    onSelect={() =>
                      run(() =>
                        setTheme(resolvedTheme === "dark" ? "light" : "dark"),
                      )
                    }
                  >
                    {resolvedTheme === "dark" ? <Sun /> : <Moon />}
                    Toggle theme
                  </CommandItem>
                </CommandGroup>

                <CommandGroup heading="Navigate">
                  {MODULES.map((m) => (
                    <CommandItem
                      key={m.id}
                      value={`${m.name} ${m.label} ${m.tagline}`}
                      onSelect={() => run(() => router.push(m.href))}
                    >
                      <m.icon />
                      <span>{m.name}</span>
                      <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
                        {m.tagline}
                      </span>
                      {m.status === "soon" && (
                        <CommandShortcut>soon</CommandShortcut>
                      )}
                      {m.status === "live" && (
                        <CommandShortcut>
                          <ArrowRight className="size-3.5" />
                        </CommandShortcut>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {page === "models" && (
              <ModelsPage onPick={(id) => run(() => setActiveModel(id))} />
            )}
          </CommandList>

          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-2xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono">
                ↑↓
              </kbd>
              navigate
            </span>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono">
                ⏎
              </kbd>
              select
              <kbd className="ml-2 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono">
                esc
              </kbd>
              close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
