"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Brain,
  Coins,
  ExternalLink,
  GitCompareArrows,
  MessagesSquare,
  Wrench,
  Eye,
  Image as ImageIcon,
  Database,
  Zap,
  Gauge,
  Star,
  Gift,
  KeyRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BENCHMARK_MAP, modelAccess, producesImages } from "@/lib/catalog";
import { useKeysStore } from "@/lib/store/keys-store";
import type { CatalogModel } from "@/lib/catalog/types";
import { seriesAt, useChartColors } from "@/lib/charts/palette";
import { formatContext, formatUSD, formatCompact } from "@/lib/utils";

/**
 * Benchmark categories onto the elevation ramp. These are unordered categories,
 * so which band each gets is arbitrary — what matters is that there are exactly
 * as many bands as categories and they all come from one scale. The previous
 * table mixed four palette colours with three (`#34C799`, `#38BDF8`, `#F472B6`)
 * that appeared nowhere else in the product.
 */
const CAT_COLOR: Record<string, string> = {
  reasoning: seriesAt(1),
  coding: seriesAt(4),
  math: seriesAt(3),
  knowledge: seriesAt(2),
  agentic: seriesAt(0),
  vision: seriesAt(5),
  overall: seriesAt(4),
};

function CapChip({
  on,
  icon: Icon,
  label,
}: {
  on: boolean;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
        on
          ? "border-action/30 bg-action/10 text-action"
          : "border-border bg-surface-2/50 text-muted-foreground/60 line-through"
      }`}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

export function ModelDetail({ model }: { model: CatalogModel }) {
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const hasKey = useKeysStore((s) => s.keyPresent);
  const free = modelAccess(model) === "free";
  const c = useChartColors();
  const chartData = model.benchmarks.map((b) => ({
    key: b.key,
    label: BENCHMARK_MAP[b.key]?.label ?? b.key,
    score: b.score,
    unit: BENCHMARK_MAP[b.key]?.unit ?? "%",
    category: BENCHMARK_MAP[b.key]?.category ?? "overall",
    source: b.source,
    date: b.measuredAt,
  }));

  return (
    <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.1fr_0.9fr]">
      {/* Left: identity + benchmarks */}
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">{model.blurb}</p>

        <div className="flex flex-wrap gap-2">
          <CapChip on icon={Database} label={`${formatContext(model.contextWindow)} ctx`} />
          <CapChip on={model.capabilities.reasoning} icon={Brain} label="Reasoning" />
          <CapChip on={model.capabilities.toolUse} icon={Wrench} label="Tools" />
          <CapChip on={model.modalities.includes("vision")} icon={Eye} label="Vision" />
          <CapChip on={producesImages(model)} icon={ImageIcon} label="Image output" />
          <CapChip on={model.capabilities.caching} icon={Zap} label="Caching" />
        </div>

        {chartData.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Benchmarks
            </p>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
                >
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    hide
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={92}
                    tick={{ fill: c.axis, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: `${c.axis}14` }}
                    contentStyle={{
                      background: c.surface,
                      border: `1px solid ${c.border}`,
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(v: number, _n, p: any) => [
                      `${v}${p.payload.unit === "elo" ? "" : "%"}`,
                      `${p.payload.source} · ${p.payload.date}`,
                    ]}
                  />
                  <Bar dataKey="score" radius={[0, 6, 6, 0]} barSize={14}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={CAT_COLOR[d.category] ?? seriesAt(4)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-2xs text-muted-foreground/70">
              Hover a bar for source &amp; measurement date. Elo shown on the
              same axis for layout.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No benchmarks yet — this model is tracked on the{" "}
            <span className="text-amber">Upcoming</span> board.
          </div>
        )}
      </div>

      {/* Right: pricing + ops + deep links */}
      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-surface-2/40 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Coins className="size-4 text-amber" /> Pricing
            <span className="ml-auto text-2xs font-normal text-muted-foreground">
              eff. {model.pricing.effectiveFrom}
            </span>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div>
              <dt className="text-2xs uppercase text-muted-foreground">Input</dt>
              <dd className="font-mono text-sm">
                {model.status === "upcoming"
                  ? "—"
                  : formatUSD(model.pricing.inputPerM, { precise: true })}
              </dd>
            </div>
            <div>
              <dt className="text-2xs uppercase text-muted-foreground">Output</dt>
              <dd className="font-mono text-sm">
                {model.status === "upcoming"
                  ? "—"
                  : formatUSD(model.pricing.outputPerM, { precise: true })}
              </dd>
            </div>
            <div>
              <dt className="text-2xs uppercase text-muted-foreground">Cached</dt>
              <dd className="font-mono text-sm">
                {model.pricing.cachedInputPerM
                  ? formatUSD(model.pricing.cachedInputPerM, { precise: true })
                  : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-center text-2xs text-muted-foreground/70">
            per 1M tokens
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat icon={Zap} label="Latency" value={model.latencyMs ? `${(model.latencyMs / 1000).toFixed(1)}s` : "—"} />
          <Stat icon={Gauge} label="Throughput" value={model.throughputTps ? `${model.throughputTps} t/s` : "—"} />
          <Stat icon={Star} label="Rating" value={model.rating ? `${model.rating.toFixed(1)}` : "—"} />
        </div>

        {/* Access */}
        {model.status !== "upcoming" && (
          <div
            className={`flex items-center gap-2.5 rounded-xl border p-3 ${
              free
                ? "border-success/25 bg-success/5"
                : "border-accent/25 bg-accent/5"
            }`}
          >
            {free ? (
              <>
                <Gift className="size-4 shrink-0 text-success" />
                <div className="min-w-0 text-xs">
                  <span className="font-medium text-success">Free</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · open weights, served on the Atlas operator key — no key needed.
                  </span>
                </div>
              </>
            ) : (
              <>
                <KeyRound className="size-4 shrink-0 text-accent" />
                <div className="min-w-0 text-xs">
                  <span className="font-medium text-accent">
                    Bring your own key
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · runs on your OpenRouter account.
                  </span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-auto shrink-0"
                  onClick={() => setKeyModalOpen(true)}
                >
                  {hasKey ? "Connected" : "Connect key"}
                </Button>
              </>
            )}
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Routes via
          </p>
          <div className="flex flex-wrap gap-2">
            {model.routes.length ? (
              model.routes.map((r) => (
                <Badge key={r.provider} variant="outline" className="font-mono text-2xs">
                  {r.provider} · {r.model}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">
                Not yet routable
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/compare?models=${model.id}`}>
              <GitCompareArrows className="size-4" /> Compare
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/cost?model=${model.id}`}>
              <Coins className="size-4" /> Cost
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/chat?model=${model.id}`}>
              <MessagesSquare className="size-4" /> Chat
            </Link>
          </Button>
        </div>

        {/* Transparency over authority: NVIDIA NIM's model list returns only
            `{id, owned_by, created}`, so for NIM-only models the context window,
            max output and capability flags are reconstructed from the id. That is
            a useful guess, not a measurement, and must not be presented as one. */}
        {model.metaConfidence === "derived" && (
          <p className="rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Specs inferred.</span> This
            model&apos;s provider publishes only an id, so its context window and
            capabilities are derived from naming conventions and may be imprecise.
            Pricing is exact — it runs on the operator&apos;s key at no cost.
          </p>
        )}

        {chartData.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              {chartData.length} attributed sources
            </summary>
            <ul className="mt-2 space-y-1.5">
              {model.benchmarks.map((b) => (
                <li
                  key={b.key}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-muted-foreground">
                    {BENCHMARK_MAP[b.key]?.label ?? b.key}
                  </span>
                  <a
                    href={b.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-action hover:underline"
                  >
                    {b.source} <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3 text-center">
      <Icon className="mx-auto mb-1 size-4 text-muted-foreground" />
      <div className="font-mono text-sm">{value}</div>
      <div className="text-2xs uppercase text-muted-foreground">{label}</div>
    </div>
  );
}
