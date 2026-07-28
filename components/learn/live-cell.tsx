"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Play, Square, RotateCcw, ArrowUpRight, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderBanner } from "@/components/provider-banner";
import { getModelById } from "@/lib/catalog";
import { useUIStore } from "@/lib/store/ui-store";
import { useKeysStore } from "@/lib/store/keys-store";
import { useProviders } from "@/lib/hooks/use-providers";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { useCatalogSnapshot } from "@/lib/hooks/use-catalog-snapshot";
import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { announce } from "@/lib/atlas-events";

// Model output is arbitrary markdown — tables, KaTeX, mermaid, highlighted code
// — so it needs the real renderer. Loading it on demand keeps ~280 kB of
// markdown machinery out of the lesson's initial bundle; by the time a stream
// has produced its first token the chunk has long since arrived.
const Markdown = dynamic(
  () => import("@/components/markdown").then((m) => m.Markdown),
  {
    loading: () => (
      <span className="text-muted-foreground">rendering…</span>
    ),
  },
);

interface RouterSseEvent {
  type: string;
  text?: string;
  message?: string;
  code?: string;
}

const DEFAULT_SYSTEM =
  "You are a precise, friendly LLM tutor. Be concise and concrete.";

/**
 * The "run this live" cell.
 *
 * The lesson's claim is that the concept it just described is observable, so
 * the prompt is editable — a cell that only replays a canned answer would make
 * the opposite point. It streams through the same Atlas Router every other
 * module uses, on whatever model the topbar has selected.
 */
export function LiveCell({
  prompt,
  note,
  system,
}: {
  prompt: string;
  note: string;
  system?: string;
}) {
  const providers = useProviders();
  const keyHeaders = useUserKeyHeaders();
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const activeModelId = useUIStore((s) => s.activeModelId);
  const snapshot = useCatalogSnapshot();

  const [text, setText] = React.useState(prompt);
  const [out, setOut] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "run" | "done" | "error">(
    "idle",
  );
  const [err, setErr] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const model = React.useMemo(
    () => (activeModelId ? getModelById(activeModelId) : undefined),
    // The catalog is a swappable snapshot; re-resolve when it changes.
    [activeModelId, snapshot],
  );

  // A stream in flight when the lesson changes would keep writing into an
  // unmounted cell's state.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  async function run() {
    if (!activeModelId) {
      setErr("Select a model in the top bar first.");
      setStatus("error");
      return;
    }
    abortRef.current?.abort();
    setStatus("run");
    setOut("");
    setErr(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      for await (const ev of postSSE<RouterSseEvent>(
        "/api/v1/router/chat",
        {
          modelId: activeModelId,
          messages: [
            { role: "system", content: system ?? DEFAULT_SYSTEM },
            { role: "user", content: text },
          ],
          temperature: 0.6,
        },
        ctrl.signal,
        keyHeaders,
      )) {
        if (ev.type === "delta" && ev.text) {
          setOut((o) => o + ev.text);
        } else if (ev.type === "error") {
          if (ev.code === "key_required") setKeyModalOpen(true);
          setErr(ev.message ?? "The model returned an error.");
          setStatus("error");
        }
      }
      setStatus((s) => (s === "error" ? s : "done"));
      announce("Lesson example finished streaming.");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      if (e instanceof SSEHttpError) {
        if (e.code === "key_required" || e.status === 402) setKeyModalOpen(true);
        setErr(e.message);
      } else {
        setErr((e as Error).message);
      }
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  const dirty = text !== prompt;

  return (
    <div className="not-prose overflow-hidden rounded-2xl border border-violet/30 bg-surface/60 shadow-glow">
      <div className="flex items-center gap-2 border-b border-border bg-violet/[0.07] px-3.5 py-2.5">
        <span className="grid size-5 place-items-center rounded bg-gradient-primary text-primary-foreground">
          <Terminal className="size-3" />
        </span>
        <span className="text-xs font-semibold">Run this live</span>
        <span className="ml-auto truncate font-mono text-2xs text-muted-foreground">
          {model?.name ?? "no model selected"}
        </span>
      </div>

      <div className="p-3.5">
        {!providers.loading && !providers.any && (
          <div className="mb-3">
            <ProviderBanner />
          </div>
        )}

        <label htmlFor={`live-${prompt.slice(0, 12)}`} className="sr-only">
          Prompt to run
        </label>
        <textarea
          id={`live-${prompt.slice(0, 12)}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full resize-y rounded-lg border border-border bg-surface-2/50 p-2.5 text-sm leading-relaxed outline-none transition-colors focus:border-cyan/50"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {status === "run" ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                abortRef.current?.abort();
                setStatus("idle");
              }}
            >
              <Square className="size-3.5" /> Stop
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={run}>
              <Play className="size-3.5" /> Run
            </Button>
          )}
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => setText(prompt)}>
              <RotateCcw className="size-3.5" /> Reset prompt
            </Button>
          )}
          <Link
            href={`/playground?prompt=${encodeURIComponent(text)}`}
            className="ml-auto inline-flex items-center gap-0.5 text-2xs text-muted-foreground hover:text-cyan"
          >
            Open in Playground <ArrowUpRight className="size-3" />
          </Link>
        </div>

        <p className="mt-1.5 text-2xs text-muted-foreground">{note}</p>

        {(out || status === "run" || err) && (
          <div className="mt-3 rounded-lg border border-border bg-[rgb(var(--surface-2))] p-3 text-sm">
            {err ? (
              <p className="text-danger">{err}</p>
            ) : out ? (
              <div className="prose prose-sm max-w-none dark:prose-invert prose-p:text-foreground/90">
                <Markdown>{out}</Markdown>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-muted-foreground">
                <span className="size-1.5 animate-pulse-dot rounded-full bg-cyan" />
                thinking…
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
