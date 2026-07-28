"use client";

import * as React from "react";
import {
  Brain,
  Check,
  Cpu,
  Eye,
  KeyRound,
  Search,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { unavailableReason, type Availability } from "@/lib/catalog/availability";
import { PROVIDERS, type CatalogModel, type ProviderId } from "@/lib/catalog";
import { browseModels, type AccessTab, type BrowseRow } from "@/lib/catalog/search";
import { useCatalogSnapshotLive } from "@/lib/hooks/use-catalog-snapshot";
import { useInfiniteReveal } from "@/lib/hooks/use-infinite-reveal";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { cn, formatContext } from "@/lib/utils";

// Browse the whole catalog.
//
// The topbar popover is a *shortlist* — recent picks plus the strongest free and
// frontier models, capped at 18 rows. That is the right default, but for 339
// models it left no way to reach the other 321, which is what "only a few models
// are visible" meant. This is that way.
//
// Two tabs, because that is the distinction that actually decides whether a click
// works: **Free** is what the operator's keys can serve right now, **Your key** is
// everything else. Both come from `modelAvailability`, the same function the
// server routes on — so a row in the Free tab is a row the server will serve for
// free, not a guess.
//
// Rows are revealed in chunks (`useInfiniteReveal`) rather than virtualized: they
// are fixed-height and simple, and the repo has no windowing library.

const CONTEXT_STEPS: { label: string; value: number }[] = [
  { label: "Any context", value: 0 },
  { label: "32K+", value: 32_768 },
  { label: "128K+", value: 131_072 },
  { label: "1M+", value: 1_000_000 },
];

export interface ModelBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeModelId: string;
  onPick: (id: string) => void;
  /** Pre-select a tab. Defaults to Free — the models that just work. */
  initialTab?: AccessTab;
}

