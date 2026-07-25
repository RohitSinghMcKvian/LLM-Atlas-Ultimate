"use client";

import * as React from "react";
import { Check, Cpu } from "lucide-react";
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
import { formatContext } from "@/lib/utils";

// Everything in the model switcher that needs the catalog lives here, so it can
// be code-split away from the always-mounted topbar. See model-switcher.tsx.

const byProvider = (() => {
  const map = new Map<string, ReturnType<typeof routableModels>[number][]>();
  for (const m of routableModels()) {
    const list = map.get(m.provider);
    if (list) list.push(m);
    else map.set(m.provider, [m]);
  }
  return Array.from(map.entries());
})();

/** The active model's display name — undefined until the catalog chunk loads. */
export function activeModelName(id: string): string | undefined {
  return getModelById(id)?.name;
}

export function ModelSwitcherLabel({ modelId }: { modelId: string }) {
  return <>{activeModelName(modelId) ?? "Select model"}</>;
}

export function ModelSwitcherList({ onPicked }: { onPicked: () => void }) {
  const activeModelId = useUIStore((s) => s.activeModelId);
  const setActiveModel = useUIStore((s) => s.setActiveModel);
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const hasKey = useKeysStore((s) => s.openrouterKey.length > 0);
  const providers = useProviders();

  return (
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
                    onPicked();
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
  );
}
