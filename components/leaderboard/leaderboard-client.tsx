"use client";

import * as React from "react";
import { useCatalogSnapshot } from "@/lib/hooks/use-catalog-snapshot";
import { useInfiniteReveal } from "@/lib/hooks/use-infinite-reveal";
import { useSurfaceContext } from "@/lib/agent/surface-context";
import { leaderboardSurface } from "@/lib/agent/surface-summaries";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  SlidersHorizontal,
  X,
  GitCompareArrows,
  Search,
  Brain,
  Wrench,
  Eye,
  Image as ImageIcon,
  Zap,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge, StatusPill } from "@/components/ui/badge";
import { ModelLifecycleBadge } from "@/components/catalog/model-lifecycle-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import dynamic from "next/dynamic";

// Only rendered when a row expands — keeps recharts out of First Load JS.
const ModelDetail = dynamic(
  () => import("@/components/leaderboard/model-detail").then((m) => m.ModelDetail),
  {
    ssr: false,
    loading: () => (
      <div className="px-5 py-8 text-center text-xs text-muted-foreground">Loading charts…</div>
    ),
  },
);
import {
  allModels,
  brandProviders,
  intelligenceIndex,
  getBenchmark,
  getModelById,
  modelAccess,
  producesImages,
} from "@/lib/catalog";
import type { CatalogModel } from "@/lib/catalog/types";
import { cn, formatContext, formatUSD } from "@/lib/utils";

type SortKey = "intelligence" | "arena" | "price" | "context" | "release" | "name";

interface FilterState {
  search: string;
  access: "all" | "free" | "byok";
  license: "all" | "open" | "proprietary";
  providers: Set<string>;
  reasoning: boolean;
  tools: boolean;
  vision: boolean;
  /** Model can *produce* an image, not merely read one (§P13). */
  imageOutput: boolean;
  caching: boolean;
  minContext: number;
  maxPrice: number;
  showUpcoming: boolean;
  /** Models the providers have stopped serving, on their way out of the catalog. */
  showRetired: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  search: "",
  access: "all",
  license: "all",
  providers: new Set(),
  reasoning: false,
  tools: false,
  vision: false,
  imageOutput: false,
  caching: false,
  minContext: 0,
  maxPrice: 60,
  showUpcoming: true,
  // Off: "expired at the provider" should mean gone from Atlas. The toggle
  // exists because the leaderboard is also a record — you may want to see what
  // was retired this week — but it is not the default view of a catalogue.
  showRetired: false,
};

const SORTS: { key: SortKey; label: string }[] = [
  { key: "intelligence", label: "Intelligence" },
  { key: "arena", label: "Arena Elo" },
  { key: "price", label: "Price: low → high" },
  { key: "context", label: "Context window" },
  { key: "release", label: "Newest" },
  { key: "name", label: "Name A–Z" },
];

function blended(m: CatalogModel) {
  return (m.pricing.inputPerM * 3 + m.pricing.outputPerM) / 4;
}

function matches(m: CatalogModel, f: FilterState): boolean {
  if (!f.showUpcoming && m.status === "upcoming") return false;
  if (!f.showRetired && m.status === "deprecated") return false;
  if (f.access !== "all" && modelAccess(m) !== f.access) return false;
  if (f.license !== "all" && m.license !== f.license) return false;
  if (f.providers.size > 0 && !f.providers.has(m.provider)) return false;
  if (f.reasoning && !m.capabilities.reasoning) return false;
  if (f.tools && !m.capabilities.toolUse) return false;
  if (f.vision && !m.modalities.includes("vision")) return false;
  if (f.imageOutput && !producesImages(m)) return false;
  if (f.caching && !m.capabilities.caching) return false;
  if (m.contextWindow < f.minContext) return false;
  if (m.status !== "upcoming" && f.maxPrice < 60 && blended(m) > f.maxPrice)
    return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    if (
      !m.name.toLowerCase().includes(q) &&
      !m.provider.toLowerCase().includes(q) &&
      !(m.tags ?? []).some((t) => t.includes(q))
    )
      return false;
  }
  return true;
}