export function ModelBrowser({
  open,
  onOpenChange,
  activeModelId,
  onPick,
  initialTab = "free",
}: ModelBrowserProps) {
  const snapshot = useCatalogSnapshotLive();
  const env = useRouteEnv();

  const [query, setQuery] = React.useState("");
  const [tab, setTab] = React.useState<AccessTab>(initialTab);
  const [provider, setProvider] = React.useState<ProviderId | "all">("all");
  const [tools, setTools] = React.useState(false);
  const [vision, setVision] = React.useState(false);
  const [reasoning, setReasoning] = React.useState(false);
  const [minContext, setMinContext] = React.useState(0);

  // The input stays responsive while the (potentially 300-row) list catches up.
  const deferredQuery = React.useDeferredValue(query);

  const result = React.useMemo(() => {
    if (!env) return { rows: [], counts: { free: 0, your_key: 0, unavailable: 0 } };
    return browseModels(env, {
      query: deferredQuery,
      tab,
      provider,
      tools,
      vision,
      reasoning,
      minContext,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, env, deferredQuery, tab, provider, tools, vision, reasoning, minContext]);

  const filterKey = `${deferredQuery}|${tab}|${provider}|${tools}|${vision}|${reasoning}|${minContext}`;
  const reveal = useInfiniteReveal(result.rows.length, { initial: 40, step: 40, resetKey: filterKey });

  const pick = React.useCallback(
    (id: string) => {
      onPick(id);
      onOpenChange(false);
    },
    [onPick, onOpenChange],
  );

  // Reset transient state each time the dialog opens, so it never reopens showing
  // a stale filter the user has forgotten setting.
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setTab(initialTab);
  }, [open, initialTab]);

  const activeFilters =
    (provider !== "all" ? 1 : 0) +
    (tools ? 1 : 0) +
    (vision ? 1 : 0) +
    (reasoning ? 1 : 0) +
    (minContext > 0 ? 1 : 0);

  const providersWithModels = React.useMemo(() => {
    const seen = new Set<ProviderId>();
    for (const m of snapshot.models) for (const r of m.routes) seen.add(r.provider);
    return [...seen];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] max-h-[85vh] w-[min(56rem,95vw)] max-w-none flex-col gap-0 overflow-hidden p-0"
        hideClose
      >
        <DialogTitle className="sr-only">Browse models</DialogTitle>

        {/* Search */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${snapshot.models.length} models by name, brand, or capability…`}
            className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
          />
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tabs + filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <Tabs value={tab} onValueChange={(v) => setTab(v as AccessTab)}>
            <TabsList>
              <TabsTrigger value="free" className="gap-1.5">
                <Sparkles className="size-3.5" />
                Free
                <span className="text-2xs opacity-70">{result.counts.free}</span>
              </TabsTrigger>
              <TabsTrigger value="your_key" className="gap-1.5">
                <KeyRound className="size-3.5" />
                Your key
                <span className="text-2xs opacity-70">{result.counts.your_key}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <FilterChip active={tools} onClick={() => setTools((v) => !v)} icon={Wrench}>
              Tools
            </FilterChip>
            <FilterChip active={vision} onClick={() => setVision((v) => !v)} icon={Eye}>
              Vision
            </FilterChip>
            <FilterChip
              active={reasoning}
              onClick={() => setReasoning((v) => !v)}
              icon={Brain}
            >
              Reasoning
            </FilterChip>

            <select
              value={minContext}
              onChange={(e) => setMinContext(Number(e.target.value))}
              className="h-7 rounded-full border border-border bg-surface-2 px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:border-border-strong"
            >
              {CONTEXT_STEPS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderId | "all")}
              className="h-7 rounded-full border border-border bg-surface-2 px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:border-border-strong"
            >
              <option value="all">All providers</option>
              {providersWithModels.map((p) => (
                <option key={p} value={p}>
                  {PROVIDERS[p]?.name ?? p}
                </option>
              ))}
            </select>

            {activeFilters > 0 && (
              <button
                onClick={() => {
                  setProvider("all");
                  setTools(false);
                  setVision(false);
                  setReasoning(false);
                  setMinContext(0);
                }}
                className="h-7 rounded-full px-2.5 text-xs text-cyan transition-colors hover:bg-cyan/10"
              >
                Clear {activeFilters}
              </button>
            )}
          </div>
        </div>

        {/* Rows */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!env ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Checking which providers are connected…
            </p>
          ) : result.rows.length === 0 ? (
            <EmptyState tab={tab} query={deferredQuery} />
          ) : (
            <>
              <ul className="divide-y divide-border/60">
                {result.rows.slice(0, reveal.limit).map((row) => (
                  <ModelRow
                    key={row.model.id}
                    row={row}
                    active={row.model.id === activeModelId}
                    onPick={pick}
                  />
                ))}
              </ul>
              <div ref={reveal.sentinelRef} className="h-1" />
              {reveal.hasMore && (
                <div className="px-4 py-4 text-center">
                  <button
                    onClick={reveal.revealMore}
                    className="rounded-xl border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    Show more ({result.rows.length - reveal.limit} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-2xs text-muted-foreground">
          <span>
            {result.rows.length} shown ·{" "}
            {tab === "free"
              ? "every Free model is verified to run on the connected providers"
              : "needs your own OpenRouter key"}
          </span>
          <span className="hidden sm:inline">
            Synced {new Date(snapshot.syncedAt).toLocaleDateString()}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
        active
          ? "border-cyan/40 bg-cyan/10 text-cyan"
          : "border-border bg-surface-2 text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

function EmptyState({ tab, query }: { tab: AccessTab; query: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm text-foreground">
        {query ? `No ${tab === "free" ? "free" : "paid"} model matches “${query}”.` : "Nothing matches these filters."}
      </p>
      <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">
        {tab === "free"
          ? "Free means Atlas has verified the model runs on the operator's keys. Try the Your key tab, or relax a filter."
          : "Try the Free tab, or relax a filter."}
      </p>
    </div>
  );
}

// Memoized with primitive props and a parent-hoisted callback, so typing
// re-renders only the rows whose membership actually changed.
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
  const runnable = availability.kind === "free" || availability.kind === "your_key";
  const reason = unavailableReason(availability);

  return (
    <li>
      <button
        onClick={() => runnable && onPick(model.id)}
        disabled={!runnable}
        title={reason}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
          runnable ? "hover:bg-surface-2/60" : "cursor-not-allowed opacity-50",
          active && "bg-cyan/5",
        )}
      >
        <Cpu className={cn("size-4 shrink-0", active ? "text-cyan" : "text-muted-foreground")} />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{model.name}</span>
            {active && <Check className="size-3.5 shrink-0 text-cyan" />}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span>{model.provider}</span>
            <span aria-hidden>·</span>
            <span>{formatContext(model.contextWindow)} ctx</span>
            {model.capabilities.toolUse && (
              <>
                <span aria-hidden>·</span>
                <Wrench className="size-3" aria-label="Tools" />
              </>
            )}
            {model.modalities.includes("vision") && (
              <>
                <span aria-hidden>·</span>
                <Eye className="size-3" aria-label="Vision" />
              </>
            )}
            {model.capabilities.reasoning && (
              <>
                <span aria-hidden>·</span>
                <Brain className="size-3" aria-label="Reasoning" />
              </>
            )}
          </span>
        </span>

        <AccessBadge availability={availability} />
      </button>
    </li>
  );
});

/** What it costs, and via which provider — the answer the user is really after. */
function AccessBadge({ availability }: { availability: Availability }) {
  if (availability.kind === "free") {
    const via = PROVIDERS[availability.route.provider]?.short ?? availability.route.provider;
    return (
      <Badge variant="success" className="shrink-0">
        Free · {via}
      </Badge>
    );
  }
  if (availability.kind === "your_key") {
    return (
      <Badge variant="violet" className="shrink-0">
        Your key
      </Badge>
    );
  }
  if (availability.kind === "needs_key") {
    return (
      <Badge variant="violet" className="shrink-0">
        Needs key
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="shrink-0">
      Unavailable
    </Badge>
  );
}
