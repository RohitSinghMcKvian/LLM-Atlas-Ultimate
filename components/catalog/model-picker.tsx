"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  Check,
  ChevronDown,
  Coins,
  Cpu,
  KeyRound,
  LayoutGrid,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModelLifecycleBadge } from "@/components/catalog/model-lifecycle-badge";
import { PROVIDERS, getModelById } from "@/lib/catalog";
import { modelAvailability, type Availability } from "@/lib/catalog/availability";
import type { BrowseRow } from "@/lib/catalog/search";
import {
  OPEN_BRAND_COUNT,
  pickerSections,
  type PickerCapabilities,
} from "@/lib/catalog/picker";
import { useCatalogSnapshotLive } from "@/lib/hooks/use-catalog-snapshot";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { useKeysStore } from "@/lib/store/keys-store";
import { useUIStore } from "@/lib/store/ui-store";
import { cn, formatContext } from "@/lib/utils";

// The one model picker.
//
// Six surfaces used to roll their own — two good ones (the topbar switcher and
// Compare's lane picker) and four that mounted an unfiltered list of ~400
// models with nothing but a name on each row. This replaces all of them, so
// "free first, then bring-your-own-key by brand" is true everywhere by
// construction rather than by six people remembering.
//
// `<ModelBrowser />` is loaded on demand: it carries filters, counts and an
// infinite reveal, none of which the common case needs.

const ModelBrowser = dynamic(
  () => import("@/components/catalog/model-browser").then((m) => m.ModelBrowser),
  { ssr: false },
);

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

export interface ModelListProps {
  /** Currently-chosen model(s). Rows in here render a tick. */
  selected: readonly string[];
  onPick: (id: string) => void;
  /** Only offer models with these capabilities. */
  require?: PickerCapabilities;
  /** Hide already-selected rows instead of ticking them (multi-select). */
  hideSelected?: boolean;
  /** Called after a pick, e.g. to close the popover. */
  onAfterPick?: () => void;
  /** Copy for the search field. */
  placeholder?: string;
  className?: string;
}

/**
 * Search, then Free, then BYOK by brand, then an escape hatch to everything.
 *
 * `shouldFilter={false}` on the command: filtering is ours, and cmdk's would
 * re-score every mounted row on each keystroke — the reason the old switcher
 * became unusable once the catalog passed a few hundred models.
 */
export function ModelList({
  selected,
  onPick,
  require,
  hideSelected,
  onAfterPick,
  placeholder,
  className,
}: ModelListProps) {
  const [query, setQuery] = React.useState("");
  const [browsing, setBrowsing] = React.useState(false);
  const [total, setTotal] = React.useState(0);
  // The input stays instant while the (capped) result list catches up.
  const deferredQuery = React.useDeferredValue(query);

  const pick = React.useCallback(
    (id: string) => {
      onPick(id);
      setQuery("");
      onAfterPick?.();
    },
    [onPick, onAfterPick],
  );

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* `shouldFilter={false}`: filtering is ours, and cmdk's would re-score
          every mounted row on each keystroke. */}
      <Command shouldFilter={false} className="min-h-0">
        <CommandInput
          placeholder={placeholder ?? searchPlaceholder(total)}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <ModelSections
            selected={selected}
            onPick={pick}
            query={deferredQuery}
            require={require}
            hideSelected={hideSelected}
            onCounts={setTotal}
          />
        </CommandList>
      </Command>

      <button
        type="button"
        onClick={() => setBrowsing(true)}
        className="flex w-full items-center justify-center gap-2 border-t border-border px-3 py-2.5 text-xs font-medium text-action transition-colors hover:bg-action/5"
      >
        <LayoutGrid className="size-3.5" aria-hidden />
        {total > 0 ? `Browse all ${total} models` : "Browse all models"}
      </button>

      {browsing && (
        <ModelBrowser
          open={browsing}
          onOpenChange={setBrowsing}
          activeModelId={selected[0] ?? ""}
          onPick={pick}
        />
      )}
    </div>
  );
}