function sortModels(list: CatalogModel[], key: SortKey): CatalogModel[] {
  const arr = [...list];
  switch (key) {
    case "intelligence":
      return arr.sort((a, b) => intelligenceIndex(b) - intelligenceIndex(a));
    case "arena":
      return arr.sort(
        (a, b) => (getBenchmark(b, "arena") ?? 0) - (getBenchmark(a, "arena") ?? 0),
      );
    case "price":
      return arr.sort((a, b) => {
        if (a.status === "upcoming") return 1;
        if (b.status === "upcoming") return -1;
        return blended(a) - blended(b);
      });
    case "context":
      return arr.sort((a, b) => b.contextWindow - a.contextWindow);
    case "release":
      return arr.sort(
        (a, b) => +new Date(b.releaseDate) - +new Date(a.releaseDate),
      );
    case "name":
      return arr.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function LeaderboardClient({
  initialAccess,
}: {
  initialAccess?: "free" | "byok";
}) {
  const router = useRouter();
  const [filters, setFilters] = React.useState<FilterState>(() =>
    initialAccess ? { ...DEFAULT_FILTERS, access: initialAccess } : DEFAULT_FILTERS,
  );
  const [sort, setSort] = React.useState<SortKey>("intelligence");
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [compare, setCompare] = React.useState<Set<string>>(new Set());

  const set = (patch: Partial<FilterState>) =>
    setFilters((f) => ({ ...f, ...patch }));

  // The input stays bound to `filters.search` so typing is never held up, but
  // the 97-row filter/sort/render pass runs against a deferred copy. React
  // keeps the keystroke responsive and catches the list up when it can — the
  // final output is identical, only the intermediate frames differ.
  const deferredSearch = React.useDeferredValue(filters.search);
  // Subscribing keeps every derived list correct across a catalog sync: a new
  // snapshot is a new object identity, so these memos recompute.
  const snapshot = useCatalogSnapshot();
  const deferredFilters = React.useMemo(
    () => ({ ...filters, search: deferredSearch }),
    [filters, deferredSearch],
  );

  const results = React.useMemo(() => {
    const filtered = allModels().filter((m) => matches(m, deferredFilters));
    return sortModels(filtered, sort);
  }, [snapshot, deferredFilters, sort]);

  // The catalog is ~400 models. Render the first chunk and reveal more as the
  // user scrolls, so a filter change commits ~50 rows instead of all of them.
  const { limit, sentinelRef, hasMore, revealMore } = useInfiniteReveal(results.length, {
    resetKey: `${JSON.stringify(deferredFilters)}|${sort}`,
  });
  const visible = React.useMemo(() => results.slice(0, limit), [results, limit]);

  // What the agent is told when someone asks "is this one worth it" from here.
  // Without it the answer is built against "they are on the Leaderboard" and a
  // request for clarification, which is what makes most in-app assistants
  // annoying to talk to.
  const compareIds = React.useMemo(() => [...compare], [compare]);
  useSurfaceContext(
    leaderboardSurface({
      matched: results.length,
      total: allModels().length,
      sort,
      access: filters.access,
      license: filters.license,
      search: filters.search,
      expandedId: expanded,
      compareIds,
    }),
  );

  // Stable identities so the memoized rows aren't invalidated on every
  // keystroke in the search box.
  const toggleCompare = React.useCallback((id: string) => {
    setCompare((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleExpanded = React.useCallback((id: string) => {
    setExpanded((e) => (e === id ? null : id));
  }, []);

  const activeFilterCount =
    (filters.access !== "all" ? 1 : 0) +
    (filters.license !== "all" ? 1 : 0) +
    filters.providers.size +
    [
      filters.reasoning,
      filters.tools,
      filters.vision,
      filters.imageOutput,
      filters.caching,
    ].filter(Boolean).length +
    (filters.minContext > 0 ? 1 : 0) +
    (filters.maxPrice < 60 ? 1 : 0);

  const filterPanel = (
    <FilterControls
      filters={filters}
      set={set}
      reset={() => setFilters(DEFAULT_FILTERS)}
      activeCount={activeFilterCount}
    />
  );

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Leaderboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The complete model catalog — capabilities, benchmarks, and pricing.
            Every number is attributed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(e) => set({ search: e.target.value })}
              placeholder="Search models…"
              className="w-full pl-9 sm:w-56"
            />
          </div>
          {/* Mobile filters */}
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" className="lg:hidden">
                <SlidersHorizontal className="size-4" />
                {activeFilterCount > 0 && (
                  <span className="ml-0.5 rounded bg-action/20 px-1.5 text-xs text-action">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Filters</DialogTitle>
              </DialogHeader>
              {filterPanel}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* Filter rail (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 rounded-2xl border border-border bg-surface/50 p-4">
            {filterPanel}
          </div>
        </aside>

        {/* Table */}
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">
                {results.length}
              </span>{" "}
              models
            </p>
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Sort by
              </span>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger className="h-9 w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Column header */}
          <div className="hidden gap-3 border-b border-border px-3 pb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground md:grid md:grid-cols-[1.6rem_minmax(0,1fr)_8rem_5rem_7.5rem_4.5rem_1.6rem] md:items-center">
            <span>#</span>
            <span>Model</span>
            <span>Intelligence</span>
            <span className="text-right">Context</span>
            <span className="text-right">$/Mtok in·out</span>
            <span className="text-right">Elo</span>
            <span />
          </div>

          {/* No `layout` / <LayoutGroup> here. Every row was a layout element, so
              each commit forced a layout measurement per row — 400 of them per
              keystroke. The only thing it animated was reflow when a row expands,
              which the detail panel's own AnimatePresence height animation
              already covers. Opacity alone is composited and effectively free. */}
          <div className="divide-y divide-border/70">
            <AnimatePresence initial={false}>
              {visible.map((m, i) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  rank={i + 1}
                  expanded={expanded === m.id}
                  onToggle={toggleExpanded}
                  inCompare={compare.has(m.id)}
                  onCompare={toggleCompare}
                />
              ))}
            </AnimatePresence>
          </div>

          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-6">
              <Button variant="secondary" size="sm" onClick={revealMore}>
                Show more ({results.length - visible.length} remaining)
              </Button>
            </div>
          )}

          {results.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No models match these filters.
              <Button
                variant="link"
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="ml-1"
              >
                Reset
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Compare tray */}
      <AnimatePresence>
        {compare.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 lg:pb-6"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-border bg-popover/95 p-3 pl-4 shadow-float backdrop-blur-xl">
              <span className="text-sm font-medium">
                {compare.size} selected
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {[...compare].map((id) => {
                  const m = getModelById(id);
                  if (!m) return null;
                  return (
                    <Badge key={id} variant="primary" className="gap-1">
                      {m.name}
                      <button onClick={() => toggleCompare(id)}>
                        <X className="size-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCompare(new Set())}>
                Clear
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  router.push(`/compare?models=${[...compare].join(",")}`)
                }
              >
                <GitCompareArrows className="size-4" /> Compare
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Memoized: the catalog is ~400 models, and even chunked the list renders
// dozens of animated rows. All props are primitives or stable identities — keep
// them that way, or this memo silently stops working.
const ModelRow = React.memo(function ModelRow({
  model,
  rank,
  expanded,
  onToggle,
  inCompare,
  onCompare,
}: {
  model: CatalogModel;
  rank: number;
  expanded: boolean;
  onToggle: (id: string) => void;
  inCompare: boolean;
  onCompare: (id: string) => void;
}) {
  const intel = intelligenceIndex(model);
  const elo = getBenchmark(model, "arena");
  return (
    <motion.div
      // No `layout`: opacity is composited, whereas a layout animation forces a
      // measurement of every mounted row on each commit.
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "overflow-hidden",
        expanded && "rounded-2xl border border-border bg-surface/40 my-2",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggle(model.id)}
        onKeyDown={(e) => e.key === "Enter" && onToggle(model.id)}
        className={cn(
          "group grid cursor-pointer grid-cols-[1.6rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2/40 md:grid-cols-[1.6rem_minmax(0,1fr)_8rem_5rem_7.5rem_4.5rem_1.6rem]",
        )}
      >
        <span className="font-mono text-sm text-muted-foreground">{rank}</span>

        {/* identity */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCompare(model.id);
            }}
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
              inCompare
                ? "border-transparent bg-action text-action-foreground"
                : "border-border-strong text-transparent hover:border-action",
            )}
            aria-label="Add to compare"
          >
            <GitCompareArrows className="size-3" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{model.name}</span>
              {model.trending && (
                <Badge variant="primary" className="hidden shrink-0 lg:inline-flex">
                  Trending
                </Badge>
              )}
              <ModelLifecycleBadge model={model} className="hidden shrink-0 sm:inline-flex" />
              {/* `accent` for free, `action` for BYOK — the product-wide open /
                  bring-your-own-key convention the pickers, the cost frontier
                  and the landing plot all use. This row said `success` for free
                  and `accent` for paid, which inverted it. */}
              <Badge
                variant={modelAccess(model) === "free" ? "accent" : "primary"}
                className="hidden shrink-0 sm:inline-flex"
              >
                {modelAccess(model) === "free" ? "Free" : "Your key"}
              </Badge>
              <Badge
                variant={model.license === "open" ? "outline" : "default"}
                className="hidden shrink-0 lg:inline-flex"
              >
                {model.license === "open" ? "open" : "closed"}
              </Badge>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {model.provider}
            </div>
          </div>
        </div>

        {/* intelligence */}
        <div className="hidden items-center gap-2 md:flex">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-action"
              style={{ width: `${Math.min(100, intel)}%` }}
            />
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {intel || "—"}
          </span>
        </div>

        {/* context */}
        <span className="hidden text-right font-mono text-sm md:block">
          {formatContext(model.contextWindow)}
        </span>

        {/* price */}
        <span className="hidden text-right font-mono text-sm md:block">
          {model.status === "upcoming"
            ? "—"
            : `${formatUSD(model.pricing.inputPerM, { precise: true })}·${formatUSD(model.pricing.outputPerM, { precise: true })}`}
        </span>

        {/* elo */}
        <span className="hidden text-right font-mono text-sm md:block">
          {elo ?? "—"}
        </span>

        {/* status + chevron */}
        <div className="flex items-center justify-end gap-2 md:contents">
          <StatusPill status={model.status} className="md:hidden" />
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform md:justify-self-end",
              expanded && "rotate-180",
            )}
          />
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="border-t border-border">
              <div className="flex items-center justify-between px-5 pt-4">
                <StatusPill status={model.status} />
                <span className="text-2xs text-muted-foreground">
                  Released {model.releaseDate}
                </span>
              </div>
              <ModelDetail model={model} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

function FilterControls({
  filters,
  set,
  reset,
  activeCount,
}: {
  filters: FilterState;
  set: (p: Partial<FilterState>) => void;
  reset: () => void;
  activeCount: number;
}) {
  const providers = brandProviders();
  const toggleProvider = (p: string) => {
    const next = new Set(filters.providers);
    next.has(p) ? next.delete(p) : next.add(p);
    set({ providers: next });
  };

  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">Filters</span>
        {activeCount > 0 && (
          <button
            onClick={reset}
            className="text-xs text-action hover:underline"
          >
            Reset ({activeCount})
          </button>
        )}
      </div>

      {/* Access */}
      <div className="space-y-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Access
        </p>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface-2/50 p-1">
          {(
            [
              ["all", "All"],
              ["free", "Free"],
              ["byok", "Your key"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              onClick={() => set({ access: val })}
              className={cn(
                "rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
                filters.access === val
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* License */}
      <div className="space-y-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          License
        </p>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface-2/50 p-1">
          {(["all", "open", "proprietary"] as const).map((l) => (
            <button
              key={l}
              onClick={() => set({ license: l })}
              className={cn(
                "rounded-lg px-2 py-1.5 text-xs font-medium capitalize transition-colors",
                filters.license === l
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l === "proprietary" ? "Closed" : l}
            </button>
          ))}
        </div>
      </div>

      {/* Capabilities */}
      <div className="space-y-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Capabilities
        </p>
        {[
          { k: "reasoning", label: "Reasoning", icon: Brain },
          { k: "tools", label: "Tool use", icon: Wrench },
          { k: "vision", label: "Vision", icon: Eye },
          { k: "imageOutput", label: "Image output", icon: ImageIcon },
          { k: "caching", label: "Caching", icon: Zap },
        ].map((c) => (
          <label
            key={c.k}
            className="flex cursor-pointer items-center gap-2.5 py-0.5"
          >
            <Checkbox
              checked={filters[c.k as keyof FilterState] as boolean}
              onCheckedChange={(v) => set({ [c.k]: !!v } as Partial<FilterState>)}
            />
            <c.icon className="size-3.5 text-muted-foreground" />
            <span>{c.label}</span>
          </label>
        ))}
      </div>

      {/* Min context */}
      <div className="space-y-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Min context
        </p>
        <Select
          value={String(filters.minContext)}
          onValueChange={(v) => set({ minContext: Number(v) })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any</SelectItem>
            <SelectItem value="32768">≥ 32K</SelectItem>
            <SelectItem value="128000">≥ 128K</SelectItem>
            <SelectItem value="200000">≥ 200K</SelectItem>
            <SelectItem value="1000000">≥ 1M</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Max price */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            Max blended $/Mtok
          </p>
          <span className="font-mono text-xs">
            {filters.maxPrice >= 60 ? "Any" : `$${filters.maxPrice}`}
          </span>
        </div>
        <Slider
          value={[filters.maxPrice]}
          min={0.5}
          max={60}
          step={0.5}
          onValueChange={([v]) => set({ maxPrice: v })}
        />
      </div>

      {/* Providers */}
      <div className="space-y-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Provider
        </p>
        <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
          {providers.map((p) => (
            <label
              key={p}
              className="flex cursor-pointer items-center gap-2.5 py-0.5"
            >
              <Checkbox
                checked={filters.providers.has(p)}
                onCheckedChange={() => toggleProvider(p)}
              />
              <span>{p}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Lifecycle */}
      <div className="space-y-3 border-t border-border pt-4">
        <label className="flex items-center justify-between gap-2">
          <span>Show upcoming</span>
          <Switch
            checked={filters.showUpcoming}
            onCheckedChange={(v) => set({ showUpcoming: v })}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span title="Models a provider has stopped serving. They leave the catalog entirely after the next sync confirms it.">
            Show retired
          </span>
          <Switch
            checked={filters.showRetired}
            onCheckedChange={(v) => set({ showRetired: v })}
          />
        </label>
      </div>
    </div>
  );
}
