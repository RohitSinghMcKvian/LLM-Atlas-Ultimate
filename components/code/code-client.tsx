"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  FileDiff,
  X,
  Dot,
  Save,
  Loader2,
  Globe,
  ExternalLink,
  RotateCw,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { CodeEditor } from "@/components/code/editor";
import { FileTree } from "@/components/code/file-tree";
import { Terminal } from "@/components/code/terminal";
import { AgentPanel } from "@/components/code/agent-panel";
import { ChangesView } from "@/components/code/changes-view";
import { Button } from "@/components/ui/button";
import { ResizeHandle } from "@/components/ui/resizable";
import { useShallow } from "zustand/react/shallow";
import { useCodeStore } from "@/lib/store/code-store";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { useMediaQueryLayout } from "@/lib/hooks/use-media-query";
import { useResizableSurface, type PanelSpec } from "@/lib/hooks/use-panel-resize";
import { CODE_AGENT, CODE_CENTER_MIN, CODE_EDITOR_MIN, CODE_EXPLORER, CODE_TERMINAL } from "@/lib/panels";
import { cn } from "@/lib/utils";
import { popEscalation } from "@/lib/chat/escalate";

const LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", mjs: "javascript",
  cjs: "javascript", jsx: "javascript", json: "json", md: "markdown",
  py: "python", css: "css", html: "html", htm: "html", yml: "yaml",
  yaml: "yaml", svg: "xml", xml: "xml", sh: "shell", txt: "plaintext",
};

function langFor(path: string | null): string {
  if (!path) return "plaintext";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANG[ext] ?? "plaintext";
}

/**
 * COOP/COEP only apply on a full document load, so arriving at /code via
 * client-side navigation leaves the page without cross-origin isolation and
 * WebContainer can't start. One hard reload (guarded so it can't loop) picks
 * the headers up.
 */
function useCrossOriginIsolationReload(): boolean {
  const [decided, setDecided] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const KEY = "atlas-coi-reload";
    if (crossOriginIsolated) {
      sessionStorage.removeItem(KEY);
      setDecided(true);
      return;
    }
    if (!sessionStorage.getItem(KEY)) {
      sessionStorage.setItem(KEY, "1");
      window.location.reload();
      return; // reloading — leave decided=false so we don't boot twice
    }
    // Reloaded once and still not isolated (unsupported browser/env) —
    // proceed; the workspace falls back to the in-memory FS.
    setDecided(true);
  }, []);
  return decided;
}

