"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Router as RouterIcon,
  Zap,
  Coins,
  Database,
  Activity,
  Check,
  X,
  ArrowRight,
  Play,
  ExternalLink,
  Brain,
  Eye,
  Wrench,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CountUp } from "@/components/motion/count-up";
import {
  modelCountByRouteProvider,
  PROVIDER_LIST,
  PROVIDERS,
  routableModels,
  blendedPrice,
} from "@/lib/catalog";
import type { CatalogModel, ProviderId } from "@/lib/catalog/types";
import { useProviders } from "@/lib/hooks/use-providers";
import { useMounted } from "@/lib/hooks/use-media-query";
import { useKeysStore } from "@/lib/store/keys-store";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { cn, formatUSD, formatContext, formatCompact } from "@/lib/utils";

interface LogEntry {
  id: string;
  model: string;
  provider: ProviderId;
  ms: number;
  status: "ok" | "fallback" | "cached";
  cost: number;
}

const SEED_LOG: LogEntry[] = [
  { id: "l1", model: "Claude 3.5 Sonnet", provider: "openrouter", ms: 690, status: "ok", cost: 0.0042 },
  { id: "l2", model: "Llama 3.3 70B", provider: "nvidia", ms: 410, status: "ok", cost: 0.0006 },
  { id: "l3", model: "DeepSeek V3", provider: "openrouter", ms: 700, status: "cached", cost: 0.0001 },
  { id: "l4", model: "GPT-4o mini", provider: "openrouter", ms: 380, status: "ok", cost: 0.0003 },
  { id: "l5", model: "Qwen 2.5 Coder", provider: "nvidia", ms: 360, status: "fallback", cost: 0.0004 },
];

