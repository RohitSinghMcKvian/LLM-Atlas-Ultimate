"use client";

import * as React from "react";
import { Sparkles, CornerDownLeft } from "lucide-react";
import {
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { routableModels, getModelById } from "@/lib/catalog";
import { useUIStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

// The catalog-dependent half of the ⌘K palette. Split out because the palette
// is mounted in the workspace layout on every route, which welded all 97
// models (91 KB) into the shared layout chunk. See command-palette.tsx.

/** Active model name for the root page's shortcut hint. */
export function ActiveModelName({ modelId }: { modelId: string }) {
  return <>{getModelById(modelId)?.name ?? ""}</>;
}

export function ModelsPage({ onPick }: { onPick: (id: string) => void }) {
  const activeModelId = useUIStore((s) => s.activeModelId);
  const models = React.useMemo(() => routableModels(), []);

  return (
    <CommandGroup heading="Models">
      {models.map((m) => (
        <CommandItem
          key={m.id}
          value={`${m.name} ${m.provider}`}
          onSelect={() => onPick(m.id)}
        >
          <Sparkles className={cn(m.id === activeModelId && "text-cyan")} />
          <span>{m.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{m.provider}</span>
          {m.id === activeModelId && (
            <CommandShortcut>
              <CornerDownLeft className="size-3.5" /> active
            </CommandShortcut>
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
