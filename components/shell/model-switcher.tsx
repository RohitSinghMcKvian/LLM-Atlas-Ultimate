"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ChevronsUpDown, Cpu } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useUIStore } from "@/lib/store/ui-store";
import { useMounted } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

// This component is mounted in the Topbar on every workspace route, so anything
// it imports lands in the chunk that /docs, /datasets and /notebooks parse too.
// Importing the catalog directly put all 97 models (91 KB) there. The trigger
// button below needs none of that, so the catalog-dependent halves are split
// into model-switcher-body.tsx and pulled in after hydration.
//
// The label was already hydration-gated — it rendered the literal "Select
// model" until `mounted` flipped — so deferring it changes nothing a user can
// observe beyond a few milliseconds.

const ModelSwitcherLabel = dynamic(
  () => import("./model-switcher-body").then((m) => m.ModelSwitcherLabel),
  { ssr: false, loading: () => <>Select model</> },
);

const ModelSwitcherList = dynamic(
  () => import("./model-switcher-body").then((m) => m.ModelSwitcherList),
  { ssr: false },
);

export function ModelSwitcher({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const mounted = useMounted();
  const activeModelId = useUIStore((s) => s.activeModelId);
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-surface-2/60 px-3 text-sm font-medium transition-colors hover:border-border-strong",
            className,
          )}
        >
          <Cpu className="size-4 text-action" />
          <span className="max-w-[10rem] truncate">
            {mounted ? <ModelSwitcherLabel modelId={activeModelId} /> : "Select model"}
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <ModelSwitcherList onPicked={close} />
      </PopoverContent>
    </Popover>
  );
}
