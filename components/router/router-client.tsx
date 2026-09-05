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
  Play,
  Brain,
  Eye,
  Wrench,
  ShieldCheck,
  KeyRound,
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
import type { CatalogModel } from "@/lib/catalog/types";
import { modelAvailability, type Availability } from "@/lib/catalog/availability";
import type { RouterCall } from "@/lib/router/telemetry";
import { useProviders } from "@/lib/hooks/use-providers";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { useRouterCalls, summarizeRouterCalls } from "@/lib/hooks/use-router-calls";
import { useMounted } from "@/lib/hooks/use-media-query";
import { useKeysStore } from "@/lib/store/keys-store";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { ACCENT_TEXT } from "@/lib/accent";
import { cn, formatUSD, formatContext } from "@/lib/utils";

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
  const [includeKeyed, setIncludeKeyed] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<string | null>(null);

  const env = useRouteEnv();
  const calls = useRouterCalls();
  const summary = React.useMemo(() => summarizeRouterCalls(calls), [calls]);
  const streaming = calls.filter((c) => c.status === "streaming").length;

  // Indexed once per snapshot rather than rescanning every model's routes for
  // each of the provider cards on every render.
  const routeCounts = modelCountByRouteProvider();


  // Availability is part of the constraint, not an afterthought.
  //
  // This used to filter `routableModels()` on capability and price alone, so on
  // a deployment without an OpenRouter key it confidently recommended a model
  // that answers 402 — a routing page recommending an unroutable route. It now
  // asks `modelAvailability`, the same function the server routes on, and says
  // plainly whether the winner is free or billed to your key.
  const { chosen, chosenAvailability, fallbacks } = React.useMemo(() => {
    const none = { chosen: null, chosenAvailability: null, fallbacks: [] as CatalogModel[] };
    if (!env) return none;

    const scored: { model: CatalogModel; availability: Availability }[] = [];
    for (const m of routableModels()) {
      if (m.contextWindow < minContext) continue;
      if (blendedPrice(m) > maxPrice) continue;
      if (needReasoning && !m.capabilities.reasoning) continue;
      if (needVision && !m.modalities.includes("vision")) continue;
      if (needTools && !m.capabilities.toolUse) continue;

      const availability = modelAvailability(m, env);
      if (availability.kind === "unavailable") continue;
      // A model needing a key the visitor has not connected is only a candidate
      // if they have said they want to see those.
      if (availability.kind === "needs_key" && !includeKeyed) continue;
      scored.push({ model: m, availability });
    }

    // Cheapest first, and free counts as free: a zero-cost route beats a $0.02
    // one even when the catalog price says otherwise, because the operator is
    // paying for it.
    scored.sort((a, b) => {
      const aFree = a.availability.kind === "free" ? 0 : 1;
      const bFree = b.availability.kind === "free" ? 0 : 1;
      return aFree - bFree || blendedPrice(a.model) - blendedPrice(b.model);
    });

    if (scored.length === 0) return none;
    return {
      chosen: scored[0].model,
      chosenAvailability: scored[0].availability,
      fallbacks: scored.slice(1, 4).map((s) => s.model),
    };
  }, [env, includeKeyed, minContext, maxPrice, needReasoning, needVision, needTools]);

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
      // No manual log write: the tap in `postSSE` recorded this call — with the
      // provider that actually served it, not the one we guessed — before the
      // first token reached this loop.
      const ms = Math.round(performance.now() - t0);
      setTestResult(`"${text.trim()}" · ${ms}ms`);
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

      {/* Stats — this browser's own traffic.
          These were four invented constants (48,213 requests, 512ms, 34% cache
          hit rate, $186 spent) on a page whose entire subject is what the router
          is doing. Real numbers over a small sample beat impressive fiction. */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={Activity} tone="ridge" label="Requests this session">
          {mounted ? <CountUp value={summary.calls} /> : "—"}
        </Stat>
        <Stat icon={Zap} tone="shelf" label="Median first token">
          {mounted && summary.medianTtftMs !== undefined ? (
            <CountUp value={summary.medianTtftMs} suffix="ms" />
          ) : (
            "—"
          )}
        </Stat>
        <Stat icon={Database} tone="upland" label="Fell back to a backup">
          {mounted && summary.calls > 0 ? (
            <CountUp value={Math.round(summary.fallbackRate * 100)} suffix="%" />
          ) : (
            "—"
          )}
        </Stat>
        <Stat icon={Coins} tone="success" label="Billed to your key">
          <span className="tnum">
            {/* `$0.0000` reads like a rounding artefact. Nothing spent is "$0". */}
            {!mounted
              ? "—"
              : summary.spendUsd === 0
                ? "$0"
                : formatUSD(summary.spendUsd, { precise: true })}
          </span>
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
            <ShieldCheck className="size-4 text-action" /> Cost-aware routing
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
              {/* Off by default so the recommendation is something you can run
                  right now. On, it opens up the frontier models your own key
                  would pay for. */}
              <Toggle
                icon={KeyRound}
                label="Include models needing your key"
                on={includeKeyed}
                set={setIncludeKeyed}
              />
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-action/30 bg-action/10 p-4">
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
                      {chosen.provider} ·{" "}
                      {/* The provider that would actually serve it, which is
                          `availability.route` — not `routes[0]`, which is the
                          catalog's order and can name a provider with no key. */}
                      {chosenAvailability && "route" in chosenAvailability
                        ? (PROVIDERS[chosenAvailability.route.provider]?.short ??
                          chosenAvailability.route.provider)
                        : "no route"}{" "}
                      · {formatContext(chosen.contextWindow)} ·{" "}
                      {chosenAvailability?.kind === "free"
                        ? "free to run"
                        : `${formatUSD(blendedPrice(chosen), { precise: true })}/Mtok`}
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
                {env && !includeKeyed
                  ? "No model you can run right now satisfies these constraints — loosen them, or include models that need your key."
                  : "No model satisfies these constraints — loosen them."}
              </p>
            )}
          </div>
        </Card>

        {/* Live log — real traffic from this browser. */}
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4 text-action" /> Requests
            {calls.length > 0 && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
                {streaming > 0 ? (
                  <>
                    <span className="size-1.5 animate-pulse-dot rounded-full bg-success" />
                    {streaming} in flight
                  </>
                ) : (
                  `last ${calls.length}`
                )}
              </span>
            )}
          </div>

          {calls.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing routed yet in this tab.
              </p>
              <p className="mx-auto mt-1 max-w-xs text-2xs text-muted-foreground">
                Every model call Atlas makes — from Chat, Code, Compare, Playground,
                Bench and Learn — shows up here with the provider that actually
                served it. Try the route above, or open Chat.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <AnimatePresence initial={false}>
                {calls.map((c) => (
                  <motion.div
                    key={c.id}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
                  >
                    <span className="w-8 shrink-0 font-mono text-2xs uppercase text-muted-foreground">
                      {c.provider ? (PROVIDERS[c.provider]?.short ?? c.provider) : "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium" title={c.modelId}>
                      {c.modelName}
                    </span>
                    <CallStatus call={c} />
                    <span className="w-12 shrink-0 text-right font-mono text-2xs text-muted-foreground">
                      {c.ttftMs !== undefined
                        ? `${c.ttftMs}ms`
                        : c.totalMs !== undefined
                          ? `${c.totalMs}ms`
                          : ""}
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono text-2xs">
                      {c.costUsd === undefined
                        ? ""
                        : c.costUsd === 0
                          ? "free"
                          : formatUSD(c.costUsd, { precise: true })}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * Provider tints. Keyed by the `accent` names in `lib/catalog/providers.ts`,
 * which predate the elevation ramp — the keys are legacy labels, the values are
 * bands. Five providers, five bands, so every provider is distinguishable.
 */
const ACCENT: Record<string, string> = {
  cyan: "rgb(var(--elev-1))",
  violet: "rgb(var(--elev-0))",
  amber: "rgb(var(--elev-3))",
  blue: "rgb(var(--elev-2))",
  orange: "rgb(var(--elev-4))",
};

/**
 * What happened to one call.
 *
 * "fallback" outranks "ok" deliberately: a request the first provider refused
 * and a backup served is the Router's whole reason to exist, and it is the one
 * outcome worth noticing in a list of otherwise identical green rows.
 */
function CallStatus({ call }: { call: RouterCall }) {
  if (call.status === "streaming") {
    return <span className="text-2xs text-muted-foreground">streaming…</span>;
  }
  if (call.status === "error") {
    return (
      <span className="text-2xs text-danger" title={call.error}>
        failed
      </span>
    );
  }
  if (call.fellBack) {
    return (
      <span className="text-2xs text-amber" title="The first provider failed; a backup served it.">
        fallback
      </span>
    );
  }
  return <span className="text-2xs text-success">ok</span>;
}

function Stat({
  icon: Icon,
  label,
  tone,
  children,
}: {
  icon: React.ElementType;
  label: string;
  tone: "ridge" | "shelf" | "upland" | "success";
  children: React.ReactNode;
}) {
  const cls = { ...ACCENT_TEXT, success: "text-success" }[tone];
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
