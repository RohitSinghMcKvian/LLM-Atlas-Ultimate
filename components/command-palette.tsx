"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ArrowRight,
  Moon,
  Sun,
  Sparkles,
  GitCompareArrows,
  MessagesSquare,
  Cpu,
  CornerDownLeft,
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
import { routableModels, getModelById } from "@/lib/catalog";
import { useUIStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

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

  const run = React.useCallback(
    (fn: () => void) => {
      setOpen(false);
      // let the dialog close before navigating for a smoother transition
      requestAnimationFrame(fn);
    },
    [setOpen],
  );

  const models = routableModels();

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
                      {getModelById(activeModelId)?.name ?? ""}
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
              <CommandGroup heading="Models">
                {models.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.name} ${m.provider}`}
                    onSelect={() =>
                      run(() => {
                        setActiveModel(m.id);
                      })
                    }
                  >
                    <Sparkles
                      className={cn(m.id === activeModelId && "text-cyan")}
                    />
                    <span>{m.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {m.provider}
                    </span>
                    {m.id === activeModelId && (
                      <CommandShortcut>
                        <CornerDownLeft className="size-3.5" /> active
                      </CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
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
