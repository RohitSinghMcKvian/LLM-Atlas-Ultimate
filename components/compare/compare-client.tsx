"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  Sparkles,
  X,
  Send,
  Square,
  Check,
  AlertCircle,
  Globe,
  Coins,
  BookmarkPlus,
  Pin,
  GitCompareArrows,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "@/components/markdown";
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
import { routableModels, getModelById } from "@/lib/catalog";
import { useProviders } from "@/lib/hooks/use-providers";
import { useKeysStore } from "@/lib/store/keys-store";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { cn, formatUSD } from "@/lib/utils";

type ColStatus = "idle" | "streaming" | "done" | "error";
interface Column {
  id: string;
  status: ColStatus;
  text: string;
  provider?: string;
  error?: string;
}

const DEFAULTS = ["claude-sonnet-4-5", "deepseek-v4-pro", "gpt-oss-120b"];

function parseSynthesis(raw: string) {
  const sec = (name: string) => {
    const re = new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    return re.exec(raw)?.[1]?.trim() ?? "";
  };
  const synthesis = sec("Synthesis");
  const bullets = (s: string) =>
    s
      .split("\n")
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  const agreements = bullets(sec("Agreements"));
  const divergences = bullets(sec("Divergences"));
  const hasStructure = synthesis || agreements.length || divergences.length;
  return {
    synthesis: hasStructure ? synthesis || raw : raw,
    agreements,
    divergences,
  };
}

