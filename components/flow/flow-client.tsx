"use client";

import * as React from "react";
import { defaultFlowModel } from "@/lib/catalog/defaults";
import { AnimatePresence, motion } from "framer-motion";
import {
  Play,
  Square,
  Plus,
  RotateCcw,
  Download,
  Trash2,
  Check,
  Loader2,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  SEED_NODES,
  SEED_EDGES,
  KIND_META,
  PALETTE,
  NODE_W,
  NODE_H,
  computeLayers,
  type FlowNode,
  type FlowEdge,
  type NodeKind,
} from "@/lib/flow/graph";
import { routableModels, getModelById } from "@/lib/catalog";
import { ACCENT_RGB } from "@/lib/accent";
import { cn } from "@/lib/utils";

const ACCENT_HEX = {
  ...ACCENT_RGB,
  success: "rgb(var(--success))",
};

type RunStatus = "idle" | "running" | "done";

export function FlowClient() {
  const [nodes, setNodes] = React.useState<FlowNode[]>(SEED_NODES);
  const [edges, setEdges] = React.useState<FlowEdge[]>(SEED_EDGES);
  const [selected, setSelected] = React.useState<string | null>("planner");
  const [run, setRun] = React.useState<Record<string, RunStatus>>({});
  const [activeEdges, setActiveEdges] = React.useState<Set<string>>(new Set());
  const [running, setRunning] = React.useState(false);

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ id: string; dx: number; dy: number } | null>(null);
  const connectRef = React.useRef<string | null>(null);
  const [connect, setConnect] = React.useState<{ from: string; x: number; y: number } | null>(null);
  const timers = React.useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };
  React.useEffect(() => () => clearTimers(), []);

  function toCanvas(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // ---- dragging -----------------------------------------------------------
  function onNodePointerDown(e: React.PointerEvent, id: string) {
    if (running) return;
    e.stopPropagation();
    setSelected(id);
    const node = nodes.find((n) => n.id === id)!;
    const p = toCanvas(e.clientX, e.clientY);
    dragRef.current = { id, dx: p.x - node.x, dy: p.y - node.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    const p = toCanvas(e.clientX, e.clientY);
    if (dragRef.current) {
      const { id, dx, dy } = dragRef.current;
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? { ...n, x: Math.max(0, p.x - dx), y: Math.max(0, p.y - dy) }
            : n,
        ),
      );
    } else if (connectRef.current) {
      setConnect({ from: connectRef.current, x: p.x, y: p.y });
    }
  }

  function onCanvasPointerUp() {
    dragRef.current = null;
    connectRef.current = null;
    setConnect(null);
  }

  // ---- connecting ---------------------------------------------------------
  function onPortDown(e: React.PointerEvent, id: string) {
    if (running) return;
    e.stopPropagation();
    connectRef.current = id;
    const p = toCanvas(e.clientX, e.clientY);
    setConnect({ from: id, x: p.x, y: p.y });
  }

  function onNodePointerUp(e: React.PointerEvent, id: string) {
    if (connectRef.current && connectRef.current !== id) {
      const from = connectRef.current;
      setEdges((es) => {
        if (es.some((x) => x.from === from && x.to === id)) return es;
        return [...es, { id: `e${Date.now()}`, from, to: id }];
      });
    }
    connectRef.current = null;
    setConnect(null);
  }

  // ---- mutations ----------------------------------------------------------
  function addNode(kind: NodeKind) {
    const def = PALETTE.find((p) => p.kind === kind)!;
    const id = `n${Date.now()}`;
    const sc = canvasRef.current;
    const x = (sc?.scrollLeft ?? 0) + 80;
    const y = (sc?.scrollTop ?? 0) + 80;
    setNodes((ns) => [
      ...ns,
      { id, kind, x, y, label: def.defaultLabel, sub: def.sub, model: kind === "agent" ? defaultFlowModel() : undefined },
    ]);
    setSelected(id);
  }

  function deleteNode(id: string) {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    if (selected === id) setSelected(null);
  }

  function updateNode(id: string, patch: Partial<FlowNode>) {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }

  function resetGraph() {
    clearTimers();
    setNodes(SEED_NODES);
    setEdges(SEED_EDGES);
    setRun({});
    setActiveEdges(new Set());
    setRunning(false);
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ nodes, edges }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "atlas-flow.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- run ----------------------------------------------------------------
  function runFlow() {
    clearTimers();
    setRunning(true);
    setRun(Object.fromEntries(nodes.map((n) => [n.id, "idle"])));
    setActiveEdges(new Set());
    const layers = computeLayers(nodes, edges);
    let t = 300;
    layers.forEach((layer, li) => {
      timers.current.push(
        window.setTimeout(() => {
          setRun((r) => {
            const next = { ...r };
            layer.forEach((id) => (next[id] = "running"));
            return next;
          });
          // activate incoming edges
          setActiveEdges((s) => {
            const next = new Set(s);
            edges.forEach((e) => {
              if (layer.includes(e.to)) next.add(e.id);
            });
            return next;
          });
        }, t),
      );
      timers.current.push(
        window.setTimeout(() => {
          setRun((r) => {
            const next = { ...r };
            layer.forEach((id) => (next[id] = "done"));
            return next;
          });
        }, t + 650),
      );
      t += 900;
      if (li === layers.length - 1) {
        timers.current.push(window.setTimeout(() => setRunning(false), t));
      }
    });
  }

  function stop() {
    clearTimers();
    setRunning(false);
  }

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const models = routableModels();

  function port(id: string, side: "in" | "out") {
    const n = nodes.find((x) => x.id === id)!;
    return {
      x: side === "out" ? n.x + NODE_W : n.x,
      y: n.y + NODE_H / 2,
    };
  }
  function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  const bounds = nodes.reduce(
    (acc, n) => ({
      w: Math.max(acc.w, n.x + NODE_W + 120),
      h: Math.max(acc.h, n.y + NODE_H + 120),
    }),
    { w: 1400, h: 480 },
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col -mb-24 lg:mb-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Workflow className="size-4 text-action" />
          <span className="text-sm font-semibold">Atlas Flow</span>
          <Badge variant="accent" className="hidden sm:inline-flex">
            compiles to Atlas Brain
          </Badge>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" disabled={running}>
                <Plus className="size-4" /> Add node
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {PALETTE.map((p) => {
                const meta = KIND_META[p.kind];
                return (
                  <DropdownMenuItem key={p.kind} onClick={() => addNode(p.kind)}>
                    <meta.icon style={{ color: ACCENT_HEX[meta.accent] }} />
                    {meta.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" onClick={resetGraph} disabled={running} title="Reset">
            <RotateCcw className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={exportJSON} title="Export JSON">
            <Download className="size-4" />
          </Button>
          {running ? (
            <Button variant="danger" size="sm" onClick={stop}>
              <Square className="size-4" /> Stop
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={runFlow}>
              <Play className="size-4" /> Run flow
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="relative min-w-0 flex-1 overflow-auto bg-code">
          <div className="pointer-events-none absolute inset-0 bg-graticule opacity-40" />
          <div
            ref={canvasRef}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerLeave={onCanvasPointerUp}
            onClick={() => setSelected(null)}
            className="relative"
            style={{ width: bounds.w, height: bounds.h, minWidth: "100%", minHeight: "100%" }}
          >
            {/* edges */}
            <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
              <defs>
                {/* An active edge runs shelf → ridge: the direction of travel
                    is legible from the colour, not just the dash animation. */}
                <linearGradient id="flow-edge" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgb(var(--elev-1))" />
                  <stop offset="100%" stopColor="rgb(var(--elev-4))" />
                </linearGradient>
              </defs>
              {edges.map((e) => {
                const a = port(e.from, "out");
                const b = port(e.to, "in");
                const active = activeEdges.has(e.id);
                return (
                  <path
                    key={e.id}
                    d={edgePath(a, b)}
                    fill="none"
                    stroke={active ? "url(#flow-edge)" : "rgb(var(--border-strong))"}
                    strokeWidth={active ? 2.5 : 1.5}
                    strokeDasharray={active ? "6 6" : undefined}
                    className={active ? "flow-edge-active" : undefined}
                  />
                );
              })}
              {connect &&
                (() => {
                  const a = port(connect.from, "out");
                  return (
                    <path
                      d={edgePath(a, { x: connect.x, y: connect.y })}
                      fill="none"
                      stroke="rgb(var(--action))"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                    />
                  );
                })()}
            </svg>

            {/* nodes */}
            {nodes.map((n) => (
              <FlowNodeView
                key={n.id}
                node={n}
                selected={selected === n.id}
                status={run[n.id] ?? "idle"}
                onPointerDown={(e) => onNodePointerDown(e, n.id)}
                onPointerUp={(e) => onNodePointerUp(e, n.id)}
                onPortDown={(e) => onPortDown(e, n.id)}
              />
            ))}
          </div>
        </div>

        {/* Inspector (desktop) */}
        <aside className="hidden w-72 shrink-0 border-l border-border bg-surface/40 lg:block">
          <Inspector
            node={selectedNode}
            models={models}
            onChange={(patch) => selectedNode && updateNode(selectedNode.id, patch)}
            onDelete={() => selectedNode && deleteNode(selectedNode.id)}
          />
        </aside>
      </div>

      {/* Inspector (mobile sheet) */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed inset-x-0 bottom-16 z-40 max-h-[55vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface shadow-float lg:hidden"
          >
            <div className="flex justify-end p-2">
              <Button variant="ghost" size="icon-sm" onClick={() => setSelected(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <Inspector
              node={selectedNode}
              models={models}
              onChange={(patch) => updateNode(selectedNode.id, patch)}
              onDelete={() => deleteNode(selectedNode.id)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FlowNodeView({
  node,
  selected,
  status,
  onPointerDown,
  onPointerUp,
  onPortDown,
}: {
  node: FlowNode;
  selected: boolean;
  status: RunStatus;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPortDown: (e: React.PointerEvent) => void;
}) {
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  const accent = ACCENT_HEX[meta.accent];

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className={cn(
        "group absolute cursor-grab touch-none select-none rounded-xl border bg-surface shadow-lift transition-shadow active:cursor-grabbing",
        selected ? "border-action/60" : "border-border",
        status === "running" && "shadow-glow",
      )}
      style={{
        left: node.x,
        top: node.y,
        width: NODE_W,
        boxShadow: status === "running" ? `0 0 0 1px ${accent}, 0 0 30px -8px ${accent}` : undefined,
      }}
    >
      {/* input port */}
      {node.kind !== "trigger" && (
        <span
          className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-background bg-border-strong"
          style={{ background: selected ? accent : undefined }}
        />
      )}
      {/* output port */}
      {node.kind !== "output" && (
        <span
          onPointerDown={onPortDown}
          className="absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-background bg-border-strong transition-transform hover:scale-125"
          style={{ background: accent }}
        />
      )}

      <div className="flex items-center gap-2.5 p-3">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg"
          style={{ background: `${accent}1f`, color: accent }}
        >
          {status === "done" ? (
            <Check className="size-4" />
          ) : status === "running" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Icon className="size-4" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{node.label}</p>
          {node.sub && (
            <p className="truncate text-2xs text-muted-foreground">{node.sub}</p>
          )}
        </div>
      </div>
      <div
        className="absolute inset-x-0 -bottom-px h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
    </div>
  );
}

function Inspector({
  node,
  models,
  onChange,
  onDelete,
}: {
  node: FlowNode | null;
  models: ReturnType<typeof routableModels>;
  onChange: (patch: Partial<FlowNode>) => void;
  onDelete: () => void;
}) {
  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Sparkles className="size-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Select a node to edit it, or drag from a node&apos;s right port to
          connect another.
        </p>
      </div>
    );
  }
  const meta = KIND_META[node.kind];
  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center gap-2">
        <span
          className="grid size-7 place-items-center rounded-lg"
          style={{ background: `${ACCENT_HEX[meta.accent]}1f`, color: ACCENT_HEX[meta.accent] }}
        >
          <meta.icon className="size-4" />
        </span>
        <span className="text-sm font-semibold">{meta.label}</span>
        {node.kind !== "trigger" && node.kind !== "output" && (
          <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground hover:text-danger" onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <label className="mb-1 block text-xs text-muted-foreground">Label</label>
      <input
        value={node.label}
        onChange={(e) => onChange({ label: e.target.value })}
        className="mb-4 w-full rounded-lg border border-border bg-surface-2/50 px-2.5 py-2 text-sm outline-none focus:border-action/40"
      />

      {node.kind === "agent" && (
        <>
          <label className="mb-1 block text-xs text-muted-foreground">Model</label>
          <select
            value={node.model ?? ""}
            onChange={(e) => {
              const m = getModelById(e.target.value);
              onChange({ model: e.target.value, sub: m?.name });
            }}
            className="mb-4 w-full rounded-lg border border-border bg-surface-2/50 px-2.5 py-2 text-sm outline-none focus:border-action/40"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </>
      )}

      {(node.kind === "agent" || node.kind === "condition") && (
        <>
          <label className="mb-1 block text-xs text-muted-foreground">
            Instruction
          </label>
          <textarea
            value={node.instruction ?? ""}
            onChange={(e) => onChange({ instruction: e.target.value })}
            rows={4}
            className="w-full resize-none rounded-lg border border-border bg-surface-2/50 px-2.5 py-2 text-sm outline-none focus:border-action/40"
          />
        </>
      )}

      <div className="mt-auto rounded-xl border border-border bg-surface-2/40 p-3 text-2xs text-muted-foreground">
        Node id <span className="font-mono text-foreground/70">{node.id}</span>.
        Drag the node to reposition; drag its right port onto another node to
        wire them.
      </div>
    </div>
  );
}
