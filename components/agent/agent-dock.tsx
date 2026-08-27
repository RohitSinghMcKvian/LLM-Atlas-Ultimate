"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, MessagesSquare, Square, X } from "lucide-react";
import { AtlasMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { ConsolePanel } from "@/components/chat/console/console-panel";
import { atlasGraph } from "@/lib/graph/atlas-graph";
import { runSessionTurn, type SessionTurn } from "@/lib/orchestra/session";
import { describeSurface, useSurfaceStore } from "@/lib/agent/surface-context";
import { useGraphStore } from "@/lib/store/graph-store";
import { getOpenrouterKey } from "@/lib/store/keys-store";
import { useUIStore } from "@/lib/store/ui-store";
import { springSnappy } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * Ask Atlas, from anywhere.
 *
 * The questions this answers - "is this one worth it", "what does that cost",
 * "what changed" - arise while looking at the leaderboard or the cost page, and
 * routing to `/chat` to ask them loses the thing that prompted the question.
 *
 * It does not mount `ChatClient`. The turn is `lib/orchestra/session.ts`, built
 * from the same `runToolLoop` and `executeTool` the chat page uses; a panel that
 * mounted a 3,948-line component with a conversation tree and an artifact
 * workspace inside it would be a second chat page, not a panel.
 *
 * ### The panel does not own its trigger
 *
 * The trigger is `components/agent/agent-rail.tsx`, mounted separately by
 * `agent-dock-mount.tsx`, and the split is the whole point: this file pulls in
 * the knowledge graph, the markdown renderer and framer-motion, so if the
 * button lived here every route would either pay for that bundle up front or
 * show no button until it finished downloading. The rail is a few hundred bytes
 * of CSS-animated markup and renders instantly; this arrives on first open and
 * then stays mounted, which is also what keeps the transcript alive across a
 * close.
 */

const PANEL_WIDTH = 400;

export function AgentDock({
  open,
  onClose,
  panelId,
}: {
  open: boolean;
  onClose: () => void;
  panelId: string;
}) {
  const [input, setInput] = React.useState("");
  const [turns, setTurns] = React.useState<SessionTurn[]>([]);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const reduced = usePrefersReducedMotion();

  const pathname = usePathname();
  const router = useRouter();
  const surface = useSurfaceStore((s) => s.context);
  const publishGraph = useGraphStore((s) => s.publish);
  const setRun = useGraphStore((s) => s.setRun);
  const modelId = useUIStore((s) => s.activeModelId);

  // ⌘J and Escape live in `agent-dock-mount.tsx`, not here: this component does
  // not exist until the panel has been opened once, and a shortcut that only
  // works after you have already used the thing it opens is not a shortcut.

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const send = React.useCallback(async () => {
    const question = input.trim();
    if (!question || streaming) return;
    setInput("");
    setError(null);
    setStreaming(true);
    setTurns((t) => [...t, { role: "user", content: question }, { role: "assistant", content: "" }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // Coalesced like the chat page's own stream: patching per token would
    // re-render the panel a few hundred times for one answer.
    //
    // `onDelta` hands back the *whole* answer accumulated so far on every
    // call - `lib/chat/tool-loop.ts` documents `onText` as exactly that - so
    // `buffer` is replaced, not appended to. Found live: appending turned
    // every reply into a quadratically duplicated wall of repeated text from
    // the second streamed chunk onward, in every dock answer.
    let buffer = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const text = buffer;
      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = { role: "assistant", content: text };
        return next;
      });
    };

    try {
      await runSessionTurn(
        {
          modelId,
          question,
          history: turns,
          surface: describeSurface(surface, pathname ?? undefined),
          openRouterKey: getOpenrouterKey() || undefined,
          atlas: { graph: () => atlasGraph() },
          signal: ctrl.signal,
        },
        {
          onDelta: (text) => {
            buffer = text;
            if (!timer) timer = setTimeout(flush, 48);
          },
          onGraph: (ctx) => publishGraph(question, ctx),
          onRun: (run) => setRun(run),
          onApproval: ({ name, title }) =>
            window.confirm(
              `Atlas wants to use "${title}" (${name}), which can write or spend. Allow it?`,
            ),
          onError: (message) => setError(message),
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through.");
    } finally {
      if (timer) clearTimeout(timer);
      flush();
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, modelId, turns, surface, pathname, publishGraph, setRun]);

  /**
   * Hand off to the full chat page.
   *
   * Navigation only, deliberately. Carrying the panel's transcript across needs
   * `ChatClient` to read a handoff on mount, and that file is the one place this
   * change does not touch - writing a payload nothing reads would be dead code
   * pretending to be a feature. The transcript stays in the panel, which is
   * still open when they come back.
   */
  const openChat = React.useCallback(() => {
    onClose();
    router.push("/chat");
  }, [router, onClose]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            key="agent-dock"
            id={panelId}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
            transition={reduced ? { duration: 0 } : springSnappy}
            style={{ width: PANEL_WIDTH }}
            className={cn(
              "fixed inset-y-0 right-0 z-40 flex max-w-[92vw] flex-col border-l border-border",
              "bg-surface/95 backdrop-blur-lg shadow-float",
            )}
            aria-label="Ask Atlas"
          >
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
              <span className="flex items-center gap-2">
                {/* The same mark the rail carries, so opening the panel reads as
                    the marker unfolding rather than as a different product. */}
                <AtlasMark size={20} bare />
                <span className="font-display text-sm font-semibold">Ask Atlas</span>
              </span>
              <span className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" onClick={openChat} title="Open Chat">
                  <MessagesSquare className="size-4" />
                  <span className="sr-only">Open Chat</span>
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
                  <X className="size-4" />
                  <span className="sr-only">Close</span>
                </Button>
              </span>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {turns.length === 0 && <DockEmpty pathname={pathname ?? ""} />}

              {turns.map((t, i) =>
                t.role === "user" ? (
                  <p
                    key={i}
                    className="ml-auto w-fit max-w-[85%] rounded-2xl bg-surface-3 px-3 py-1.5 text-xs"
                  >
                    {t.content}
                  </p>
                ) : (
                  <div key={i} className="prose-atlas text-body">
                    {t.content ? (
                      <Markdown streaming={streaming && i === turns.length - 1}>{t.content}</Markdown>
                    ) : (
                      <span className="inline-block h-4 w-1.5 animate-caret-blink bg-action align-middle" />
                    )}
                  </div>
                ),
              )}

              {error && (
                <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-2 text-2xs text-danger">
                  {error}
                </p>
              )}

              <ConsolePanel />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="shrink-0 border-t border-border p-2.5"
            >
              <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-surface/60 p-1.5 shadow-glow focus-within:border-action/40">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder="Ask about what you're looking at"
                  aria-label="Ask Atlas"
                  className="max-h-32 min-h-[2rem] flex-1 resize-none bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground"
                />
                {streaming ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="secondary"
                    onClick={() => abortRef.current?.abort()}
                    title="Stop"
                  >
                    <Square className="size-3.5" />
                    <span className="sr-only">Stop</span>
                  </Button>
                ) : (
                  <Button type="submit" size="icon-sm" variant="primary" disabled={!input.trim()}>
                    <ArrowUp className="size-3.5" />
                    <span className="sr-only">Send</span>
                  </Button>
                )}
              </div>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function DockEmpty({ pathname }: { pathname: string }) {
  const here = describeSurface(null, pathname);
  return (
    <div className="rounded-2xl border border-border bg-surface/40 p-4">
      <p className="text-xs text-foreground">Ask about anything in Atlas.</p>
      <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
        Answers come from the catalog, the cost engine and the knowledge graph, with the facts they
        rest on mapped below.
        {here ? ` Right now you're on ${here}.` : ""}
      </p>
    </div>
  );
}