export interface ModelSectionsProps {
  selected: readonly string[];
  onPick: (id: string) => void;
  /** The search text, supplied by whoever owns the input. */
  query?: string;
  require?: PickerCapabilities;
  hideSelected?: boolean;
  /** Reports the catalog-wide routable count, for a "browse all N" affordance. */
  onCounts?: (total: number) => void;
}

/**
 * The groups alone — Recent, Free, then BYOK by brand.
 *
 * Split out from {@link ModelList} because the command palette owns its own
 * `<Command>`, its own input and its own footer, and nesting a second one inside
 * it would break arrow-key navigation. Everything either renders is this.
 */
export function ModelSections({
  selected,
  onPick,
  query = "",
  require,
  hideSelected,
  onCounts,
}: ModelSectionsProps) {
  const snapshot = useCatalogSnapshotLive();
  const env = useRouteEnv();
  const recentModelIds = useUIStore((s) => s.recentModelIds);
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const [openBrands, setOpenBrands] = React.useState<Record<string, boolean>>({});

  const sections = React.useMemo(
    () =>
      pickerSections(env, {
        query,
        recentIds: recentModelIds,
        require,
        exclude: hideSelected ? selected : [],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, env, query, recentModelIds, require, hideSelected, selected],
  );

  const total = sections.counts.total;
  React.useEffect(() => {
    onCounts?.(total);
  }, [onCounts, total]);

  const pick = React.useCallback(
    (id: string) => {
      onPick(id);
      // Nudge toward the key modal only when this specific model needs one —
      // never as a blanket upsell.
      const model = getModelById(id);
      if (model && env && modelAvailability(model, env).kind === "needs_key") {
        setKeyModalOpen(true);
      }
    },
    [onPick, env, setKeyModalOpen],
  );

  const chosen = React.useMemo(() => new Set(selected), [selected]);
  const searching = query.trim().length > 0;
  const empty =
    sections.recent.length === 0 && sections.free.length === 0 && sections.byok.length === 0;

  const row = (r: BrowseRow) => (
    <ModelRow key={r.model.id} row={r} active={chosen.has(r.model.id)} onPick={pick} />
  );

  // `env` is null until `/api/v1/providers` answers. Rendering rows now would
  // mean labelling every model "needs a key", so the list waits rather than
  // lying — see `lib/catalog/picker.ts`.
  if (!env) {
    return (
      <div className="px-4 py-6 text-center text-xs text-muted-foreground">
        Checking which providers are connected…
      </div>
    );
  }

  if (empty) return <CommandEmpty>No model matches.</CommandEmpty>;

  return (
    <>
      {sections.recent.length > 0 && (
        <CommandGroup heading="Recent">{sections.recent.map(row)}</CommandGroup>
      )}

      <CommandGroup
        heading={
          <SectionHeading
            label="Free"
            hint="no key needed"
            count={sections.counts.free}
          />
        }
      >
        {sections.free.length > 0 ? (
          sections.free.map(row)
        ) : (
          <CommandItem disabled>
            <Sparkles />
            <span className="text-muted-foreground">
              {searching
                ? "No free model matches."
                : "No provider key is connected — nothing runs free yet."}
            </span>
          </CommandItem>
        )}
      </CommandGroup>

      {sections.byok.length > 0 && (
        <CommandGroup
          heading={
            <SectionHeading
              label="Your key"
              hint="your OpenRouter key"
              count={sections.counts.byok}
            />
          }
        >
          {sections.byok.map((group, i) => {
            // Open the strongest couple of brands so the section reads as
            // populated rather than as a wall of closed rows; a search opens
            // everything, since the user has already narrowed it themselves.
            const open = openBrands[group.brand] ?? (searching || i < OPEN_BRAND_COUNT);
            return (
              <BrandSection
                key={group.brand}
                brand={group.brand}
                count={group.models.length + group.more}
                open={open}
                onToggle={() => setOpenBrands((s) => ({ ...s, [group.brand]: !open }))}
              >
                {group.models.map(row)}
              </BrandSection>
            );
          })}
        </CommandGroup>
      )}
    </>
  );
}

/** "Search 387 models…" once the catalog has loaded, "Search models…" before. */
function searchPlaceholder(total: number): string {
  return total > 0 ? `Search ${total} models…` : "Search models…";
}

function SectionHeading({
  label,
  hint,
  count,
}: {
  label: string;
  hint: string;
  count: number;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="shrink-0">{label}</span>
      <span className="truncate font-normal normal-case text-muted-foreground">· {hint}</span>
      {count > 0 && (
        <span className="ml-auto shrink-0 font-normal tabular-nums opacity-60">{count}</span>
      )}
    </span>
  );
}

function BrandSection({
  brand,
  count,
  open,
  onToggle,
  children,
}: {
  brand: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-2xs font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <ChevronDown
          className={cn("size-3 transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
        {brand}
        <span className="ml-auto tabular-nums opacity-60">{count}</span>
      </button>
      {open && <div className="pl-2">{children}</div>}
    </div>
  );
}

const ModelRow = React.memo(function ModelRow({
  row,
  active,
  onPick,
}: {
  row: BrowseRow;
  active: boolean;
  onPick: (id: string) => void;
}) {
  const { model, availability } = row;
  return (
    <CommandItem value={model.id} onSelect={() => onPick(model.id)}>
      <Cpu className="shrink-0" />
      {/* The name gets every pixel the metadata does not need. A bordered badge
          for the context window cost ~55px per row and pushed half the catalog's
          names into an ellipsis — "Qwen3 …" is not a model anyone can pick. */}
      <span className="min-w-0 flex-1 truncate">{model.name}</span>
      <ModelLifecycleBadge model={model} compact className="shrink-0" />
      <span className="ml-1 flex shrink-0 items-center gap-1.5">
        <span
          className="hidden tabular-nums text-2xs text-muted-foreground sm:inline"
          title={`${model.contextWindow.toLocaleString()} token context window`}
        >
          {formatContext(model.contextWindow)}
        </span>
        <AccessPill availability={availability} />
        {active && <Check className="size-4 text-action" aria-label="selected" />}
      </span>
    </CommandItem>
  );
});

/**
 * What this row costs, said the same way everywhere.
 *
 * Free is `accent`, your key is `action` — the product-wide open/closed
 * convention. `needs_key` and `your_key` are the same tier and differ only in
 * whether the key exists yet, so they differ only by icon.
 */
function AccessPill({ availability }: { availability: Availability }) {
  if (availability.kind === "free") {
    const via = PROVIDERS[availability.route.provider]?.short ?? availability.route.provider;
    return (
      <Badge variant="accent" className="hidden gap-1 sm:inline-flex">
        <Sparkles className="size-3" aria-hidden />
        {via}
      </Badge>
    );
  }
  if (availability.kind === "needs_key") {
    return (
      <Badge variant="primary" className="hidden gap-1 sm:inline-flex" title="Connect your OpenRouter key to run this model.">
        <KeyRound className="size-3" aria-hidden />
        Your key
      </Badge>
    );
  }
  if (availability.kind === "your_key") {
    return (
      <Badge variant="primary" className="hidden gap-1 sm:inline-flex">
        <Coins className="size-3" aria-hidden />
        Your key
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="hidden sm:inline-flex">
      Unavailable
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Single-select                                                       */
/* ------------------------------------------------------------------ */

export interface ModelPickerProps {
  value: string;
  onChange: (id: string) => void;
  require?: PickerCapabilities;
  disabled?: boolean;
  /** Shown when nothing is selected. */
  placeholder?: string;
  className?: string;
  align?: "start" | "center" | "end";
}

/** A trigger button that opens the shared list. */
export function ModelPicker({
  value,
  onChange,
  require,
  disabled,
  placeholder = "Pick a model",
  className,
  align = "start",
}: ModelPickerProps) {
  const snapshot = useCatalogSnapshotLive();
  const [open, setOpen] = React.useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const active = React.useMemo(() => getModelById(value), [value, snapshot]);
  const selected = React.useMemo(() => (value ? [value] : []), [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-sm transition-colors hover:border-border-strong disabled:opacity-50",
            className,
          )}
        >
          <Cpu className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{active?.name ?? placeholder}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <ModelList
          selected={selected}
          onPick={onChange}
          onAfterPick={() => setOpen(false)}
          require={require}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Selected chips                                                      */
/* ------------------------------------------------------------------ */

export interface SelectedModelChipProps {
  modelId: string;
  onRemove?: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * One chosen model, as a removable chip.
 *
 * Coloured by availability rather than by "selected", so a run's chip row shows
 * at a glance which lanes are free and which will be billed — the same
 * accent/action split the picker rows use. Playground, Bench, Cost and Compare
 * each had their own version of this, all of them a flat `primary` badge that
 * said nothing about cost.
 *
 * Renders nothing for an id the catalog no longer has: a sync can retire a model
 * out from under a persisted selection, and the surfaces heal that separately.
 */
export function SelectedModelChip({
  modelId,
  onRemove,
  disabled,
  className,
}: SelectedModelChipProps) {
  const snapshot = useCatalogSnapshotLive();
  const env = useRouteEnv();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = React.useMemo(() => getModelById(modelId), [modelId, snapshot]);
  if (!model) return null;

  const kind = env ? modelAvailability(model, env).kind : undefined;
  const free = kind === "free";

  return (
    <Badge
      variant={free ? "accent" : "primary"}
      className={cn("gap-1", className)}
      title={
        free
          ? `${model.name} runs free on Atlas.`
          : kind === "needs_key"
            ? `${model.name} needs your OpenRouter key.`
            : `${model.name} is billed to your key.`
      }
    >
      {free ? (
        <Sparkles className="size-3 shrink-0" aria-hidden />
      ) : (
        <KeyRound className="size-3 shrink-0" aria-hidden />
      )}
      <span className="truncate">{model.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(modelId)}
          disabled={disabled}
          aria-label={`Remove ${model.name}`}
          className="disabled:opacity-50"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Multi-select                                                        */
/* ------------------------------------------------------------------ */

export interface ModelMultiPickerProps {
  selected: string[];
  onToggle: (id: string) => void;
  require?: PickerCapabilities;
  disabled?: boolean;
  /** Refuse to add past this many. */
  max?: number;
  /** Trigger copy when the picker is available. */
  label?: string;
  /** Trigger copy when `max` is reached. */
  fullLabel?: string;
  className?: string;
}

/**
 * The dashed "+ Add" chip Playground, Bench, Cost and Compare each had their own
 * version of. Selected models are rendered by the caller as removable chips —
 * they belong in the caller's layout, not in a popover.
 */
export function ModelMultiPicker({
  selected,
  onToggle,
  require,
  disabled,
  max,
  label = "Add model",
  fullLabel,
  className,
}: ModelMultiPickerProps) {
  const [open, setOpen] = React.useState(false);
  const full = max !== undefined && selected.length >= max;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || full}
          title={full && max !== undefined ? `At most ${max} models.` : undefined}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-action hover:text-foreground disabled:opacity-50",
            className,
          )}
        >
          <Plus className="size-3" aria-hidden />
          {full ? (fullLabel ?? `${max} is the limit`) : label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <ModelList
          selected={selected}
          onPick={onToggle}
          hideSelected
          require={require}
          placeholder="Add a model…"
        />
      </PopoverContent>
    </Popover>
  );
}