export function RouterClient() {
  const providers = useProviders();
  const mounted = useMounted();
  const keyHeaders = useUserKeyHeaders();
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const [minContext, setMinContext] = React.useState(0);
  const [maxPrice, setMaxPrice] = React.useState(20);
  const [needReasoning, setNeedReasoning] = React.useState(false);
  const [needVision, setNeedVision] = React.useState(false);
  const [needTools, setNeedTools] = React.useState(true);
  const [log, setLog] = React.useState<LogEntry[]>(SEED_LOG);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<string | null>(null);

  // Indexed once per snapshot rather than rescanning every model's routes for
  // each of the provider cards on every render.
  const routeCounts = modelCountByRouteProvider();

  // simulated live traffic
  React.useEffect(() => {
    if (!mounted) return;
    const rm = routableModels();
    const t = setInterval(() => {
      const m = rm[Math.floor(Math.random() * rm.length)];
      const provider = m.routes[0].provider;
      const statuses: LogEntry["status"][] = ["ok", "ok", "ok", "cached", "fallback"];
      setLog((l) =>
        [
          {
            id: `r${Date.now()}`,
            model: m.name,
            provider,
            ms: 250 + Math.round(Math.random() * 800),
            status: statuses[Math.floor(Math.random() * statuses.length)],
            cost: +(blendedPrice(m) * (0.5 + Math.random()) * 0.002).toFixed(4),
          },
          ...l,
        ].slice(0, 11),
      );
    }, 2600);
    return () => clearInterval(t);
  }, [mounted]);

  const { chosen, fallbacks } = React.useMemo(() => {
    const candidates = routableModels()
      .filter(
        (m) =>
          m.contextWindow >= minContext &&
          blendedPrice(m) <= maxPrice &&
          (!needReasoning || m.capabilities.reasoning) &&
          (!needVision || m.modalities.includes("vision")) &&
          (!needTools || m.capabilities.toolUse),
      )
      .sort((a, b) => blendedPrice(a) - blendedPrice(b));
    return { chosen: candidates[0] ?? null, fallbacks: candidates.slice(1, 4) };
  }, [minContext, maxPrice, needReasoning, needVision, needTools]);

  async function testRoute() {
    if (!chosen || testing) return;
    setTesting(true);
    setTestResult(null);
    const t0 = performance.now();
    let text = "";
    try {
      for await (const ev of postSSE<any>(
        "/api/v1/router/chat",
        {
          modelId: chosen.id,
          messages: [{ role: "user", content: "Reply with a single word: routed." }],
          maxTokens: 16,
        },
        undefined,
        keyHeaders,
      )) {
        if (ev.type === "delta") text += ev.text;
        else if (ev.type === "error") {
          if (ev.code === "key_required") setKeyModalOpen(true);
          setTestResult(`error: ${ev.message}`);
          setTesting(false);
          return;
        }
      }
      const ms = Math.round(performance.now() - t0);
      setTestResult(`"${text.trim()}" · ${ms}ms`);
      setLog((l) => [
        {
          id: `t${Date.now()}`,
          model: chosen.name,
          provider: chosen.routes[0].provider,
          ms,
          status: "ok" as const,
          cost: +(blendedPrice(chosen) * 0.002).toFixed(4),
        },
        ...l,
      ].slice(0, 11));
    } catch (e) {
      if (e instanceof SSEHttpError && (e.code === "key_required" || e.status === 402))
        setKeyModalOpen(true);
      setTestResult(
        e instanceof SSEHttpError ? e.message : (e as Error).message,
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Router
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One OpenAI-compatible API across every provider — with cost-aware
          routing, fallback, and caching.
        </p>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={Activity} tone="cyan" label="Requests / 24h">
          <CountUp value={48213} />
        </Stat>
        <Stat icon={Zap} tone="violet" label="Avg latency">
          <CountUp value={512} suffix="ms" />
        </Stat>
        <Stat icon={Database} tone="amber" label="Cache hit rate">
          <CountUp value={34} suffix="%" />
        </Stat>
        <Stat icon={Coins} tone="success" label="Spend / 24h">
          <span className="tnum">$<CountUp value={186} /></span>
        </Stat>
      </div>

      {/* Providers */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {PROVIDER_LIST.map((p) => {
          const configured =
            providers.providers.find((x) => x.id === p.id)?.configured ?? false;
          const count = routeCounts.get(p.id) ?? 0;
          return (
            <Card key={p.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="grid size-9 place-items-center rounded-xl"
                    style={{
                      background: `${ACCENT[p.accent]}1f`,
                      color: ACCENT[p.accent],
                    }}
                  >
                    <RouterIcon className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-2xs text-muted-foreground">
                      {count} routable models
                    </p>
                  </div>
                </div>
                {mounted &&
                  (configured ? (
                    <Badge variant="success">
                      <Check className="size-3" /> connected
                    </Badge>
                  ) : (
                    <Badge variant="default">
                      <X className="size-3" /> off
                    </Badge>
                  ))}
              </div>
              <p className="mt-3 font-mono text-2xs text-muted-foreground">
                {p.defaultBaseUrl}
              </p>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Routing policy */}
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-cyan" /> Cost-aware routing
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Pick the cheapest model that satisfies your constraints — Atlas
            Router resolves the rest, with fallback if a provider is down.
          </p>

          <div className="space-y-4">
            <Range
              label="Min context"
              value={minContext}
              display={minContext === 0 ? "Any" : formatContext(minContext)}
              min={0}
              max={200000}
              step={32000}
              onChange={setMinContext}
            />
            <Range
              label="Max blended $/Mtok"
              value={maxPrice}
              display={`$${maxPrice}`}
              min={0.5}
              max={20}
              step={0.5}
              onChange={setMaxPrice}
            />
            <div className="flex flex-wrap gap-4">
              <Toggle icon={Brain} label="Reasoning" on={needReasoning} set={setNeedReasoning} />
              <Toggle icon={Eye} label="Vision" on={needVision} set={setNeedVision} />
              <Toggle icon={Wrench} label="Tools" on={needTools} set={setNeedTools} />
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-cyan/30 bg-gradient-primary-soft p-4">
            {chosen ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xs uppercase tracking-wide text-muted-foreground">
                      Routes to
                    </p>
                    <p className="font-display text-lg font-semibold">
                      {chosen.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {chosen.provider} · {chosen.routes[0]?.provider} ·{" "}
                      {formatContext(chosen.contextWindow)} ·{" "}
                      {formatUSD(blendedPrice(chosen), { precise: true })}/Mtok
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={testRoute}
                    disabled={testing}
                  >
                    <Play className="size-4" /> {testing ? "Routing…" : "Test route"}
                  </Button>
                </div>
                {testResult && (
                  <p className="mt-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-2xs">
                    {testResult}
                  </p>
                )}
                {!providers.loading && !providers.any && (
                  <p className="mt-2 text-2xs text-amber">
                    Add a provider key in .env.local to test a live route.
                  </p>
                )}
                {fallbacks.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-2xs text-muted-foreground">fallback:</span>
                    {fallbacks.map((f) => (
                      <Badge key={f.id} variant="outline" className="text-2xs">
                        {f.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No model satisfies these constraints — loosen them.
              </p>
            )}
          </div>
        </Card>

        {/* Live log */}
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4 text-cyan" /> Live requests
            <span className="ml-auto inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-success" />
              streaming
            </span>
          </div>
          <div className="space-y-1.5">
            <AnimatePresence initial={false}>
              {log.map((e) => (
                <motion.div
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
                >
                  <span className="font-mono text-2xs uppercase text-muted-foreground">
                    {PROVIDERS[e.provider].short}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {e.model}
                  </span>
                  <StatusTag status={e.status} />
                  <span className="font-mono text-2xs text-muted-foreground">
                    {e.ms}ms
                  </span>
                  <span className="w-14 text-right font-mono text-2xs">
                    {formatUSD(e.cost, { precise: true })}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </Card>
      </div>
    </div>
  );
}

const ACCENT: Record<string, string> = {
  cyan: "#22D3EE",
  violet: "#A78BFA",
  amber: "#F5A623",
  blue: "#60A5FA",
  orange: "#FB923C",
};

function StatusTag({ status }: { status: LogEntry["status"] }) {
  const map = {
    ok: { label: "ok", cls: "text-success" },
    cached: { label: "cached", cls: "text-cyan" },
    fallback: { label: "fallback", cls: "text-amber" },
  }[status];
  return <span className={cn("text-2xs", map.cls)}>{map.label}</span>;
}

function Stat({
  icon: Icon,
  label,
  tone,
  children,
}: {
  icon: React.ElementType;
  label: string;
  tone: "cyan" | "violet" | "amber" | "success";
  children: React.ReactNode;
}) {
  const cls = {
    cyan: "text-cyan",
    violet: "text-[#A78BFA]",
    amber: "text-amber",
    success: "text-success",
  }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-muted-foreground">
        <Icon className={cn("size-4", cls)} /> {label}
      </div>
      <div className="mt-1.5 font-mono text-2xl font-semibold">{children}</div>
    </Card>
  );
}

function Range({
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
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

function Toggle({
  icon: Icon,
  label,
  on,
  set,
}: {
  icon: React.ElementType;
  label: string;
  on: boolean;
  set: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <Switch checked={on} onCheckedChange={set} />
      <Icon className="size-3.5 text-muted-foreground" />
      {label}
    </label>
  );
}
