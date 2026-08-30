"use client";

import * as React from "react";
import { defaultCostModels } from "@/lib/catalog/defaults";
import { resolveModelId } from "@/lib/catalog/resolve";
import { useCatalogSnapshot } from "@/lib/hooks/use-catalog-snapshot";
import dynamic from "next/dynamic";
import {
  Coins,
  Cpu,
  Download,
  Plus,
  Server,
  TrendingDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Reveal } from "@/components/motion/reveal";
import {
  allModels,
  getModelById,
  BENCHMARKS,
  getBenchmark,
  type CatalogModel,
} from "@/lib/catalog";
import {
  apiMonthlyCost,
  selfHostEstimate,
  breakEvenRequestsPerDay,
  DEFAULT_WORKLOAD,
  DEFAULT_SELFHOST,
  type Workload,
  type SelfHostAssumptions,
} from "@/lib/cost/engine";
import { ACCENT_TEXT } from "@/lib/accent";
import { cn, formatUSD, formatCompact } from "@/lib/utils";

// recharts is the heaviest dependency on this route and is only needed for the
// frontier plot, so it gets its own chunk. The wrapper below reserves the
// height so nothing shifts when it arrives.
//
// Note: deliberately NOT `ssr: false`. This chart is rendered during the
// page's server render, and an ssr:false dynamic in that position makes Next
// bail the whole route to client-side rendering — which parks the page on the
// loading skeleton indefinitely. `ssr: false` is only safe for dynamics that
// are absent from the initial render, like the leaderboard's expand-on-click
// detail panel.
const FrontierChart = dynamic(
  () => import("@/components/cost/frontier-chart").then((m) => m.FrontierChart),
  { loading: () => null },
);

