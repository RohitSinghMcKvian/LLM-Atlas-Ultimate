"use client";

import * as React from "react";
import { ModelList } from "@/components/catalog/model-picker";
import { getModelById } from "@/lib/catalog";
import { useUIStore } from "@/lib/store/ui-store";

// Everything in the topbar model switcher that needs the catalog lives here, so
// it can be code-split away from the always-mounted topbar. See
// model-switcher.tsx.
//
// The list itself is `<ModelList />` — the same component Chat, Compare,
// Playground, Bench, Cost, Flow, Code, Learn and Prompt render. This file used
// to own a tiered shortlist of its own, which was the best of the six pickers
// in the app and therefore the one worth generalising rather than keeping. What
// remains here is only the two things that are genuinely topbar-specific: the
// label, and writing the pick to the global `activeModelId`.

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

  const selected = React.useMemo(
    () => (activeModelId ? [activeModelId] : []),
    [activeModelId],
  );

  return (
    <ModelList selected={selected} onPick={setActiveModel} onAfterPick={onPicked} />
  );
}
