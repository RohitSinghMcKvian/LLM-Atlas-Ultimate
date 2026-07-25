"use client";

import * as React from "react";
import {
  Play,
  Square,
  Plus,
  X,
  Sparkles,
  Check,
  AlertCircle,
  Coins,
  BookmarkPlus,
  Thermometer,
  Settings2,
  ChevronRight,
  Wrench,
  Braces,
  History,
  Code2,
  Copy,
  MessageSquare,
  User,
  Bot,
  Trash2,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "@/components/markdown";
import { ReasoningBlock } from "@/components/reasoning-block";
import { ToolCall } from "@/components/tool-call";
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
import { ExportDialog } from "@/components/playground/export-dialog";
import { HistoryDialog } from "@/components/playground/history-dialog";
import { routableModels, getModelById } from "@/lib/catalog";
import { useProviders } from "@/lib/hooks/use-providers";
import { useKeysStore } from "@/lib/store/keys-store";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { usePlaygroundStore } from "@/lib/store/playground-store";
import { usePromptStore, extractVars } from "@/lib/store/prompt-store";
import {
  parseTools,
  uuid,
  EXAMPLE_TOOLS,
  type RunToolCall,
  type RunMetrics,
} from "@/lib/playground/types";
import { buildRequestBody } from "@/lib/playground/export-code";
import { messageCostUsd, formatUsd } from "@/lib/chat/cost";
import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { cn, formatUSD, timeAgo } from "@/lib/utils";

type Status = "idle" | "streaming" | "done" | "error";

interface RunCol {
  status: Status;
  text: string;
  reasoning: string;
  toolCalls: RunToolCall[];
  provider?: string;
  error?: string;
  ttftMs?: number;
  ms?: number;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
}

const emptyCol = (): RunCol => ({
  status: "streaming",
  text: "",
  reasoning: "",
  toolCalls: [],
});

export function PlaygroundClient({ initialPrompt }: { initialPrompt?: string }) {
  const providers = useProviders();
  const keyHeaders = useUserKeyHeaders();
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const all = React.useMemo(() => routableModels(), []);

  const {
    config,
    presets,
    runs,
    init,
    setConfig,
    setParams,
    resetParams,
    addTurn,
    updateTurn,
    removeTurn,
    setVariable,
    toggleModel,
    saveAsPreset,
    applyPreset,
    deletePreset,
    recordRun,
  } = usePlaygroundStore();

  const addPrompt = usePromptStore((s) => s.add);

  const [cols, setCols] = React.useState<Record<string, RunCol>>({});
  const [running, setRunning] = React.useState(false);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    init();
  }, [init]);

  // /prompt hands a rendered prompt via ?prompt= — seed a fresh conversation.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (initialPrompt && !seeded.current) {
      seeded.current = true;
      setConfig({
        turns: [{ id: uuid(), role: "user", content: initialPrompt }],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const { system, turns, params, models, toolsJson, variables } = config;

  const vars = React.useMemo(
    () => extractVars([system, ...turns.map((t) => t.content)].join("\n")),
    [system, turns],
  );

  const toolsParsed = React.useMemo(() => parseTools(toolsJson), [toolsJson]);
  const toolsError = toolsParsed && "error" in toolsParsed ? toolsParsed.error : null;

  const costPreview = React.useMemo(() => {
    const chars =
      system.length + turns.reduce((n, t) => n + t.content.length, 0);
    const inTok = Math.ceil(chars / 4) + 16;
    return models.reduce((sum, id) => {
      const m = getModelById(id);
      if (!m) return sum;
      return (
        sum +
        (inTok / 1e6) * m.pricing.inputPerM +
        (params.maxTokens / 1e6) * m.pricing.outputPerM
      );
    }, 0);
  }, [models, system, turns, params.maxTokens]);

  const canRun =
    turns.some((t) => t.content.trim()) && models.length > 0 && !toolsError;

  async function run() {
    if (!canRun || running) return;
    setRunning(true);
    setRunError(null);
    setCols(Object.fromEntries(models.map((id) => [id, emptyCol()])));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const snapshot = JSON.parse(JSON.stringify(config));

    await Promise.all(
      models.map(async (id) => {
        const body = buildRequestBody(config, id);
        const t0 = performance.now();
        let ttft: number | undefined;
        let acc = "";
        let reasoning = "";
        const tools: RunToolCall[] = [];
        let promptTokens: number | undefined;
        let completionTokens: number | undefined;
        let finishReason: string | undefined;
        let errorMsg: string | undefined;

        // Coalesce token updates (~20fps) so parallel streams stay smooth.
        let timer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => {
          timer = null;
          setCols((c) => ({ ...c, [id]: { ...c[id], text: acc, reasoning } }));
        };
        const schedule = () => {
          if (timer == null) timer = setTimeout(flush, 48);
        };
        const clearFlush = () => {
          if (timer != null) {
            clearTimeout(timer);
            timer = null;
          }
        };

        try {
          for await (const ev of postSSE<any>(
            "/api/v1/router/chat",
            body,
            ctrl.signal,
            keyHeaders,
          )) {
            if (ev.type === "meta") {
              setCols((c) => ({ ...c, [id]: { ...c[id], provider: ev.provider } }));
            } else if (ev.type === "delta") {
              if (ttft == null) ttft = performance.now() - t0;
              acc += ev.text;
              schedule();
            } else if (ev.type === "reasoning") {
              if (ttft == null) ttft = performance.now() - t0;
              reasoning += ev.text;
              schedule();
            } else if (ev.type === "tool_call") {
              tools.push({ id: ev.id, name: ev.name, arguments: ev.arguments });
              setCols((c) => ({ ...c, [id]: { ...c[id], toolCalls: [...tools] } }));
            } else if (ev.type === "usage") {
              promptTokens = ev.promptTokens;
              completionTokens = ev.completionTokens;
            } else if (ev.type === "done") {
              finishReason = ev.finishReason;
            } else if (ev.type === "error") {
              errorMsg = ev.message;
              if (ev.code === "key_required") setKeyModalOpen(true);
            }
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") {
            // keep partial output
          } else if (e instanceof SSEHttpError) {
            if (e.code === "key_required" || e.status === 402) setKeyModalOpen(true);
            errorMsg = e.message;
          } else {
            errorMsg = (e as Error).message;
          }
        }

        clearFlush();
        const ms = Math.round(performance.now() - t0);
        const genMs = ttft != null ? ms - ttft : ms;
        const tps =
          completionTokens != null && genMs > 50
            ? completionTokens / (genMs / 1000)
            : undefined;
        const metrics: RunMetrics = {
          ttftMs: ttft != null ? Math.round(ttft) : undefined,
          totalMs: ms,
          promptTokens,
          completionTokens,
          tps,
          costUsd: messageCostUsd(id, promptTokens, completionTokens) || undefined,
          finishReason,
          provider: undefined,
        };

        setCols((c) => ({
          ...c,
          [id]: {
            ...c[id],
            status: errorMsg && !acc ? "error" : "done",
            text: acc,
            reasoning,
            toolCalls: tools,
            error: errorMsg,
            ttftMs: metrics.ttftMs,
            ms,
            promptTokens,
            completionTokens,
            finishReason,
          },
        }));

        if (!ctrl.signal.aborted) {
          recordRun({
            id: uuid(),
            modelId: id,
            output: acc,
            reasoning: reasoning || undefined,
            toolCalls: tools.length ? tools : undefined,
            error: errorMsg,
            metrics,
            config: snapshot,
            starred: false,
            createdAt: Date.now(),
          });
        }
      }),
    );
    setRunning(false);
    abortRef.current = null;
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const hasRuns = Object.keys(cols).length > 0;
  const gridCols =
    models.length <= 1
      ? "grid-cols-1"
      : models.length === 2
        ? "md:grid-cols-2"
        : "md:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Playground
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Multi-turn, multi-model experimentation with real metrics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PresetsMenu
            presets={presets}
            onApply={applyPreset}
            onSave={saveAsPreset}
            onDelete={deletePreset}
          />
          <Button variant="secondary" size="sm" onClick={() => setHistoryOpen(true)}>
            <History className="size-4" /> History
            {runs.length > 0 && (
              <span className="rounded-full bg-surface-3 px-1.5 text-2xs tabular-nums">
                {runs.length}
              </span>
            )}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setExportOpen(true)}
            disabled={models.length === 0}
          >
            <Code2 className="size-4" /> Code
          </Button>
        </div>
      </div>

      {!providers.loading && !providers.any && (
        <div className="mb-5">
          <ProviderBanner />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Config */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:self-start lg:pb-8 lg:pr-1">
          {/* Conversation */}
          <div className="space-y-3 rounded-2xl border border-border bg-surface/50 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="size-4 text-cyan" /> Conversation
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                System
              </Label>
              <textarea
                value={system}
                onChange={(e) => setConfig({ system: e.target.value })}
                rows={2}
                className="w-full resize-none rounded-xl border border-border bg-surface-2/50 p-2.5 text-sm outline-none focus:border-cyan/40"
              />
            </div>
            {turns.map((t, i) => (
              <div key={t.id} className="group/turn">
                <div className="mb-1.5 flex items-center justify-between">
                  <button
                    onClick={() =>
                      updateTurn(t.id, {
                        role: t.role === "user" ? "assistant" : "user",
                      })
                    }
                    disabled={running}
                    title="Toggle role"
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium",
                      t.role === "user"
                        ? "bg-surface-3 text-foreground"
                        : "bg-cyan/15 text-cyan",
                    )}
                  >
                    {t.role === "user" ? (
                      <User className="size-3" />
                    ) : (
                      <Bot className="size-3" />
                    )}
                    {t.role}
                  </button>
                  {turns.length > 1 && (
                    <button
                      onClick={() => removeTurn(t.id)}
                      disabled={running}
                      className="opacity-0 transition-opacity group-hover/turn:opacity-100"
                      title="Remove turn"
                    >
                      <X className="size-3.5 text-muted-foreground hover:text-danger" />
                    </button>
                  )}
                </div>
                <textarea
                  value={t.content}
                  onChange={(e) => updateTurn(t.id, { content: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
                  }}
                  rows={i === turns.length - 1 ? 4 : 2}
                  placeholder={
                    t.role === "user" ? "User message…" : "Assistant message…"
                  }
                  className="w-full resize-none rounded-xl border border-border bg-surface-2/50 p-2.5 text-sm outline-none focus:border-cyan/40"
                />
              </div>
            ))}
            <button
              onClick={addTurn}
              disabled={running}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" /> Add turn
            </button>
          </div>

          {/* Variables */}
          {vars.length > 0 && (
            <div className="space-y-3 rounded-2xl border border-border bg-surface/50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Braces className="size-4 text-violet" /> Variables
              </div>
              {vars.map((v) => (
                <div key={v}>
                  <Label className="mb-1 block font-mono text-xs text-muted-foreground">
                    {"{{" + v + "}}"}
                  </Label>
                  <input
                    value={variables[v] ?? ""}
                    onChange={(e) => setVariable(v, e.target.value)}
                    placeholder={`Value for ${v}`}
                    className="h-9 w-full rounded-lg border border-border bg-surface-2/50 px-2.5 text-sm outline-none focus:border-cyan/40"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Parameters */}
          <ParamsPanel
            params={params}
            onChange={setParams}
            onReset={resetParams}
          />

          {/* Tools */}
          <ToolsPanel
            toolsJson={toolsJson}
            error={toolsError}
            onChange={(v) => setConfig({ toolsJson: v })}
          />

          {/* Models */}
          <div className="rounded-2xl border border-border bg-surface/50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                <Layers className="size-4 text-cyan" /> Models
              </span>
              <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                <Coins className="size-3 text-amber" />
                {formatUSD(costPreview, { precise: true })}/run
              </span>
            </div>
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
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs text-muted-foreground hover:border-cyan hover:text-foreground disabled:opacity-50"
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
            </div>
          </div>

          <div className="flex gap-2">
            {running ? (
              <Button variant="danger" className="flex-1" onClick={stop}>
                <Square className="size-4" /> Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                className="flex-1"
                onClick={run}
                disabled={!canRun}
              >
                <Play className="size-4" /> Run
              </Button>
            )}
            <SaveToLibrary
              onSave={(title) => {
                const body = turns.find((t) => t.role === "user")?.content ?? "";
                addPrompt({
                  id: `pg-${Date.now().toString(36)}`,
                  title,
                  tags: ["playground"],
                  body,
                });
              }}
            />
          </div>
        </aside>

        {/* Runs */}
        <div className="min-w-0">
          {runError && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              <AlertCircle className="size-4" /> {runError}
            </div>
          )}
          {hasRuns ? (
            <div className={cn("grid gap-4", gridCols)}>
              {models.map((id) => {
                const col = cols[id];
                const m = getModelById(id);
                if (!col || !m) return null;
                return <RunColumn key={id} model={m} col={col} />;
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center">
              <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Compose a conversation, tune every parameter, then run it across
                models side by side. ⌘/Ctrl+Enter runs from any editor.
              </p>
            </div>
          )}
        </div>
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} config={config} />
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

// ── Run column ────────────────────────────────────────────────────────────────

function RunColumn({
  model,
  col,
}: {
  model: NonNullable<ReturnType<typeof getModelById>>;
  col: RunCol;
}) {
  const [copied, setCopied] = React.useState(false);
  const streaming = col.status === "streaming";
  const cost = messageCostUsd(model.id, col.promptTokens, col.completionTokens);

  return (
    <div className="flex min-h-[240px] flex-col rounded-2xl border border-border bg-surface/50">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{model.name}</span>
          {col.provider && (
            <Badge variant="outline" className="text-2xs">
              {col.provider}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {col.status === "done" && col.text && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(col.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              title="Copy output"
              className="text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          )}
          <StatusPill status={col.status} ms={col.ms} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
        {(col.reasoning || (streaming && !col.text && !col.error)) && (
          <ReasoningBlock
            text={col.reasoning}
            streaming={streaming && !col.text}
          />
        )}
        {col.toolCalls.map((t) => (
          <ToolCall key={t.id} call={t} />
        ))}
        {col.status === "error" && !col.text ? (
          <span className="flex items-start gap-2 text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {col.error}
          </span>
        ) : col.text ? (
          <Markdown streaming={streaming}>{col.text}</Markdown>
        ) : !col.reasoning && !col.toolCalls.length && streaming ? (
          <Dots />
        ) : null}
        {streaming && col.text && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-caret-blink bg-cyan align-text-bottom" />
        )}
      </div>

      {col.status === "done" && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
          {col.ttftMs != null && <span>TTFT {(col.ttftMs / 1000).toFixed(2)}s</span>}
          {col.ms != null && <span>{(col.ms / 1000).toFixed(1)}s</span>}
          {col.completionTokens != null && col.ttftMs != null && col.ms != null && col.ms - col.ttftMs > 50 && (
            <span>{(col.completionTokens / ((col.ms - col.ttftMs) / 1000)).toFixed(0)} tok/s</span>
          )}
          {col.completionTokens != null ? (
            <span>
              {col.promptTokens ?? "?"} in · {col.completionTokens} out
            </span>
          ) : (
            <span>~{Math.ceil(col.text.length / 4)} tokens</span>
          )}
          {cost > 0 && <span>{formatUsd(cost)}</span>}
          {col.finishReason && col.finishReason !== "stop" && (
            <span className="text-amber">finish: {col.finishReason}</span>
          )}
          {col.error && col.text && (
            <span className="text-danger">interrupted: {col.error}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Parameters panel ──────────────────────────────────────────────────────────

function ParamsPanel({
  params,
  onChange,
  onReset,
}: {
  params: import("@/lib/playground/types").PlaygroundParams;
  onChange: (p: Partial<import("@/lib/playground/types").PlaygroundParams>) => void;
  onReset: () => void;
}) {
  const [advanced, setAdvanced] = React.useState(false);
  const [stopDraft, setStopDraft] = React.useState("");

  function addStop() {
    const v = stopDraft.trim();
    if (!v || params.stop.includes(v) || params.stop.length >= 4) return;
    onChange({ stop: [...params.stop, v] });
    setStopDraft("");
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface/50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Settings2 className="size-4 text-cyan" /> Parameters
        </div>
        <button
          onClick={onReset}
          className="text-2xs text-muted-foreground hover:text-foreground"
        >
          Reset
        </button>
      </div>
      <ParamSlider
        icon={Thermometer}
        label="Temperature"
        value={params.temperature}
        display={params.temperature.toFixed(2)}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => onChange({ temperature: v })}
      />
      <ParamSlider
        label="Top-p"
        value={params.topP}
        display={params.topP.toFixed(2)}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => onChange({ topP: v })}
      />
      <ParamSlider
        label="Max tokens"
        value={params.maxTokens}
        display={String(params.maxTokens)}
        min={64}
        max={8192}
        step={64}
        onChange={(v) => onChange({ maxTokens: Math.round(v) })}
      />

      <button
        onClick={() => setAdvanced((v) => !v)}
        className="flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3.5 transition-transform", advanced && "rotate-90")}
        />
        Advanced
      </button>

      {advanced && (
        <div className="space-y-4 border-t border-border pt-3">
          <ParamSlider
            label="Top-k (0 = default)"
            value={params.topK}
            display={params.topK === 0 ? "off" : String(params.topK)}
            min={0}
            max={100}
            step={1}
            onChange={(v) => onChange({ topK: Math.round(v) })}
          />
          <ParamSlider
            label="Frequency penalty"
            value={params.frequencyPenalty}
            display={params.frequencyPenalty.toFixed(1)}
            min={-2}
            max={2}
            step={0.1}
            onChange={(v) => onChange({ frequencyPenalty: v })}
          />
          <ParamSlider
            label="Presence penalty"
            value={params.presencePenalty}
            display={params.presencePenalty.toFixed(1)}
            min={-2}
            max={2}
            step={0.1}
            onChange={(v) => onChange({ presencePenalty: v })}
          />

          {/* Stop sequences */}
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">
              Stop sequences (max 4)
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {params.stop.map((s) => (
                <Badge key={s} variant="outline" className="gap-1 font-mono">
                  {JSON.stringify(s)}
                  <button
                    onClick={() =>
                      onChange({ stop: params.stop.filter((x) => x !== s) })
                    }
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              {params.stop.length < 4 && (
                <input
                  value={stopDraft}
                  onChange={(e) => setStopDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addStop();
                    }
                  }}
                  onBlur={addStop}
                  placeholder="Add + Enter"
                  className="h-7 w-24 rounded-md border border-border bg-surface-2/50 px-2 text-xs outline-none focus:border-cyan/40"
                />
              )}
            </div>
          </div>

          {/* Seed */}
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">
              Seed (blank = random)
            </Label>
            <input
              value={params.seed}
              onChange={(e) =>
                onChange({ seed: e.target.value.replace(/[^0-9]/g, "") })
              }
              inputMode="numeric"
              placeholder="e.g. 42"
              className="h-8 w-full rounded-lg border border-border bg-surface-2/50 px-2.5 font-mono text-xs outline-none focus:border-cyan/40"
            />
          </div>

          {/* Reasoning effort */}
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">
              Reasoning effort
            </Label>
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-surface-2/60 p-0.5 text-xs">
              {(["off", "low", "medium", "high"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => onChange({ reasoningEffort: r })}
                  className={cn(
                    "rounded-md py-1 capitalize",
                    params.reasoningEffort === r && "bg-surface shadow-sm",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* JSON mode */}
          <label className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              JSON mode (response_format)
            </span>
            <Switch
              checked={params.jsonMode}
              onCheckedChange={(v) => onChange({ jsonMode: v })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ── Tools panel ───────────────────────────────────────────────────────────────

function ToolsPanel({
  toolsJson,
  error,
  onChange,
}: {
  toolsJson: string;
  error: string | null;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = React.useState(toolsJson.trim().length > 0);
  const active = toolsJson.trim().length > 0 && !error;

  return (
    <div className="rounded-2xl border border-border bg-surface/50 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-sm font-medium"
      >
        <Wrench className={cn("size-4", active ? "text-cyan" : "text-muted-foreground")} />
        Tools
        {active && (
          <Badge variant="outline" className="text-2xs">
            on
          </Badge>
        )}
        <ChevronRight
          className={cn(
            "ml-auto size-4 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <textarea
            value={toolsJson}
            onChange={(e) => onChange(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder='[{"type":"function","function":{"name":"…"}}]'
            className={cn(
              "w-full resize-y rounded-xl border bg-[#0b0d14] p-2.5 font-mono text-[12px] leading-relaxed outline-none",
              error ? "border-danger/50" : "border-border focus:border-cyan/40",
            )}
          />
          {error ? (
            <p className="text-2xs text-danger">{error}</p>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-2xs text-muted-foreground">
                OpenAI tools format. Calls render in each column.
              </p>
              {!toolsJson.trim() && (
                <button
                  onClick={() => onChange(EXAMPLE_TOOLS)}
                  className="text-2xs text-cyan hover:underline"
                >
                  Insert example
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Presets menu ──────────────────────────────────────────────────────────────

function PresetsMenu({
  presets,
  onApply,
  onSave,
  onDelete,
}: {
  presets: import("@/lib/playground/types").Preset[];
  onApply: (id: string) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          <BookmarkPlus className="size-4" /> Presets
          {presets.length > 0 && (
            <span className="rounded-full bg-surface-3 px-1.5 text-2xs tabular-nums">
              {presets.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="mb-2 flex gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                onSave(name);
                setName("");
              }
            }}
            placeholder="Save current as…"
            className="h-8 flex-1 rounded-lg border border-border bg-surface-2/50 px-2.5 text-xs outline-none focus:border-cyan/40"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!name.trim()}
            onClick={() => {
              onSave(name);
              setName("");
            }}
          >
            Save
          </Button>
        </div>
        {presets.length === 0 ? (
          <p className="px-1 py-3 text-center text-2xs text-muted-foreground">
            No presets yet — save the current setup above.
          </p>
        ) : (
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {presets.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-1 rounded-lg px-1 hover:bg-surface-2/60"
              >
                <button
                  onClick={() => {
                    onApply(p.id);
                    setOpen(false);
                  }}
                  className="min-w-0 flex-1 py-1.5 text-left"
                >
                  <span className="block truncate text-xs font-medium">{p.name}</span>
                  <span className="block text-2xs text-muted-foreground">
                    {p.config.models.length} model
                    {p.config.models.length === 1 ? "" : "s"} · {timeAgo(p.updatedAt)}
                  </span>
                </button>
                <button
                  onClick={() => onDelete(p.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  title="Delete preset"
                >
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-danger" />
                </button>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Save to prompt library ────────────────────────────────────────────────────

function SaveToLibrary({ onSave }: { onSave: (title: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" title="Save prompt to library">
          {saved ? <Check className="size-4 text-success" /> : <BookmarkPlus className="size-4" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="mb-1.5 px-1 text-2xs text-muted-foreground">
          Save the user prompt to Atlas Prompt library.
        </p>
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) {
                onSave(title.trim());
                setTitle("");
                setOpen(false);
                setSaved(true);
                setTimeout(() => setSaved(false), 1500);
              }
            }}
            placeholder="Prompt name…"
            className="h-8 flex-1 rounded-lg border border-border bg-surface-2/50 px-2.5 text-xs outline-none focus:border-cyan/40"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!title.trim()}
            onClick={() => {
              onSave(title.trim());
              setTitle("");
              setOpen(false);
              setSaved(true);
              setTimeout(() => setSaved(false), 1500);
            }}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Bits ──────────────────────────────────────────────────────────────────────

function StatusPill({ status, ms }: { status: Status; ms?: number }) {
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-success">
        <Check className="size-3.5" /> {ms ? `${(ms / 1000).toFixed(1)}s` : "done"}
      </span>
    );
  if (status === "error") return <AlertCircle className="size-4 text-danger" />;
  if (status === "streaming")
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-cyan">
        <span className="size-1.5 animate-pulse-dot rounded-full bg-cyan" /> streaming
      </span>
    );
  return null;
}

function Dots() {
  return (
    <div className="flex items-center gap-1">
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

function ParamSlider({
  icon: Icon,
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  icon?: React.ElementType;
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
        <Label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {Icon && <Icon className="size-3.5" />}
          {label}
        </Label>
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