export function CostClient({ initialModelId }: { initialModelId?: string }) {
  const [workload, setWorkload] = React.useState<Workload>(DEFAULT_WORKLOAD);
  const [selfhost, setSelfhost] = React.useState<SelfHostAssumptions>(DEFAULT_SELFHOST);
  const [selected, setSelected] = React.useState<string[]>(() => {
    const base = defaultCostModels();
    const requested = resolveModelId(initialModelId);
    if (requested && !base.includes(requested)) base.unshift(requested);
    return base;
  });
  const [axis, setAxis] = React.useState<string>("mmlu");

  // Subscribing keeps every derived list correct across a catalog sync: a daily
  // sync that adds or reprices a model must reach the table, the frontier plot
  // and the add-model picker without a reload. Every sibling page (Compare,
  // Bench, Leaderboard, Playground) does the same.
  const snapshot = useCatalogSnapshot();

  const w = (patch: Partial<Workload>) => setWorkload((s) => ({ ...s, ...patch }));
  const sh = (patch: Partial<SelfHostAssumptions>) =>
    setSelfhost((s) => ({ ...s, ...patch }));

  const rows = React.useMemo(() => {
    return selected
      .map((id) => getModelById(id))
      .filter((m): m is NonNullable<typeof m> => !!m && m.status !== "upcoming")
      .map((m) => ({ model: m, cost: apiMonthlyCost(m, workload) }))
      .sort((a, b) => a.cost.total - b.cost.total);
  }, [selected, workload, snapshot]);

  const cheapest = rows[0];
  const selfHost = React.useMemo(
    () => selfHostEstimate(selfhost, workload),
    [selfhost, workload],
  );

  const cheapestOpen = rows.find((r) => r.model.license === "open");
  const breakEven = cheapestOpen
    ? breakEvenRequestsPerDay(cheapestOpen.model, workload, selfHost.monthly)
    : null;

  // Frontier: every routable model with the chosen benchmark.
  //
  // A slider drag replaces `workload` on every tick, and this recomputes
  // apiMonthlyCost across all 97 models and then re-lays-out a recharts
  // scatter plot. Deferring it lets the slider and its numeric readouts (which
  // use the immediate `workload` above) stay at pointer speed while the chart
  // catches up — the settled result is identical.
  const deferredWorkload = React.useDeferredValue(workload);
  const frontier = React.useMemo(() => {
    // Capped: the catalog is ~400 models, and a scatter plot of every one of
    // them is both unreadable and expensive for recharts to lay out on each
    // slider tick. The strongest 120 on the chosen axis is the interesting part
    // of the frontier anyway.
    return allModels()
      .filter((m) => m.status !== "upcoming" && getBenchmark(m, axis) !== undefined)
      .sort((a, b) => (getBenchmark(b, axis) ?? 0) - (getBenchmark(a, axis) ?? 0))
      .slice(0, 120)
      .map((m) => ({
        id: m.id,
        name: m.name,
        x: apiMonthlyCost(m, deferredWorkload).total,
        y: getBenchmark(m, axis)!,
        open: m.license === "open",
        selected: selected.includes(m.id),
      }));
  }, [axis, deferredWorkload, selected, snapshot]);

  const available = React.useMemo(
    () => allModels().filter((m) => m.status !== "upcoming" && !selected.includes(m.id)),
    [selected, snapshot],
  );

  function exportCSV() {
    const header = "Model,Provider,License,Input $,Output $,Monthly $,Per 1k req $\n";
    const body = rows
      .map((r) =>
        [
          r.model.name,
          r.model.provider,
          r.model.license,
          r.cost.input.toFixed(2),
          r.cost.output.toFixed(2),
          r.cost.total.toFixed(2),
          r.cost.per1kRequests.toFixed(4),
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "atlas-cost-estimate.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const maxCost = React.useMemo(
    () => rows.reduce((max, r) => Math.max(max, r.cost.total), 1),
    [rows],
  );

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Cost
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Model your real workload across frontier APIs and open self-hosting.
          Everything recomputes live.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Workload form */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <Coins className="size-4 text-action" /> Workload
            </div>
            <div className="space-y-4">
              <NumberField
                label="Requests / day"
                value={workload.requestsPerDay}
                onChange={(v) => w({ requestsPerDay: v })}
                step={1000}
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Avg input tokens"
                  value={workload.avgInputTokens}
                  onChange={(v) => w({ avgInputTokens: v })}
                  step={100}
                />
                <NumberField
                  label="Avg output tokens"
                  value={workload.avgOutputTokens}
                  onChange={(v) => w({ avgOutputTokens: v })}
                  step={100}
                />
              </div>
              <SliderField
                label="Cached input ratio"
                value={workload.cachedRatio}
                display={`${Math.round(workload.cachedRatio * 100)}%`}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => w({ cachedRatio: v })}
              />
              <SliderField
                label="Peak concurrency factor"
                value={workload.peakFactor}
                display={`${workload.peakFactor.toFixed(1)}×`}
                min={1}
                max={10}
                step={0.5}
                onChange={(v) => w({ peakFactor: v })}
              />
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <Server className="size-4 text-amber" /> Open-model self-hosting
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="GPU $/hr"
                  value={selfhost.gpuHourly}
                  onChange={(v) => sh({ gpuHourly: v })}
                  step={0.25}
                />
                <NumberField
                  label="GPU count"
                  value={selfhost.gpuCount}
                  onChange={(v) => sh({ gpuCount: Math.max(1, Math.round(v)) })}
                  step={1}
                />
              </div>
              <NumberField
                label="Throughput (tokens/sec)"
                value={selfhost.throughputTps}
                onChange={(v) => sh({ throughputTps: v })}
                step={10}
              />
              <SliderField
                label="Utilization"
                value={selfhost.utilization}
                display={`${Math.round(selfhost.utilization * 100)}%`}
                min={0.05}
                max={1}
                step={0.05}
                onChange={(v) => sh({ utilization: v })}
              />
            </div>
          </Card>
        </aside>

        {/* Results */}
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard
              icon={Coins}
              tone="ridge"
              label="Cheapest API"
              value={cheapest ? formatUSD(cheapest.cost.total) : "—"}
              sub={cheapest ? `${cheapest.model.name} / mo` : ""}
            />
            <SummaryCard
              icon={Server}
              tone="upland"
              label="Self-host TCO"
              value={formatUSD(selfHost.monthly)}
              sub={`${selfhost.gpuCount}× GPU · ${formatUSD(selfHost.costPerMtok, { precise: true })}/Mtok`}
            />
            <SummaryCard
              icon={TrendingDown}
              tone="shelf"
              label="Self-host break-even"
              value={
                breakEven && isFinite(breakEven)
                  ? `${formatCompact(Math.round(breakEven))}/day`
                  : "—"
              }
              sub={cheapestOpen ? `vs ${cheapestOpen.model.name}` : "add an open model"}
            />
          </div>

          {/* Per-model cost */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Cpu className="size-4 text-action" /> Monthly cost by model
              </div>
              <div className="flex items-center gap-2">
                <AddModel
                  available={available}
                  onAdd={(id) => setSelected((s) => [...s, id])}
                />
                <Button variant="secondary" size="sm" onClick={exportCSV}>
                  <Download className="size-4" /> CSV
                </Button>
              </div>
            </div>
            <div className="divide-y divide-border/70">
              {rows.map((r) => (
                <div
                  key={r.model.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem_2rem]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge
                      variant={r.model.license === "open" ? "success" : "default"}
                      className="shrink-0"
                    >
                      {r.model.license === "open" ? "open" : "closed"}
                    </Badge>
                    <span className="truncate font-medium">{r.model.name}</span>
                  </div>
                  <div className="hidden items-center gap-2 sm:flex">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-action transition-all duration-500"
                        style={{ width: `${(r.cost.total / maxCost) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right font-mono text-sm font-semibold">
                    {formatUSD(r.cost.total)}
                    <span className="ml-1 text-2xs font-normal text-muted-foreground">
                      /mo
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      setSelected((s) => s.filter((id) => id !== r.model.id))
                    }
                    className="justify-self-end text-muted-foreground hover:text-danger"
                    aria-label="Remove"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              {rows.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Add a model to estimate cost.
                </div>
              )}
            </div>
          </Card>

          {/* Frontier */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">
                  Cost-vs-capability frontier
                </div>
                <p className="text-xs text-muted-foreground">
                  Lower-cost, higher-capability models sit toward the top-left.
                </p>
              </div>
              <Select value={axis} onValueChange={setAxis}>
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BENCHMARKS.map((b) => (
                    <SelectItem key={b.key} value={b.key}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Height is reserved by the wrapper so the lazily-loaded chart
                can't shift the page when it arrives, and the local Suspense
                boundary keeps its loading state from bubbling up to the route
                boundary — otherwise the entire page waits on the chart chunk. */}
            <div className="h-[340px] w-full">
              <React.Suspense fallback={null}>
                <FrontierChart data={frontier} />
              </React.Suspense>
            </div>
            {/* Open on the shelf, closed on the ridge — matching
                `FrontierChart`'s `Cell` fills and the hero plot. These two were
                the wrong way round against the chart they label. */}
            <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-accent" /> Open
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-action" /> Closed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full border border-foreground bg-accent" />{" "}
                In your selection
              </span>
            </div>
          </Card>
        </div>
      </div>

      {/* Mobile sticky estimate */}
      {cheapest && (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t border-border bg-background/90 px-4 py-2.5 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Cheapest</span>
            <span className="font-mono font-semibold">
              {formatUSD(cheapest.cost.total)}/mo
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {cheapest.model.name}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  tone: "ridge" | "upland" | "shelf";
}) {
  const toneClass = ACCENT_TEXT[tone];
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className={cn("size-4", toneClass)} /> {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tnum">{value}</div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>
    </Card>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-9 font-mono"
      />
    </div>
  );
}

function SliderField({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="font-mono text-xs">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

function AddModel({
  available,
  onAdd,
}: {
  available: CatalogModel[];
  onAdd: (id: string) => void;
}) {
  return (
    <Select value="" onValueChange={(v) => v && onAdd(v)}>
      <SelectTrigger className="h-9 w-[130px]">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <Plus className="size-4" /> Add model
        </span>
      </SelectTrigger>
      <SelectContent>
        {available.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
