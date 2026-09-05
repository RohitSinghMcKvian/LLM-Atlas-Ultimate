"use client";

import { ModelMultiPicker } from "@/components/catalog/model-picker";
import { MAX_LANES } from "@/lib/compare/types";

/**
 * Add a model to the run.
 *
 * This used to own its own free / your-key grouping, which was the right idea
 * and is now `<ModelMultiPicker />` — the same list Chat, Playground, Bench,
 * Cost, Flow and Code render. All that is Compare-specific is the lane ceiling,
 * and saying so in the trigger when you hit it.
 *
 * The `env` prop is gone: the picker reads `useRouteEnv()` itself, which is what
 * every other caller does and one fewer thing for a caller to thread through
 * wrongly.
 */
export function LanePicker({
  selected,
  onToggle,
  disabled,
}: {
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <ModelMultiPicker
      selected={selected}
      onToggle={onToggle}
      disabled={disabled}
      max={MAX_LANES}
      fullLabel={`${MAX_LANES} is the limit`}
    />
  );
}
