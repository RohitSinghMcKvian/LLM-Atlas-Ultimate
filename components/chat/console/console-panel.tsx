"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Loader2, Map as MapIcon, ScrollText, Search, Users } from "lucide-react";
import Link from "next/link";
import { atlasGraph } from "@/lib/graph/atlas-graph";
import { hrefFor, retrieveGraph, type RetrievedNode } from "@/lib/graph/retrieve";
import { summarize } from "@/lib/orchestra/trace";
import { useGraphStore } from "@/lib/store/graph-store";
import { formatUsd } from "@/lib/chat/cost";
import { EASE } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { AtlasMap } from "./atlas-map";
import { AgentLanes } from "./agent-lanes";
import { RunLog } from "./run-log";

/**
 * Map, Agents, Log - and the ledger that sits above all three.
 *
 * The ledger is always visible rather than living inside a tab, because it is
 * the disclosure surface for something that can spend money, and a cost meter
 * you have to go and find is not a disclosure. Same reasoning `RunPanel` gives
 * for putting its numbers first.
 *
 * The Map tab is useful with no run in flight, which is why it carries its own
 * search box: the graph is a standing map of the whole catalog, not only a
 * record of the last question. A tab that is empty until something happens
 * elsewhere teaches people not to open it.
 */

export type ConsoleTab = "map" | "agents" | "log";

const TABS: { id: ConsoleTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "map", label: "Map", icon: MapIcon },
  { id: "agents", label: "Agents", icon: Users },
  { id: "log", label: "Log", icon: ScrollText },
];

export function ConsolePanel({ className }: { className?: string }) {
  const [tab, setTab] = React.useState<ConsoleTab>("map");
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<RetrievedNode | null>(null);
  const reduced = usePrefersReducedMotion();

  const { query, context, run, publish } = useGraphStore();
  const stats = React.useMemo(() => (run ? summarize(run) : null), [run]);

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <Ledger
        nodes={context?.scope.nodes.length ?? 0}
        sources={stats?.sources ?? 0}
        agents={stats?.agents ?? 0}
        toolCalls={stats?.toolCalls ?? 0}
        spentUsd={stats?.spentUsd ?? 0}
        running={run?.status === "running"}
      />

      <div
        role="tablist"
        aria-label="Agent console"
        className="flex h-9 items-center gap-1 rounded-xl border border-border bg-surface-2/60 p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-2xs font-medium transition-colors duration-200",
              tab === t.id
                ? "border border-border-strong bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0, y: -4 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}
          >
            {tab === "map" && (
              <MapTab
                query={query}
                onSurvey={publish}
                activeId={activeId}
                onActive={setActiveId}
                selected={selected}
                onSelect={setSelected}
              />
            )}
            {tab === "agents" && <AgentLanes run={run} />}
            {tab === "log" && <RunLog run={run} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function MapTab({
  query,
  onSurvey,
  activeId,
  onActive,
  selected,
  onSelect,
}: {
  query: string;
  onSurvey: (q: string, ctx: ReturnType<typeof retrieveGraph>) => void;
  activeId: string | null;
  onActive: (id: string | null) => void;
  selected: RetrievedNode | null;
  onSelect: (n: RetrievedNode | null) => void;
}) {
  const context = useGraphStore((s) => s.context);
  const [draft, setDraft] = React.useState(query);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setDraft(query), [query]);

  const survey = React.useCallback(
    (q: string) => {
      const text = q.trim();
      if (!text) return;
      setBusy(true);
      // Deferred a frame so the pressed state paints before a synchronous walk
      // over a few thousand nodes. Cheap, and the difference between "instant"
      // and "did that button work".
      requestAnimationFrame(() => {
        try {
          onSurvey(text, retrieveGraph(atlasGraph(), text));
        } finally {
          setBusy(false);
        }
      });
    },
    [onSurvey],
  );

  const hovered = activeId
    ? context?.scope.nodes.find((n) => n.node.id === activeId) ?? null
    : null;
  const shown = hovered ?? selected;

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          survey(draft);
        }}
        className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-2/60 px-2.5 focus-within:border-action/50"
      >
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Survey the catalog"
          aria-label="Search the Atlas knowledge graph"
          className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        {busy && <Loader2 className="size-3.5 shrink-0 animate-spin text-action" aria-hidden />}
      </form>

      <AtlasMap
        context={context}
        activeId={activeId}
        onActive={onActive}
        onOpen={(n) => onSelect(n)}
      />

      {shown && (
        <div className="rounded-xl border border-border bg-surface/60 p-3 shadow-glow">
          <p className="text-xs font-medium text-foreground">{shown.node.label}</p>
          <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
            {shown.node.summary}
          </p>
          <Link
            href={hrefFor(shown.node)}
            className="mt-2 inline-flex items-center gap-1 text-2xs font-medium text-action hover:underline"
          >
            Open in Atlas
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        </div>
      )}

      {context?.scope.truncated && (
        <p className="px-1 text-2xs text-muted-foreground">
          The map is capped at the strongest connections. There is more here than is drawn.
        </p>
      )}
    </div>
  );
}

/**
 * Elapsed, spend, and what was actually consulted.
 *
 * Mono and tabular, because every one of these is meant to be compared against
 * the one above it - the convention `globals.css` sets for the whole product.
 */
function Ledger({
  nodes,
  sources,
  agents,
  toolCalls,
  spentUsd,
  running,
}: {
  nodes: number;
  sources: number;
  agents: number;
  toolCalls: number;
  spentUsd: number;
  running: boolean;
}) {
  const cells: { label: string; value: string }[] = [
    { label: "Facts", value: String(nodes) },
    { label: "Agents", value: String(agents) },
    { label: "Calls", value: String(toolCalls) },
    { label: "Sources", value: String(sources) },
    { label: "Spend", value: formatUsd(spentUsd) },
  ];

  return (
    <div className="flex items-stretch gap-px overflow-hidden rounded-xl border border-border bg-border">
      {cells.map((c) => (
        <div key={c.label} className="flex-1 bg-surface px-2 py-1.5">
          <p className="font-mono text-2xs uppercase tracking-legend text-muted-foreground">
            {c.label}
          </p>
          <p className="font-mono text-xs tabular-nums text-foreground">{c.value}</p>
        </div>
      ))}
      {running && (
        <div className="flex items-center bg-surface px-2">
          <span className="size-1.5 animate-pulse-dot rounded-full bg-action" aria-hidden />
          <span className="sr-only">Running</span>
        </div>
      )}
    </div>
  );
}