export function CompareClient({ initialIds }: { initialIds?: string[] }) {
  const providers = useProviders();
  const keyHeaders = useUserKeyHeaders();
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const all = React.useMemo(() => routableModels(), []);
  const [selected, setSelected] = React.useState<string[]>(() => {
    const init = (initialIds ?? []).filter((id) => getModelById(id));
    return init.length ? init : DEFAULTS;
  });
  const [query, setQuery] = React.useState("");
  const [webRetrieval, setWebRetrieval] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [columns, setColumns] = React.useState<Record<string, Column>>({});
  const [synth, setSynth] = React.useState<{ status: ColStatus; text: string }>({
    status: "idle",
    text: "",
  });
  const [pinned, setPinned] = React.useState<Set<string>>(new Set());
  const [runError, setRunError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const costPreview = React.useMemo(() => {
    const inTok = Math.ceil(query.length / 4) + 24;
    const outTok = 500;
    return selected.reduce((sum, id) => {
      const m = getModelById(id);
      if (!m) return sum;
      return (
        sum +
        (inTok / 1e6) * m.pricing.inputPerM +
        (outTok / 1e6) * m.pricing.outputPerM
      );
    }, 0);
  }, [selected, query]);

  function toggleModel(id: string) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  }

  async function run() {
    if (!query.trim() || selected.length === 0 || running) return;
    setRunning(true);
    setRunError(null);
    setPinned(new Set());
    setSynth({ status: "idle", text: "" });
    setColumns(
      Object.fromEntries(
        selected.map((id) => [id, { id, status: "streaming", text: "" } as Column]),
      ),
    );
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Every model streams concurrently, so a setState per token meant N
    // interleaved re-renders of the whole page per response token. Accumulate
    // into refs and commit on a 48ms timer — the same coalescing chat and
    // playground already do. Terminal events flush synchronously first, so no
    // trailing text can be dropped.
    // `modelText` holds each column's full text (the run above reset every
    // column to ""); `dirty` is which ones changed since the last commit.
    const modelText = new Map<string, string>();
    const dirty = new Set<string>();
    let synthText = "";
    let synthDirty = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimer = null;
      if (dirty.size) {
        const ids = Array.from(dirty);
        dirty.clear();
        setColumns((c) => {
          const next = { ...c };
          for (const id of ids) {
            next[id] = { ...next[id], id, status: "streaming", text: modelText.get(id) ?? "" };
          }
          return next;
        });
      }
      if (synthDirty) {
        synthDirty = false;
        const text = synthText;
        setSynth((s) => (s.status === "streaming" ? { ...s, text } : s));
      }
    };
    const schedule = () => {
      if (flushTimer == null) flushTimer = setTimeout(flush, 48);
    };
    const flushNow = () => {
      if (flushTimer != null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
    };

    try {
      for await (const ev of postSSE<any>(
        "/api/v1/compare",
        { query, modelIds: selected },
        ctrl.signal,
        keyHeaders,
      )) {
        switch (ev.type) {
          case "model_meta":
            setColumns((c) => ({
              ...c,
              [ev.id]: { ...c[ev.id], provider: ev.provider },
            }));
            break;
          case "model_delta":
            modelText.set(ev.id, (modelText.get(ev.id) ?? "") + ev.text);
            dirty.add(ev.id);
            schedule();
            break;
          case "model_done":
            flushNow();
            setColumns((c) => ({
              ...c,
              [ev.id]: { ...c[ev.id], status: "done" },
            }));
            break;
          case "model_error":
            flushNow();
            if (ev.code === "key_required") setKeyModalOpen(true);
            setColumns((c) => ({
              ...c,
              [ev.id]: { ...c[ev.id], status: "error", error: ev.message },
            }));
            break;
          case "synthesis_start":
            synthText = "";
            synthDirty = false;
            setSynth({ status: "streaming", text: "" });
            break;
          case "synthesis_delta":
            synthText += ev.text;
            synthDirty = true;
            schedule();
            break;
          case "synthesis_done":
            flushNow();
            setSynth((s) => ({ ...s, status: "done" }));
            break;
          case "synthesis_error":
            flushNow();
            setSynth((s) => ({ ...s, status: "error" }));
            break;
        }
      }
      flushNow();
    } catch (e) {
      flushNow();
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

  const parsed = React.useMemo(() => parseSynthesis(synth.text), [synth.text]);
  const hasResults = Object.keys(columns).length > 0;

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Compare
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One question, many models, in parallel — then synthesized into a
          single answer with agreements and divergences.
        </p>
      </div>

      {!providers.loading && !providers.any && (
        <div className="mb-5">
          <ProviderBanner />
        </div>
      )}

      {/* Composer */}
      <div className="rounded-2xl border border-border bg-surface/50 p-4 shadow-glow sm:p-5">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
          }}
          rows={3}
          placeholder="Ask anything — e.g. 'Explain the trade-offs between RAG and long-context for a 200-page knowledge base.'"
          className="w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/60"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {selected.map((id) => {
            const m = getModelById(id)!;
            return (
              <Badge key={id} variant="primary" className="gap-1.5 py-1">
                <Sparkles className="size-3" />
                {m.name}
                <button onClick={() => toggleModel(id)} disabled={running}>
                  <X className="size-3 opacity-70 hover:opacity-100" />
                </button>
              </Badge>
            );
          })}

          <Popover>
            <PopoverTrigger asChild>
              <button
                disabled={running}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-cyan hover:text-foreground disabled:opacity-50"
              >
                <Plus className="size-3" /> Add model
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
              <Command>
                <CommandInput placeholder="Add a model…" />
                <CommandList>
                  <CommandEmpty>No model found.</CommandEmpty>
                  <CommandGroup>
                    {all
                      .filter((m) => !selected.includes(m.id))
                      .map((m) => (
                        <CommandItem
                          key={m.id}
                          value={`${m.name} ${m.provider}`}
                          onSelect={() => toggleModel(m.id)}
                        >
                          <Sparkles />
                          {m.name}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {m.provider}
                          </span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <label className="ml-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="size-3.5" /> Web
            <Switch
              checked={webRetrieval}
              onCheckedChange={setWebRetrieval}
            />
          </label>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
              <Coins className="size-3.5 text-amber" />
              est. {formatUSD(costPreview, { precise: true })}/run
            </span>
            {running ? (
              <Button variant="danger" onClick={stop}>
                <Square className="size-4" /> Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={run}
                disabled={!query.trim() || selected.length === 0}
              >
                <Send className="size-4" /> Run compare
              </Button>
            )}
          </div>
        </div>
      </div>

      {runError && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertCircle className="size-4" /> {runError}
        </div>
      )}

      {/* Synthesis */}
      <AnimatePresence>
        {synth.status !== "idle" && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6"
          >
            <div className="rounded-2xl border border-cyan/25 bg-gradient-primary-soft p-5 shadow-glow">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="grid size-6 place-items-center rounded-lg bg-gradient-primary text-primary-foreground">
                    <GitCompareArrows className="size-3.5" />
                  </span>
                  Synthesis
                  {synth.status === "streaming" && (
                    <span className="inline-block h-3 w-1.5 animate-caret-blink bg-cyan align-middle" />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => alert("Saved to Atlas Notebooks (coming soon)")}
                >
                  <BookmarkPlus className="size-4" /> Save
                </Button>
              </div>

              {parsed.synthesis && <Markdown>{parsed.synthesis}</Markdown>}

              {(parsed.agreements.length > 0 ||
                parsed.divergences.length > 0) && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {parsed.agreements.length > 0 && (
                    <div className="rounded-xl border border-success/25 bg-success/5 p-3.5">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-success">
                        <Check className="size-3.5" /> Agreements
                      </p>
                      <ul className="space-y-1.5 text-sm">
                        {parsed.agreements.map((a, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {parsed.divergences.length > 0 && (
                    <div className="rounded-xl border border-amber/25 bg-amber/5 p-3.5">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber">
                        <AlertCircle className="size-3.5" /> Divergences
                      </p>
                      <ul className="space-y-1.5 text-sm">
                        {parsed.divergences.map((d, i) => {
                          const isPinned = pinned.has(d);
                          return (
                            <li
                              key={i}
                              className={cn(
                                "flex items-start gap-2 rounded-lg p-1 transition-colors",
                                isPinned && "bg-amber/10",
                              )}
                            >
                              <button
                                onClick={() =>
                                  setPinned((s) => {
                                    const n = new Set(s);
                                    n.has(d) ? n.delete(d) : n.add(d);
                                    return n;
                                  })
                                }
                                className={cn(
                                  "mt-0.5 shrink-0 transition-colors",
                                  isPinned
                                    ? "text-amber"
                                    : "text-muted-foreground/50 hover:text-amber",
                                )}
                                aria-label="Pin divergence"
                              >
                                <Pin className="size-3.5" />
                              </button>
                              {d}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Columns */}
      {hasResults && (
        <div className="mt-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Per-model answers
          </p>
          <div className="flex snap-x gap-4 overflow-x-auto pb-2 no-scrollbar">
            {selected.map((id) => {
              const col = columns[id];
              const m = getModelById(id)!;
              if (!col) return null;
              return (
                <div
                  key={id}
                  className="flex w-[300px] shrink-0 snap-start flex-col rounded-2xl border border-border bg-surface/50 sm:w-[340px] lg:flex-1"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {m.name}
                      </span>
                      {col.provider && (
                        <Badge variant="outline" className="shrink-0 text-2xs">
                          {col.provider}
                        </Badge>
                      )}
                    </div>
                    <ColStatusIcon status={col.status} />
                  </div>
                  <div className="min-h-[120px] flex-1 overflow-y-auto p-4 text-sm">
                    {col.status === "error" ? (
                      <div className="flex items-start gap-2 text-danger">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" />
                        {col.error}
                      </div>
                    ) : col.text ? (
                      <Markdown>{col.text}</Markdown>
                    ) : (
                      <ThinkingDots />
                    )}
                    {col.status === "streaming" && col.text && (
                      <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-caret-blink bg-cyan align-text-bottom" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!hasResults && !running && (
        <div className="mt-10 rounded-2xl border border-dashed border-border p-12 text-center">
          <GitCompareArrows className="mx-auto mb-3 size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Pick your models, ask a question, and run a parallel comparison.
          </p>
        </div>
      )}
    </div>
  );
}

function ColStatusIcon({ status }: { status: ColStatus }) {
  if (status === "done")
    return <Check className="size-4 text-success" />;
  if (status === "error")
    return <AlertCircle className="size-4 text-danger" />;
  if (status === "streaming")
    return (
      <span className="flex items-center gap-1 text-2xs text-cyan">
        <span className="size-1.5 animate-pulse-dot rounded-full bg-cyan" />
        thinking
      </span>
    );
  return <span className="size-1.5 rounded-full bg-muted-foreground/40" />;
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse-dot rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}
