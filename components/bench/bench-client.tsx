"use client";

import * as React from "react";
import { defaultBenchModels } from "@/lib/catalog/defaults";
import { resolveModelIds } from "@/lib/catalog/resolve";
import { useCatalogSnapshot } from "@/lib/hooks/use-catalog-snapshot";
import { AnimatePresence, motion } from "framer-motion";
import {
  Gauge,
  Play,
  Square,
  Plus,
  X,
  Check,
  AlertCircle,
  Sparkles,
  ChevronDown,
  Upload,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { ProviderBanner } from "@/components/provider-banner";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { SUITES, grade, type EvalCase } from "@/lib/bench/suites";
import { routableModels, getModelById } from "@/lib/catalog";
import { useProviders } from "@/lib/hooks/use-providers";
import { useKeysStore } from "@/lib/store/keys-store";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

interface CaseResult {
  pass: boolean;
  output: string;
  ms: number;
}

export function BenchClient() {
  const providers = useProviders();
  const keyHeaders = useUserKeyHeaders();
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const snapshot = useCatalogSnapshot();
  const all = React.useMemo(() => routableModels(), [snapshot]);
  const [suites, setSuites] = React.useState<Set<string>>(
    new Set(SUITES.map((s) => s.id)),
  );
  const [models, setModels] = React.useState<string[]>(() => defaultBenchModels());

  // The daily sync can retire a selected model mid-session; drop it rather than
  // dispatching a run against an id no provider serves.
  React.useEffect(() => {
    setModels((current) => {
      const live = resolveModelIds(current);
      if (live.length === current.length && live.every((id, i) => id === current[i])) return current;
      return live.length ? live : defaultBenchModels();
    });
  }, [snapshot]);
  const [results, setResults] = React.useState<Record<string, CaseResult>>({});
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState({ done: 0, total: 0, current: "" });
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const activeCases = React.useMemo(
    () =>
      SUITES.filter((s) => suites.has(s.id)).flatMap((s) =>
        s.cases.map((c) => ({ suiteId: s.id, c })),
      ),
    [suites],
  );

  function toggleSuite(id: string) {
    setSuites((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleModel(id: string) {
    setModels((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  async function complete(modelId: string, c: EvalCase, signal: AbortSignal) {
    let text = "";
    for await (const ev of postSSE<any>(
      "/api/v1/router/chat",
      {
        modelId,
        messages: [{ role: "user", content: c.prompt }],
        temperature: 0,
        maxTokens: 160,
      },
      signal,
      keyHeaders,
    )) {
      if (ev.type === "delta") text += ev.text;
      else if (ev.type === "error") {
        if (ev.code === "key_required") setKeyModalOpen(true);
        throw new Error(ev.message);
      }
    }
    return text;
  }

  async function run() {
    if (running || models.length === 0 || activeCases.length === 0) return;
    setRunning(true);
    setRunError(null);
    setResults({});
    const total = models.length * activeCases.length;
    setProgress({ done: 0, total, current: "" });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let done = 0;

    try {
      for (const modelId of models) {
        const m = getModelById(modelId);
        if (!m) continue;
        for (const { c } of activeCases) {
          if (ctrl.signal.aborted) throw new DOMException("aborted", "AbortError");
          setProgress({ done, total, current: `${m.name} · ${c.id}` });
          const t0 = performance.now();
          const text = await complete(modelId, c, ctrl.signal);
          const pass = grade(c.check, text);
          setResults((r) => ({
            ...r,
            [`${modelId}:${c.id}`]: { pass, output: text, ms: Math.round(performance.now() - t0) },
          }));
          done++;
          setProgress({ done, total, current: `${m.name} · ${c.id}` });
        }
      }
    } catch (e) {
      if (e instanceof SSEHttpError) {
        if (e.code === "key_required" || e.status === 402) setKeyModalOpen(true);
        setRunError(e.message);
      } else if ((e as Error).name !== "AbortError")
        setRunError((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  function scoreFor(modelId: string, suiteId: string) {
    const suite = SUITES.find((s) => s.id === suiteId)!;
    let pass = 0;
    let ran = 0;
    suite.cases.forEach((c) => {
      const r = results[`${modelId}:${c.id}`];
      if (r) {
        ran++;
        if (r.pass) pass++;
      }
    });
    return { pass, ran, total: suite.cases.length };
  }

  // Score every model once, then sort against the table. The comparator used
  // to call `overall()` twice per comparison, and each call walks every active
  // case — so a run's result updates were re-scoring the whole matrix
  // O(models · log models · cases) times per render.
  const overallByModel = React.useMemo(() => {
    const table: Record<string, { pass: number; ran: number }> = {};
    for (const id of models) {
      let pass = 0;
      let ran = 0;
      for (const { c } of activeCases) {
        const r = results[`${id}:${c.id}`];
        if (r) {
          ran++;
          if (r.pass) pass++;
        }
      }
      table[id] = { pass, ran };
    }
    return table;
  }, [models, activeCases, results]);

  const ranked = React.useMemo(
    () =>
      [...models].sort(
        (a, b) => (overallByModel[b]?.pass ?? 0) - (overallByModel[a]?.pass ?? 0),
      ),
    [models, overallByModel],
  );
  const activeSuites = React.useMemo(
    () => SUITES.filter((s) => suites.has(s.id)),
    [suites],
  );
  const hasResults = Object.keys(results).length > 0;

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Bench
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reproducible evals — run prompt sets against models, scored
          deterministically. Every result carries its metadata.
        </p>
      </div>

      {!providers.loading && !providers.any && (
        <div className="mb-5">
          <ProviderBanner />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Config */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium">Eval suites</p>
            <div className="space-y-2.5">
              {SUITES.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox
                    checked={suites.has(s.id)}
                    onCheckedChange={() => toggleSuite(s.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm">{s.name}</span>
                    <span className="block text-2xs text-muted-foreground">
                      {s.cases.length} cases · {s.judge}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">Models</p>
            <div className="flex flex-wrap gap-1.5">
              {models.map((id) => {
                const m = getModelById(id);
                if (!m) return null;
                return (
                  <Badge key={id} variant="primary" className="gap-1">
                    {m.name}
                    <button onClick={() => toggleModel(id)} disabled={running}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                );
              })}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    disabled={running}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs text-muted-foreground hover:border-action hover:text-foreground disabled:opacity-50"
                  >
                    <Plus className="size-3" /> Add
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-0">
                  <Command>
                    <CommandInput placeholder="Add a model…" />
                    <CommandList>
                      <CommandEmpty>No model.</CommandEmpty>
                      <CommandGroup>
                        {all
                          .filter((m) => !models.includes(m.id))
                          .map((m) => (
                            <CommandItem
                              key={m.id}
                              value={`${m.name} ${m.provider}`}
                              onSelect={() => toggleModel(m.id)}
                            >
                              <Sparkles />
                              {m.name}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </Card>

          {running ? (
            <Button variant="danger" className="w-full" onClick={stop}>
              <Square className="size-4" /> Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              className="w-full"
              onClick={run}
              disabled={models.length === 0 || activeCases.length === 0}
            >
              <Play className="size-4" /> Run benchmark
            </Button>
          )}

          {running && (
            <div className="space-y-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <motion.div
                  className="h-full rounded-full bg-action"
                  animate={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <p className="truncate text-2xs text-muted-foreground">
                {progress.done}/{progress.total} · {progress.current}
              </p>
            </div>
          )}
        </aside>

        {/* Results */}
        <div className="min-w-0">
          {runError && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              <AlertCircle className="size-4" /> {runError}
            </div>
          )}

          {hasResults ? (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border p-4">
                <Gauge className="size-4 text-action" />
                <span className="text-sm font-medium">Results</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => alert("Contributed to the leaderboard (coming soon)")}
                >
                  <Upload className="size-4" /> Contribute
                </Button>
              </div>

              {/* header */}
              <div
                className="grid items-center gap-2 border-b border-border px-4 py-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground"
                style={{ gridTemplateColumns: `1.6rem minmax(0,1.4fr) repeat(${activeSuites.length}, minmax(0,1fr)) 5rem 1.4rem` }}
              >
                <span>#</span>
                <span>Model</span>
                {activeSuites.map((s) => (
                  <span key={s.id} className="truncate text-right" title={s.name}>
                    {s.name.split("·")[1]?.trim() ?? s.name}
                  </span>
                ))}
                <span className="text-right">Overall</span>
                <span />
              </div>

              <div className="divide-y divide-border/70">
                {ranked.map((id, i) => {
                  const m = getModelById(id);
                  if (!m) return null;
                  const ov = overallByModel[id] ?? { pass: 0, ran: 0 };
                  const pct = ov.ran ? Math.round((ov.pass / ov.ran) * 100) : 0;
                  const open = expanded === id;
                  return (
                    <div key={id}>
                      <button
                        onClick={() => setExpanded(open ? null : id)}
                        className="grid w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2/40"
                        style={{ gridTemplateColumns: `1.6rem minmax(0,1.4fr) repeat(${activeSuites.length}, minmax(0,1fr)) 5rem 1.4rem` }}
                      >
                        <span className="font-mono text-sm text-muted-foreground">
                          {i === 0 && pct > 0 ? (
                            <Trophy className="size-4 text-amber" />
                          ) : (
                            i + 1
                          )}
                        </span>
                        <span className="truncate text-sm font-medium">{m.name}</span>
                        {activeSuites.map((s) => {
                          const sc = scoreFor(id, s.id);
                          return (
                            <span key={s.id} className="text-right font-mono text-xs">
                              {sc.ran ? (
                                <span
                                  className={
                                    sc.pass === sc.total
                                      ? "text-success"
                                      : sc.pass === 0
                                        ? "text-danger"
                                        : "text-amber"
                                  }
                                >
                                  {sc.pass}/{sc.total}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </span>
                          );
                        })}
                        <span className="flex items-center justify-end gap-2">
                          <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-surface-3 sm:block">
                            <span
                              className="block h-full rounded-full bg-action"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className="font-mono text-xs font-semibold">{pct}%</span>
                        </span>
                        <ChevronDown
                          className={cn(
                            "size-4 justify-self-end text-muted-foreground transition-transform",
                            open && "rotate-180",
                          )}
                        />
                      </button>

                      <AnimatePresence>
                        {open && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden bg-surface-2/20"
                          >
                            <div className="space-y-2 p-4">
                              {activeCases.map(({ c }) => {
                                const r = results[`${id}:${c.id}`];
                                return (
                                  <div
                                    key={c.id}
                                    className="rounded-lg border border-border bg-surface p-3"
                                  >
                                    <div className="flex items-start gap-2">
                                      {r ? (
                                        r.pass ? (
                                          <Check className="mt-0.5 size-4 shrink-0 text-success" />
                                        ) : (
                                          <X className="mt-0.5 size-4 shrink-0 text-danger" />
                                        )
                                      ) : (
                                        <span className="mt-0.5 size-4" />
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs">{c.prompt}</p>
                                        <p className="mt-1 text-2xs text-muted-foreground">
                                          expect: {c.expect}
                                          {r && ` · ${r.ms}ms`}
                                        </p>
                                        {r && (
                                          <p className="mt-1 truncate rounded bg-code px-2 py-1 font-mono text-2xs text-foreground/70">
                                            {r.output.slice(0, 120) || "(empty)"}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border px-4 py-2.5 text-2xs text-muted-foreground">
                Reproducibility · temp 0 · {activeCases.length} cases ·{" "}
                {activeSuites.map((s) => s.judge).join(", ")} · run{" "}
                {new Date().toISOString().slice(0, 10)}
              </div>
            </Card>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center">
              <Gauge className="mx-auto mb-3 size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Pick suites and models, then run the benchmark. Results are graded
                deterministically and fully reproducible.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
