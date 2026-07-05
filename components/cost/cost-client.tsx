"use client";

import * as React from "react";
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
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
  MODELS,
  getModelById,
  BENCHMARKS,
  getBenchmark,
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
import { cn, formatUSD, formatCompact } from "@/lib/utils";

const DEFAULT_SELECTION = [
  "claude-sonnet-4-5",
  "gpt-5",
  "gpt-5-mini",
  "deepseek-v4-pro",
  "llama-3-3-70b",
  "gemini-2-5-flash",
];

export function CostClient({ initialModelId }: { initialModelId?: string }) {
  const [workload, setWorkload] = React.useState<Workload>(DEFAULT_WORKLOAD);
  const [selfhost, setSelfhost] = React.useState<SelfHostAssumptions>(DEFAULT_SELFHOST);
  const [selected, setSelected] = React.useState<string[]>(() => {
    const base = [...DEFAULT_SELECTION];
    if (initialModelId && !base.includes(initialModelId)) base.unshift(initialModelId);
    return base.filter((id) => getModelById(id));
  });
  const [axis, setAxis] = React.useState<string>("mmlu");

  const w = (patch: Partial<Workload>) => setWorkload((s) => ({ ...s, ...patch }));
  const sh = (patch: Partial<SelfHostAssumptions>) =>
    setSelfhost((s) => ({ ...s, ...patch }));

  const rows = React.useMemo(() => {
    return selected
      .map((id) => getModelById(id))
      .filter((m): m is NonNullable<typeof m> => !!m && m.status !== "upcoming")
      .map((m) => ({ model: m, cost: apiMonthlyCost(m, workload) }))
      .sort((a, b) => a.cost.total - b.cost.total);
  }, [selected, workload]);

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
  const frontier = React.useMemo(() => {
    return MODELS.filter(
      (m) => m.status !== "upcoming" && getBenchmark(m, axis) !== undefined,
    ).map((m) => ({
      id: m.id,
      name: m.name,
      x: apiMonthlyCost(m, workload).total,
      y: getBenchmark(m, axis)!,
      open: m.license === "open",
      selected: selected.includes(m.id),
    }));
  }, [axis, workload, selected]);

  const available = MODELS.filter(
    (m) => m.status !== "upcoming" && !selected.includes(m.id),
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

  const maxCost = Math.max(...rows.map((r) => r.cost.total), 1);

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
              <Coins className="size-4 text-cyan" /> Workload
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
              tone="cyan"
              label="Cheapest API"
              value={cheapest ? formatUSD(cheapest.cost.total) : "—"}
              sub={cheapest ? `${cheapest.model.name} / mo` : ""}
            />
            <SummaryCard
              icon={Server}
              tone="amber"
              label="Self-host TCO"
              value={formatUSD(selfHost.monthly)}
              sub={`${selfhost.gpuCount}× GPU · ${formatUSD(selfHost.costPerMtok, { precise: true })}/Mtok`}
            />
            <SummaryCard
              icon={TrendingDown}
              tone="violet"
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
                <Cpu className="size-4 text-cyan" /> Monthly cost by model
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
                        className="h-full rounded-full bg-gradient-primary transition-all duration-500"
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
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 4 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Monthly cost"
                    scale="log"
                    domain={[10, 1000000]}
                    ticks={[10, 100, 1000, 10000, 100000, 1000000]}
                    allowDataOverflow
                    tick={{ fill: "#8B91A3", fontSize: 11 }}
                    tickFormatter={(v) => formatUSD(v)}
                    label={{
                      value: "Monthly cost (log) →",
                      position: "insideBottom",
                      offset: -12,
                      fill: "#8B91A3",
                      fontSize: 11,
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="Score"
                    domain={["dataMin - 4", "dataMax + 4"]}
                    allowDecimals={false}
                    tick={{ fill: "#8B91A3", fontSize: 11 }}
                  />
                  <ZAxis range={[60, 60]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3", stroke: "#33394a" }}
                    contentStyle={{
                      background: "rgb(18 20 29)",
                      border: "1px solid rgb(52 57 73)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(value: number, name: string) =>
                      name === "Monthly cost"
                        ? [formatUSD(value), "Cost/mo"]
                        : [value, "Score"]
                    }
                    labelFormatter={() => ""}
                    content={<FrontierTooltip />}
                  />
                  <Scatter data={frontier}>
                    {frontier.map((p) => (
                      <Cell
                        key={p.id}
                        fill={p.open ? "#22D3EE" : "#A78BFA"}
                        fillOpacity={p.selected ? 1 : 0.45}
                        stroke={p.selected ? "#fff" : "none"}
                        strokeWidth={p.selected ? 1.5 : 0}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-cyan" /> Open
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-[#A78BFA]" /> Closed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full border border-white bg-cyan" />{" "}
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

function FrontierTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-border-strong bg-popover p-2.5 text-xs shadow-float">
      <div className="font-medium">{p.name}</div>
      <div className="mt-1 text-muted-foreground">
        {formatUSD(p.x)}/mo · score {p.y}
      </div>
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
  tone: "cyan" | "amber" | "violet";
}) {
  const toneClass = {
    cyan: "text-cyan",
    amber: "text-amber",
    violet: "text-[#A78BFA]",
  }[tone];
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
  available: typeof MODELS;
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
