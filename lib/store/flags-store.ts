"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FLAG_DEFS, type FlagId } from "@/lib/flags";

interface FlagsState {
  overrides: Partial<Record<FlagId, boolean>>;
  setFlag: (id: FlagId, on: boolean) => void;
  resetFlag: (id: FlagId) => void;
}

export const useFlagsStore = create<FlagsState>()(
  persist(
    (set) => ({
      overrides: {},
      setFlag: (id, on) => set((s) => ({ overrides: { ...s.overrides, [id]: on } })),
      resetFlag: (id) =>
        set((s) => {
          const { [id]: _drop, ...rest } = s.overrides;
          return { overrides: rest };
        }),
    }),
    { name: "atlas-flags" },
  ),
);

/** Non-React check for engine/store callers. */
export function isEnabled(id: FlagId): boolean {
  return useFlagsStore.getState().overrides[id] ?? FLAG_DEFS[id].defaultOn;
}

/** Reactive check for components. */
export function useFlag(id: FlagId): boolean {
  return useFlagsStore((s) => s.overrides[id] ?? FLAG_DEFS[id].defaultOn);
}
