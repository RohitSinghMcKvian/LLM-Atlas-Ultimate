"use client";

import * as React from "react";
import { ModelSections } from "@/components/catalog/model-picker";
import { getModelById } from "@/lib/catalog";
import { useUIStore } from "@/lib/store/ui-store";

// The catalog-dependent half of the ⌘K palette. Split out because the palette is
// mounted in the workspace layout on every route, which would otherwise weld the
// whole model catalog into the shared layout chunk. See command-palette.tsx.
//
// The rows themselves are `<ModelSections />` — the same free-first,
// BYOK-by-brand list the topbar switcher and every feature picker render. The
// palette owns its own `<Command>`, input and footer, which is why this uses the
// groups-only component rather than `<ModelList />`: nesting a second `Command`
// would break the palette's arrow-key navigation.

/** Active model name for the root page's shortcut hint. */
export function ActiveModelName({ modelId }: { modelId: string }) {
  return <>{getModelById(modelId)?.name ?? ""}</>;
}

export function ModelsPage({
  onPick,
  query = "",
}: {
  onPick: (id: string) => void;
  /** The palette's current search text, since it owns the input. */
  query?: string;
}) {
  const activeModelId = useUIStore((s) => s.activeModelId);
  const selected = React.useMemo(
    () => (activeModelId ? [activeModelId] : []),
    [activeModelId],
  );

  return <ModelSections selected={selected} onPick={onPick} query={query} />;
}