export function CodeClient() {
  const keyHeaders = useUserKeyHeaders();

  // Selected field-by-field rather than `useCodeStore()`. The store also holds
  // the agent `trace`/`events`, which are re-projected every 48ms during a run
  // — subscribing to the whole store meant every agent token re-rendered the
  // Monaco editor, the file tree and the terminal. Actions have stable
  // identities, so useShallow over them never fires.
  const status = useCodeStore((s) => s.status);
  const bootNote = useCodeStore((s) => s.bootNote);
  const wsKind = useCodeStore((s) => s.wsKind);
  const paths = useCodeStore((s) => s.paths);
  const changedMap = useCodeStore((s) => s.changedMap);
  const activePath = useCodeStore((s) => s.activePath);
  const buffer = useCodeStore((s) => s.buffer);
  const savedBuffer = useCodeStore((s) => s.savedBuffer);
  const terminalLines = useCodeStore((s) => s.terminal);
  const changes = useCodeStore((s) => s.changes);
  const running = useCodeStore((s) => s.running);
  const previewUrl = useCodeStore((s) => s.previewUrl);
  const {
    dismissPreview,
    boot,
    selectFile,
    setBuffer,
    saveActiveFile,
    runManualCommand,
    clearTerminal,
    revertChange,
  } = useCodeStore(
    useShallow((s) => ({
      dismissPreview: s.dismissPreview,
      boot: s.boot,
      selectFile: s.selectFile,
      setBuffer: s.setBuffer,
      saveActiveFile: s.saveActiveFile,
      runManualCommand: s.runManualCommand,
      clearTerminal: s.clearTerminal,
      revertChange: s.revertChange,
    })),
  );

  const [view, setView] = React.useState<"editor" | "changes" | "preview">("editor");
  const [previewNonce, setPreviewNonce] = React.useState(0);
  const [agentOpen, setAgentOpen] = React.useState(false);
  const isolationDecided = useCrossOriginIsolationReload();

  // ── Resizable frames ────────────────────────────────────────────────────────
  const rootRef = React.useRef<HTMLDivElement>(null);
  const centerRef = React.useRef<HTMLDivElement>(null);
  const explorerToggleRef = React.useRef<HTMLButtonElement>(null);
  const agentToggleRef = React.useRef<HTMLButtonElement>(null);

  // Layout-effect media queries: these decide *sizes*, and the post-paint
  // variant would show one frame with a hidden panel still holding its share of
  // the width budget — visibly wrong at 1024px, where the agent is off-screen.
  const explorerVisible = useMediaQueryLayout("(min-width: 768px)");
  const agentVisible = useMediaQueryLayout("(min-width: 1280px)");

  const specs = React.useMemo<PanelSpec[]>(
    () => [
      {
        key: "codeExplorer",
        cssVar: "--atlas-code-explorer",
        constraints: CODE_EXPLORER,
        axis: "x",
        anchoredRight: false,
        centerMin: CODE_CENTER_MIN,
        label: "File explorer",
        active: explorerVisible,
        toggleRef: explorerToggleRef,
      },
      {
        key: "codeAgent",
        cssVar: "--atlas-code-agent",
        constraints: CODE_AGENT,
        axis: "x",
        anchoredRight: true,
        centerMin: CODE_CENTER_MIN,
        label: "Agent panel",
        active: agentVisible,
        toggleRef: agentToggleRef,
      },
      {
        key: "codeTerminal",
        cssVar: "--atlas-code-terminal",
        constraints: CODE_TERMINAL,
        axis: "y",
        anchoredRight: true,
        centerMin: CODE_EDITOR_MIN,
        label: "Terminal",
        // The center column, never the viewport: on mobile the root carries
        // `pb-16` for the tab bar, so the two differ by 64px.
        containerRef: centerRef,
      },
    ],
    [explorerVisible, agentVisible],
  );

  const panels = useResizableSurface(rootRef, specs);
  const explorer = panels.codeExplorer;
  const agent = panels.codeAgent;
  const terminal = panels.codeTerminal;

  const ingestEscalation = useCodeStore((s) => s.ingestEscalation);
  const escalationHandled = React.useRef(false);

  React.useEffect(() => {
    if (isolationDecided) boot();
  }, [isolationDecided, boot]);

  React.useEffect(() => {
    if (status !== "ready" && status !== "fallback") return;
    if (escalationHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("escalation")) return;
    escalationHandled.current = true;
    const payload = popEscalation();
    if (payload) {
      setAgentOpen(true);
      ingestEscalation(payload, keyHeaders);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [status, ingestEscalation, keyHeaders]);

  // A dev server coming up inside the workspace opens the preview pane.
  const prevPreview = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (previewUrl && previewUrl !== prevPreview.current) setView("preview");
    if (!previewUrl && view === "preview") setView("editor");
    prevPreview.current = previewUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);

  // Ctrl/Cmd+S saves the active editor buffer to the workspace.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActiveFile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActiveFile]);

  // Panel toggles. Registered in the capture phase and stopped there, unlike
  // the Ctrl+S handler above: Monaco owns several of these chords on its hidden
  // textarea, and a bubble-phase listener is one keybinding change away from
  // silently losing the event.
  const togglesRef = React.useRef({ explorer, terminal, agent });
  togglesRef.current = { explorer, terminal, agent };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const t = togglesRef.current;
      const key = e.key.toLowerCase();
      const target = key === "b" ? t.explorer : key === "j" ? t.terminal : key === "i" ? t.agent : null;
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      target.toggle();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  const dirty = buffer !== savedBuffer;
  const fileName = activePath?.split("/").pop() ?? "—";

  const agentPanel = <AgentPanel keyHeaders={keyHeaders} />;

  return (
    <div
      ref={rootRef}
      className="-mb-24 flex h-[calc(100dvh-4rem)] overflow-hidden pb-16 lg:mb-0 lg:pb-0"
    >
      {/* File tree. The width lives in a CSS var so a drag can update it
          without re-rendering this tree, Monaco and the agent timeline; the
          fallback is the 13rem it used to be hardcoded to. The right border is
          the resize handle's line, not the aside's. */}
      <aside
        id={explorer.id}
        data-collapsed={explorer.collapsed}
        className="atlas-panel hidden w-[var(--atlas-code-explorer,13rem)] shrink-0 flex-col overflow-hidden bg-surface/40 md:flex"
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          {status === "booting" || status === "idle" ? (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> booting…
            </div>
          ) : (
            <FileTree
              paths={paths}
              activePath={activePath ?? ""}
              changed={changedMap}
              onSelect={(p) => {
                setView("editor");
                selectFile(p);
              }}
            />
          )}
        </div>
        {status === "fallback" && (
          <div className="border-t border-border p-2 text-2xs text-amber" title={bootNote}>
            Limited mode: in-memory FS, no shell. Python still works.
          </div>
        )}
      </aside>
      <ResizeHandle
        {...explorer.handleProps}
        orientation="vertical"
        className="hidden md:block"
      />

      {/* Editor + terminal */}
      <div ref={centerRef} className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 items-center gap-2 border-b border-border bg-surface/30 px-3">
          {/* Mirrors the panel's physical position — that is the whole point of
              the affordance, and it is the only way back from a collapsed rail
              for anyone who does not know about Ctrl+B. */}
          <Button
            ref={explorerToggleRef}
            variant="ghost"
            size="icon-sm"
            className="-ml-1 hidden shrink-0 md:inline-flex"
            aria-expanded={!explorer.collapsed}
            aria-controls={explorer.id}
            title={explorer.collapsed ? "Show explorer (Ctrl+B)" : "Hide explorer (Ctrl+B)"}
            onClick={explorer.toggle}
          >
            {explorer.collapsed ? (
              <PanelLeft className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
          <div className="flex items-center gap-1.5 rounded-t-lg border-x border-t border-border bg-code px-3 py-1.5 text-xs">
            <span className="font-mono">{fileName}</span>
            {dirty && <Dot className="size-4 text-amber" />}
          </div>
          <span className="hidden truncate font-mono text-2xs text-muted-foreground sm:inline">
            {activePath ?? ""}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {dirty && (
              <Button variant="ghost" size="sm" onClick={saveActiveFile} title="Save (Ctrl+S)">
                <Save className="size-4" /> Save
              </Button>
            )}
            {previewUrl && (
              <Button
                variant={view === "preview" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView(view === "preview" ? "editor" : "preview")}
                title="Dev server preview"
              >
                <Globe className="size-4" />
                Preview
              </Button>
            )}
            <Button
              variant={view === "changes" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView(view === "changes" ? "editor" : "changes")}
            >
              <FileDiff className="size-4" />
              {view === "changes" ? "Editor" : "Changes"}
              {view !== "changes" && changes.length > 0 && (
                <span className="rounded-full bg-surface-3 px-1.5 text-2xs tabular-nums">
                  {changes.length}
                </span>
              )}
            </Button>
            <Button
              ref={agentToggleRef}
              variant="ghost"
              size="icon-sm"
              className="hidden shrink-0 xl:inline-flex"
              aria-expanded={!agent.collapsed}
              aria-controls={agent.id}
              title={agent.collapsed ? "Show agent (Ctrl+I)" : "Hide agent (Ctrl+I)"}
              onClick={agent.toggle}
            >
              {agent.collapsed ? (
                <PanelRight className="size-4" />
              ) : (
                <PanelRightClose className="size-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {view === "preview" && previewUrl ? (
            <div className="flex h-full flex-col bg-code">
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
                <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
                  {previewUrl}
                </span>
                <button
                  title="Reload preview"
                  aria-label="Reload preview"
                  onClick={() => setPreviewNonce((n) => n + 1)}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <RotateCw className="size-3.5" />
                </button>
                <a
                  title="Open in new tab"
                  aria-label="Open preview in new tab"
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" />
                </a>
                <button
                  title="Close preview"
                  aria-label="Close preview"
                  onClick={() => {
                    dismissPreview();
                    setView("editor");
                  }}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <iframe
                key={previewNonce}
                src={previewUrl}
                title="Dev server preview"
                className="min-h-0 flex-1 border-0 bg-white"
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                allow="cross-origin-isolated"
              />
            </div>
          ) : view === "changes" ? (
            <ChangesView changes={changes} onRevert={revertChange} reverting={running} />
          ) : activePath ? (
            <CodeEditor
              path={activePath}
              value={buffer}
              language={langFor(activePath)}
              onChange={setBuffer}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-code text-xs text-muted-foreground">
              {status === "booting" ? "Starting workspace…" : "Select a file"}
            </div>
          )}
        </div>

        {/* Occupies layout rather than overlaying: a hit area hanging over the
            editor's bottom edge would land on Monaco's 8px horizontal
            scrollbar and steal the drag. */}
        <ResizeHandle {...terminal.handleProps} orientation="horizontal" inline />
        {/* Collapses to the terminal's h-8 header, VS Code style, so clicking
            the header is always a way back — hence no `data-collapsed` here. */}
        <div
          id={terminal.id}
          className="atlas-panel h-[var(--atlas-code-terminal,11rem)] shrink-0 overflow-hidden"
        >
          <Terminal
            lines={terminalLines}
            active={running}
            runtimeLabel={
              wsKind === "webcontainer"
                ? "jsh · node · python (pyodide)"
                : wsKind === "memory"
                  ? "limited · python only"
                  : "booting…"
            }
            onCommand={runManualCommand}
            onClear={clearTerminal}
            collapsed={terminal.collapsed}
            onToggleCollapsed={terminal.toggle}
          />
        </div>
      </div>

      <ResizeHandle {...agent.handleProps} orientation="vertical" className="hidden xl:block" />
      {/* Agent panel (desktop) */}
      <aside
        id={agent.id}
        data-collapsed={agent.collapsed}
        className="atlas-panel hidden w-[var(--atlas-code-agent,400px)] shrink-0 overflow-hidden xl:flex"
      >
        {/* `hidden xl:flex` is display:none, which still mounts — so below xl
            this has to render nothing or the sheet below would be a duplicate. */}
        {agentVisible && agentPanel}
      </aside>

      {/* Agent FAB (smaller screens) */}
      <button
        onClick={() => setAgentOpen(true)}
        className="fixed bottom-24 right-4 z-30 inline-flex items-center gap-2 rounded-2xl bg-action px-4 py-3 text-sm font-medium text-action-foreground shadow-glow xl:hidden"
      >
        <Brain className="size-4" /> Agent
        {running && <span className="size-1.5 animate-pulse-dot rounded-full bg-white" />}
      </button>

      {/* Agent sheet. Gated on the breakpoint, not just `agentOpen`: the
          escalation handler above calls setAgentOpen(true) unconditionally, so
          on desktop this used to mount a *second* AgentPanel — with its own
          store subscription and its own trace render — behind an xl:hidden
          overlay nobody could see. */}
      <AnimatePresence>
        {agentOpen && !agentVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 xl:hidden"
          >
            <div
              className="absolute inset-0 bg-background/60 backdrop-blur-sm"
              onClick={() => setAgentOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute inset-y-0 right-0 w-[90%] max-w-md border-l border-border bg-surface md:max-w-lg"
            >
              <button
                onClick={() => setAgentOpen(false)}
                className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-lg border border-border bg-surface-2 text-muted-foreground"
              >
                <X className="size-4" />
              </button>
              {agentPanel}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
