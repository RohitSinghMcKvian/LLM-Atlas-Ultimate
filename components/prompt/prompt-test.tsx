"use client";

import * as React from "react";
import { AlertCircle, Coins, Play, Square, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { ModelPicker } from "@/components/catalog/model-picker";
import { getModelById } from "@/lib/catalog";
import { firstPickable } from "@/lib/catalog/picker";
import { modelAvailability } from "@/lib/catalog/availability";
import { defaultChatModel } from "@/lib/catalog/defaults";
import { useCatalogSnapshot } from "@/lib/hooks/use-catalog-snapshot";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { useKeysStore } from "@/lib/store/keys-store";
import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { formatUsd } from "@/lib/chat/cost";

// Run the prompt you are editing, here.
//
// Atlas Prompt was the one live module with no model integration at all: you
// could write a prompt, version it, and fill in its variables, and the only way
// to find out whether it worked was a link that threw the rendered text over the
// wall into Playground. For a prompt *library* that is the wrong default — the
// loop you are in is "tweak the wording, see what changes", and it should not
// cost a navigation.
//
// Deliberately one model and one turn. Multi-model fan-out is what Playground is
// for, and the link to it stays.

export function PromptTest({ rendered }: { rendered: string }) {
  const snapshot = useCatalogSnapshot();
  const env = useRouteEnv();
  const keyHeaders = useUserKeyHeaders();
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);

  const [modelId, setModelId] = React.useState("");
  const [output, setOutput] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const [stats, setStats] = React.useState<{ ms: number; costUsd?: number } | null>(null);
  const abort = React.useRef<AbortController | null>(null);

  // Default to something this deployment can actually serve, and re-check when
  // the catalog resyncs — the daily sync can retire whatever was chosen.
  React.useEffect(() => {
    const next = firstPickable(env, [modelId, defaultChatModel()].filter(Boolean));
    if (next && next !== modelId) setModelId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, snapshot]);

  React.useEffect(() => () => abort.current?.abort(), []);

  const model = modelId ? getModelById(modelId) : undefined;
  const canRun = rendered.trim().length > 0 && Boolean(model) && !running;

  async function run() {
    if (!canRun || !model) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    setOutput("");
    setError(null);
    setStats(null);

    const t0 = performance.now();
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      for await (const ev of postSSE<{
        type: string;
        text?: string;
        message?: string;
        code?: string;
        promptTokens?: number;
        completionTokens?: number;
      }>(
        "/api/v1/router/chat",
        { modelId, messages: [{ role: "user", content: rendered }], maxTokens: 800 },
        ctrl.signal,
        keyHeaders,
      )) {
        if (ev.type === "delta" && ev.text) setOutput((o) => o + ev.text);
        else if (ev.type === "usage") {
          promptTokens = ev.promptTokens ?? 0;
          completionTokens = ev.completionTokens ?? 0;
        } else if (ev.type === "error") {
          if (ev.code === "key_required") setKeyModalOpen(true);
          setError(ev.message ?? "The model returned an error.");
          return;
        }
      }
      // Priced against availability, not against the catalog's list price. A
      // free route costs the user nothing even when the model has a real
      // $/Mtok — reporting the list price there would put a charge on the one
      // thing the product promises is free.
      const free = env ? modelAvailability(model, env).kind === "free" : false;
      setStats({
        ms: Math.round(performance.now() - t0),
        costUsd: free
          ? 0
          : promptTokens || completionTokens
            ? (promptTokens / 1_000_000) * model.pricing.inputPerM +
              (completionTokens / 1_000_000) * model.pricing.outputPerM
            : undefined,
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (e instanceof SSEHttpError && (e.code === "key_required" || e.status === 402)) {
        setKeyModalOpen(true);
      }
      setError(e instanceof Error ? e.message : "The run failed.");
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Play className="size-4 text-action" /> Test
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ModelPicker
            value={modelId}
            onChange={setModelId}
            disabled={running}
            align="end"
            className="max-w-[12rem]"
          />
          {running ? (
            <Button variant="danger" size="sm" onClick={() => abort.current?.abort()}>
              <Square className="size-4" /> Stop
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={run} disabled={!canRun}>
              <Play className="size-4" /> Run
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {output ? (
        <>
          <div className="max-h-96 overflow-y-auto rounded-xl border border-border bg-surface-2/40 p-3">
            <Markdown streaming={running}>{output}</Markdown>
          </div>
          {stats && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Zap className="size-3" aria-hidden />
                {stats.ms}ms
              </span>
              <span className="inline-flex items-center gap-1">
                <Coins className="size-3 text-amber" aria-hidden />
                {stats.costUsd === undefined
                  ? "cost unknown"
                  : stats.costUsd === 0
                    ? "free"
                    : formatUsd(stats.costUsd)}
              </span>
            </div>
          )}
        </>
      ) : (
        !error && (
          <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            {running
              ? "Running…"
              : "Run the rendered prompt above against one model, without leaving the page."}
          </p>
        )
      )}
    </Card>
  );
}
