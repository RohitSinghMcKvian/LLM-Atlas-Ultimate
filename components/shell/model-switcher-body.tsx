"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Check, Cpu, LayoutGrid, Sparkles } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { modelAvailability, type Availability } from "@/lib/catalog/availability";
import { PROVIDERS, getModelById, type CatalogModel } from "@/lib/catalog";
import {
  SEARCH_LIMIT,
  modelShortlist,
  modelShortlistFor,
  searchModels,
} from "@/lib/catalog/search";
import { useCatalogSnapshotLive } from "@/lib/hooks/use-catalog-snapshot";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { useUIStore } from "@/lib/store/ui-store";
import { useKeysStore } from "@/lib/store/keys-store";
import { formatContext } from "@/lib/utils";

// Everything in the model switcher that needs the catalog lives here, so it can
// be code-split away from the always-mounted topbar. See model-switcher.tsx.
//
// Search-first, not browse-first. This used to mount every catalog model as a
// cmdk item grouped by brand, and let cmdk re-filter all of them on each
// keystroke. At ~340 models across ~50 brands that is both slow and unusable —
// so an empty query shows a short list (recent picks, best free, best frontier)
// and typing renders only the top matches.
//
// The shortlist is tiered by what the *current* environment can actually run
// (`modelShortlistFor`), not by the catalog-wide `intrinsicAccess` tier. Those
// differ: on a deploy with no Groq key, a Groq-only model is free "in principle"
// and unusable in practice, and putting it under Free is how the picker ends up
// lying. Everything the shortlist omits is one click away in `<ModelBrowser />`.

const ModelBrowser = dynamic(
  () => import("@/components/catalog/model-browser").then((m) => m.ModelBrowser),
  { ssr: false },
);

/** The active model's display name — undefined until the catalog chunk loads. */
export function activeModelName(id: string): string | undefined {
  return getModelById(id)?.name;
}

export function ModelSwitcherLabel({ modelId }: { modelId: string }) {
  return <>{activeModelName(modelId) ?? "Select model"}</>;
}

export function ModelSwitcherList({ onPicked }: { onPicked: () => void }) {
  const snapshot = useCatalogSnapshotLive();
  const env = useRouteEnv();
  const activeModelId = useUIStore((s) => s.activeModelId);
  const setActiveModel = useUIStore((s) => s.setActiveModel);
  const recentModelIds = useUIStore((s) => s.recentModelIds);
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);

  const [query, setQuery] = React.useState("");
  const [browsing, setBrowsing] = React.useState(false);
  // The input stays instant while the (capped) result list catches up.
  const deferredQuery = React.useDeferredValue(query);

  const shortlist = React.useMemo(
    // Before the provider list resolves, fall back to the env-free shortlist so
    // the popover has content immediately rather than flashing empty.
    () => (env ? modelShortlistFor(env, recentModelIds) : modelShortlist(recentModelIds)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, env, recentModelIds],
  );
  const results = React.useMemo(
    () => searchModels(deferredQuery),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, deferredQuery],
  );

  const pick = React.useCallback(
    (id: string) => {
      const model = getModelById(id);
      setActiveModel(id);
      onPicked();
      // Nudge the user to connect a key only when this model genuinely needs one.
      if (model && env && modelAvailability(model, env).kind === "needs_key") {
        setKeyModalOpen(true);
      }
    },
    [setActiveModel, onPicked, env, setKeyModalOpen],
  );

  const searching = deferredQuery.trim().length > 0;

  return (
    <>
      {/* `shouldFilter={false}`: filtering is ours, and cmdk's would re-score every
          mounted item on each keystroke. */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={`Search ${shortlist.total} models…`}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No model found.</CommandEmpty>

          {searching ? (
            <CommandGroup
              heading={
                results.length >= SEARCH_LIMIT
                  ? `Top ${SEARCH_LIMIT} matches — keep typing to narrow`
                  : "Matches"
              }
            >
              {results.map((m) => (
                <ModelOption
                  key={m.id}
                  model={m}
                  env={env}
                  active={m.id === activeModelId}
                  onPick={pick}
                />
              ))}
            </CommandGroup>
          ) : (
            <>
              {shortlist.recent.length > 0 && (
                <CommandGroup heading="Recent">
                  {shortlist.recent.map((m) => (
                    <ModelOption
                      key={m.id}
                      model={m}
                      env={env}
                      active={m.id === activeModelId}
                      onPick={pick}
                    />
                  ))}
                </CommandGroup>
              )}
              <CommandGroup heading="Free · runs on the connected providers">
                {shortlist.free.map((m) => (
                  <ModelOption
                    key={m.id}
                    model={m}
                    env={env}
                    active={m.id === activeModelId}
                    onPick={pick}
                  />
                ))}
              </CommandGroup>
              <CommandGroup heading="Frontier · your key">
                {shortlist.frontier.map((m) => (
                  <ModelOption
                    key={m.id}
                    model={m}
                    env={env}
                    active={m.id === activeModelId}
                    onPick={pick}
                  />
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>

      {/* The escape hatch from the shortlist. */}
      <button
        onClick={() => setBrowsing(true)}
        className="flex w-full items-center justify-center gap-2 border-t border-border px-3 py-2.5 text-xs font-medium text-cyan transition-colors hover:bg-cyan/5"
      >
        <LayoutGrid className="size-3.5" />
        Browse all {shortlist.total} models
      </button>

      {browsing && (
        <ModelBrowser
          open={browsing}
          onOpenChange={setBrowsing}
          activeModelId={activeModelId}
          onPick={pick}
        />
      )}
    </>
  );
}

// Memoized with a parent-hoisted callback, so typing re-renders only the rows
// whose membership actually changed.
const ModelOption = React.memo(function ModelOption({
  model,
  env,
  active,
  onPick,
}: {
  model: CatalogModel;
  env: ReturnType<typeof useRouteEnv>;
  active: boolean;
  onPick: (id: string) => void;
}) {
  const availability = env ? modelAvailability(model, env) : null;
  return (
    <CommandItem value={model.id} onSelect={() => onPick(model.id)}>
      <Cpu />
      <span className="truncate">{model.name}</span>
      <span className="ml-auto flex items-center gap-2">
        <span className="hidden text-2xs text-muted-foreground lg:inline">{model.provider}</span>
        <AccessPill availability={availability} />
        <Badge variant="default" className="hidden md:inline-flex">
          {formatContext(model.contextWindow)}
        </Badge>
        {active && <Check className="size-4 text-cyan" />}
      </span>
    </CommandItem>
  );
});

/**
 * The cost label.
 *
 * While `availability` is null (providers still loading) it renders a neutral
 * placeholder rather than guessing — a Free badge that later turns out to be
 * wrong is worse than a moment of "…".
 */
function AccessPill({ availability }: { availability: Availability | null }) {
  if (!availability) {
    return (
      <Badge variant="default" className="hidden sm:inline-flex opacity-50">
        …
      </Badge>
    );
  }
  if (availability.kind === "free") {
    const via = PROVIDERS[availability.route.provider]?.short ?? availability.route.provider;
    return (
      <Badge variant="success" className="hidden sm:inline-flex gap-1">
        <Sparkles className="size-3" />
        {via}
      </Badge>
    );
  }
  if (availability.kind === "unavailable") {
    return (
      <Badge variant="default" className="hidden sm:inline-flex">
        Unavailable
      </Badge>
    );
  }
  return (
    <Badge variant="violet" className="hidden sm:inline-flex">
      Your key
    </Badge>
  );
}
