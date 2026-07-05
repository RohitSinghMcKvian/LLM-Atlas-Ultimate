"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Cpu } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { routableModels, getModelById, modelAccess } from "@/lib/catalog";
import { useUIStore } from "@/lib/store/ui-store";
import { useKeysStore } from "@/lib/store/keys-store";
import { useProviders } from "@/lib/hooks/use-providers";
import { useMounted } from "@/lib/hooks/use-media-query";
import { cn, formatContext } from "@/lib/utils";

export function ModelSwitcher({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const mounted = useMounted();
  const activeModelId = useUIStore((s) => s.activeModelId);
  const setActiveModel = useUIStore((s) => s.setActiveModel);
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const hasKey = useKeysStore((s) => s.openrouterKey.length > 0);
  const providers = useProviders();
  const active = getModelById(activeModelId);
  const models = routableModels();

  const byProvider = React.useMemo(() => {
    const map = new Map<string, typeof models>();
    for (const m of models) {
      if (!map.has(m.provider)) map.set(m.provider, []);
      map.get(m.provider)!.push(m);
    }
    return Array.from(map.entries());
  }, [models]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-surface-2/60 px-3 text-sm font-medium transition-colors hover:border-border-strong",
            className,
          )}
        >
          <Cpu className="size-4 text-cyan" />
          <span className="max-w-[10rem] truncate">
            {mounted ? (active?.name ?? "Select model") : "Select model"}
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            {byProvider.map(([provider, list]) => (
              <CommandGroup key={provider} heading={provider}>
                {list.map((m) => {
                  const free = modelAccess(m) === "free";
                  return (
                    <CommandItem
                      key={m.id}
                      value={`${m.name} ${m.provider}`}
                      onSelect={() => {
                        setActiveModel(m.id);
                        setOpen(false);
                        // Nudge the user to connect a key for paid models
                        // (unless the operator already serves them).
                        if (!free && !hasKey && !providers.servePaid)
                          setKeyModalOpen(true);
                      }}
                    >
                      <Cpu />
                      <span className="truncate">{m.name}</span>
                      <span className="ml-auto flex items-center gap-2">
                        <Badge
                          variant={free ? "success" : "violet"}
                          className="hidden sm:inline-flex"
                        >
                          {free ? "Free" : "Your key"}
                        </Badge>
                        <Badge variant="default" className="hidden md:inline-flex">
                          {formatContext(m.contextWindow)}
                        </Badge>
                        {m.id === activeModelId && (
                          <Check className="size-4 text-cyan" />
                        )}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
