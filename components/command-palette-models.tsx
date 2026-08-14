"use client";

import * as React from "react";
import { Sparkles, CornerDownLeft } from "lucide-react";
import {
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { modelAvailability } from "@/lib/catalog/availability";
import { getModelById, type CatalogModel } from "@/lib/catalog";
import {
  SEARCH_LIMIT,
  modelShortlist,
  modelShortlistFor,
  searchModels,
} from "@/lib/catalog/search";
import { useCatalogSnapshotLive } from "@/lib/hooks/use-catalog-snapshot";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { useUIStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

// The catalog-dependent half of the ⌘K palette. Split out because the palette
// is mounted in the workspace layout on every route, which welded the whole
// model catalog into the shared layout chunk. See command-palette.tsx.
//
// Search-first for the same reason as the topbar switcher: mounting ~400 items
// and re-filtering them on each keystroke is both slow and a poor way to choose
// a model. An empty query shows recents plus the strongest free and frontier
// models; typing shows the top matches.

/** Active model name for the root page's shortcut hint. */
export function ActiveModelName({ modelId }: { modelId: string }) {
  return <>{getModelById(modelId)?.name ?? ""}</>;
}

export function ModelsPage({
  onPick,
  query = "",
}: {
  onPick: (id: string) => void;
  /** The palette's current search text, when it filters externally. */
  query?: string;
}) {
  const snapshot = useCatalogSnapshotLive();
  const env = useRouteEnv();
  const activeModelId = useUIStore((s) => s.activeModelId);
  const recentModelIds = useUIStore((s) => s.recentModelIds);

  const deferredQuery = React.useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;

  const shortlist = React.useMemo(
    // Tiered by what the connected providers can actually serve; falls back to the
    // env-free tier until `/api/v1/providers` resolves.
    () => (env ? modelShortlistFor(env, recentModelIds) : modelShortlist(recentModelIds)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, env, recentModelIds],
  );
  const results = React.useMemo(
    () => searchModels(deferredQuery),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, deferredQuery],
  );

  if (searching) {
    return (
      <CommandGroup
        heading={
          results.length >= SEARCH_LIMIT
            ? `Models · top ${SEARCH_LIMIT} of ${shortlist.total}`
            : "Models"
        }
      >
        {results.map((m) => (
          <ModelItem key={m.id} model={m} active={m.id === activeModelId} onPick={onPick} />
        ))}
      </CommandGroup>
    );
  }

  return (
    <>
      {shortlist.recent.length > 0 && (
        <CommandGroup heading="Recent models">
          {shortlist.recent.map((m) => (
            <ModelItem key={m.id} model={m} active={m.id === activeModelId} onPick={onPick} />
          ))}
        </CommandGroup>
      )}
      <CommandGroup heading={`Free · type to search all ${shortlist.total}`}>
        {shortlist.free.map((m) => (
          <ModelItem key={m.id} model={m} active={m.id === activeModelId} onPick={onPick} />
        ))}
        {env && shortlist.free.length === 0 && (
          <CommandItem disabled>
            <Sparkles />
            <span className="text-muted-foreground">
              No provider key is connected — nothing runs for free yet.
            </span>
          </CommandItem>
        )}
      </CommandGroup>
      <CommandGroup heading="Frontier · your key">
        {shortlist.frontier.map((m) => (
          <ModelItem key={m.id} model={m} active={m.id === activeModelId} onPick={onPick} />
        ))}
      </CommandGroup>
    </>
  );
}

const ModelItem = React.memo(function ModelItem({
  model,
  active,
  onPick,
}: {
  model: CatalogModel;
  active: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <CommandItem value={model.id} onSelect={() => onPick(model.id)}>
      <Sparkles className={cn(active && "text-action")} />
      <span>{model.name}</span>
      <span className="ml-2 text-xs text-muted-foreground">{model.provider}</span>
      {active && (
        <CommandShortcut>
          <CornerDownLeft className="size-3.5" /> active
        </CommandShortcut>
      )}
    </CommandItem>
  );
});
