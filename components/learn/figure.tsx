"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Accent, FigureSpec, FlowEdge, FlowNode } from "@/lib/learn/types";
import { cn } from "@/lib/utils";

/**
 * Declarative diagrams.
 *
 * The curriculum needs around forty pictures. Forty components would be forty
 * files drifting apart visually within a month; five layout kinds rendered from
 * data stay consistent by construction, and the lesson modules stay pure data
 * with no JSX in them.
 */

const ACCENT_VAR: Record<Accent, string> = {
  cyan: "var(--cyan)",
  violet: "var(--violet)",
  amber: "var(--amber)",
};

export function Figure({
  figure,
  caption,
}: {
  figure: FigureSpec;
  caption?: string;
}) {
  return (
    <figure className="not-prose overflow-hidden rounded-2xl border border-border bg-surface/50 shadow-glow">
      <div className="overflow-x-auto p-4 sm:p-5">
        {figure.kind === "flow" && <FlowFigure spec={figure} />}
        {figure.kind === "stack" && <StackFigure spec={figure} />}
        {figure.kind === "quadrant" && <QuadrantFigure spec={figure} />}
        {figure.kind === "timeline" && <TimelineFigure spec={figure} />}
        {figure.kind === "bars" && <BarsFigure spec={figure} />}
      </div>
      {caption && (
        <figcaption className="border-t border-border bg-surface-2/40 px-4 py-2 text-2xs leading-relaxed text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// flow — node/edge graph
// ---------------------------------------------------------------------------

interface Anchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
  midY: number;
  midX: number;
}

/**
 * Nodes live in a normal CSS grid so their text wraps, stays selectable, and
 * reads to a screen reader as a list. Edges are drawn in an SVG overlay from
 * measured node positions — laying the whole thing out in SVG would mean
 * hand-computing text wrapping, and getting it wrong at every breakpoint.
 */
function FlowFigure({ spec }: { spec: Extract<FigureSpec, { kind: "flow" }> }) {
  const { nodes, edges, lanes } = spec;
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const nodeRefs = React.useRef(new Map<string, HTMLElement>());
  const [anchors, setAnchors] = React.useState<Record<string, Anchor>>({});
  const reduced = useReducedMotion();

  const columns = React.useMemo(() => {
    const max = nodes.reduce((n, x) => Math.max(n, x.column), 0);
    const out: FlowNode[][] = Array.from({ length: max + 1 }, () => []);
    for (const n of nodes) out[n.column].push(n);
    return out;
  }, [nodes]);

  React.useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const base = wrap.getBoundingClientRect();
      const next: Record<string, Anchor> = {};
      for (const [id, el] of nodeRefs.current) {
        const r = el.getBoundingClientRect();
        next[id] = {
          left: r.left - base.left,
          right: r.right - base.left,
          top: r.top - base.top,
          bottom: r.bottom - base.top,
          midY: r.top - base.top + r.height / 2,
          midX: r.left - base.left + r.width / 2,
        };
      }
      setAnchors(next);
    };

    measure();
    // Node boxes resize with the container and with font loading; a stale
    // anchor draws an edge into empty space.
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    for (const el of nodeRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [nodes, edges]);

  const ready = Object.keys(anchors).length === nodes.length;

  return (
    <div ref={wrapRef} className="relative min-w-[34rem]">
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        {ready &&
          edges.map((e, i) => (
            <FlowPath
              key={`${e.from}-${e.to}-${i}`}
              edge={e}
              from={anchors[e.from]}
              to={anchors[e.to]}
              index={i}
              animate={!reduced}
            />
          ))}
      </svg>

      <div
        className="relative grid gap-x-10 gap-y-3"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {lanes && lanes.length > 0 && (
          <>
            {columns.map((_, i) => (
              <p
                key={`lane-${i}`}
                className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {lanes[i] ?? ""}
              </p>
            ))}
          </>
        )}

        {columns.map((col, i) => (
          <div key={i} className="flex flex-col justify-center gap-3">
            {col.map((node) => (
              <FlowBox
                key={node.id}
                node={node}
                animate={!reduced}
                ref={(el) => {
                  if (el) nodeRefs.current.set(node.id, el);
                  else nodeRefs.current.delete(node.id);
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const FlowBox = React.forwardRef<
  HTMLDivElement,
  { node: FlowNode; animate: boolean }
>(function FlowBox({ node, animate }, ref) {
  const tint = node.accent ? ACCENT_VAR[node.accent] : "var(--border-strong)";
  return (
    <motion.div
      ref={ref}
      initial={animate ? { opacity: 0, y: 6 } : false}
      whileInView={animate ? { opacity: 1, y: 0 } : undefined}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.3 }}
      className={cn(
        "relative rounded-xl border bg-surface px-3 py-2 text-center",
        node.shape === "decision" && "rounded-2xl border-dashed",
      )}
      style={{
        borderColor: `rgb(${tint} / ${node.accent ? 0.5 : 1})`,
        background: node.accent
          ? `linear-gradient(160deg, rgb(${tint} / 0.12), rgb(var(--surface)))`
          : undefined,
      }}
    >
      <p className="text-xs font-semibold leading-snug">{node.label}</p>
      {node.note && (
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
          {node.note}
        </p>
      )}
    </motion.div>
  );
});

function FlowPath({
  edge,
  from,
  to,
  index,
  animate,
}: {
  edge: FlowEdge;
  from?: Anchor;
  to?: Anchor;
  index: number;
  animate: boolean;
}) {
  if (!from || !to) return null;

  const stroke = edge.back ? "rgb(var(--amber) / 0.7)" : "rgb(var(--cyan) / 0.6)";
  let d: string;
  let labelAt: { x: number; y: number };

  if (edge.back) {
    // Route a loop-back underneath everything rather than straight through the
    // node boxes it would otherwise cross.
    const drop = Math.max(from.bottom, to.bottom) + 22;
    d = `M ${from.midX} ${from.bottom} V ${drop} H ${to.midX} V ${to.bottom}`;
    labelAt = { x: (from.midX + to.midX) / 2, y: drop - 4 };
  } else {
    const x1 = from.right;
    const x2 = to.left;
    const mid = x1 + (x2 - x1) / 2;
    d = `M ${x1} ${from.midY} C ${mid} ${from.midY}, ${mid} ${to.midY}, ${x2} ${to.midY}`;
    labelAt = { x: mid, y: (from.midY + to.midY) / 2 - 6 };
  }

  return (
    <g>
      <motion.path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={edge.back ? "4 3" : undefined}
        markerEnd={`url(#${edge.back ? "fig-arrow-back" : "fig-arrow"})`}
        initial={animate ? { pathLength: 0, opacity: 0 } : false}
        whileInView={animate ? { pathLength: 1, opacity: 1 } : undefined}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.1 + index * 0.06 }}
      />
      {edge.label && (
        <text
          x={labelAt.x}
          y={labelAt.y}
          textAnchor="middle"
          className="fill-[rgb(var(--muted-foreground))] text-[9px]"
        >
          {edge.label}
        </text>
      )}
      <defs>
        <marker
          id="fig-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 7 4 L 0 7 z" fill="rgb(var(--cyan) / 0.7)" />
        </marker>
        <marker
          id="fig-arrow-back"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 7 4 L 0 7 z" fill="rgb(var(--amber) / 0.8)" />
        </marker>
      </defs>
    </g>
  );
}

// ---------------------------------------------------------------------------
// stack — layered boxes
// ---------------------------------------------------------------------------

function StackFigure({
  spec,
}: {
  spec: Extract<FigureSpec, { kind: "stack" }>;
}) {
  const reduced = useReducedMotion();
  return (
    <ol className="space-y-1.5">
      {spec.layers.map((layer, i) => {
        const tint = layer.accent ? ACCENT_VAR[layer.accent] : "var(--cyan)";
        return (
          <motion.li
            key={layer.label}
            initial={reduced ? false : { opacity: 0, x: -8 }}
            whileInView={reduced ? undefined : { opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
            className="flex items-center gap-3 rounded-xl border px-3.5 py-2.5"
            style={{
              borderColor: `rgb(${tint} / 0.35)`,
              background: `linear-gradient(100deg, rgb(${tint} / 0.12), rgb(${tint} / 0.03))`,
            }}
          >
            <span
              className="grid size-6 shrink-0 place-items-center rounded-md font-mono text-[10px] font-bold"
              style={{
                background: `rgb(${tint} / 0.2)`,
                color: `rgb(${tint})`,
              }}
            >
              {spec.layers.length - i}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{layer.label}</span>
              {layer.note && (
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  {layer.note}
                </span>
              )}
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// quadrant — 2x2 positioning map
// ---------------------------------------------------------------------------

function QuadrantFigure({
  spec,
}: {
  spec: Extract<FigureSpec, { kind: "quadrant" }>;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="mx-auto max-w-lg">
      <p className="mb-1 text-center text-2xs font-medium text-muted-foreground">
        {spec.yAxis[1]}
      </p>
      <div className="flex items-stretch gap-2">
        <p
          className="shrink-0 self-center text-2xs text-muted-foreground"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {spec.xAxis[0]}
        </p>

        <div className="relative aspect-[4/3] flex-1 rounded-xl border border-border bg-surface-2/30">
          {/* Quadrant dividers */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-1/2 w-px bg-border"
          />
          <span
            aria-hidden
            className="absolute inset-x-0 top-1/2 h-px bg-border"
          />

          {spec.points.map((p, i) => {
            const tint = p.accent ? ACCENT_VAR[p.accent] : "var(--cyan)";
            return (
              <motion.span
                key={p.label}
                initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                whileInView={reduced ? undefined : { opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.07 }}
                className="absolute flex -translate-x-1/2 translate-y-[-50%] flex-col items-center gap-1"
                style={{
                  left: `${Math.min(96, Math.max(4, p.x * 100))}%`,
                  top: `${Math.min(96, Math.max(4, (1 - p.y) * 100))}%`,
                }}
              >
                <span
                  className="size-2.5 rounded-full ring-4"
                  style={{
                    background: `rgb(${tint})`,
                    // Tailwind's ring-color can't take a runtime value.
                    boxShadow: `0 0 0 4px rgb(${tint} / 0.18)`,
                  }}
                />
                <span className="whitespace-nowrap rounded border border-border bg-surface px-1.5 py-px text-[10px] font-medium">
                  {p.label}
                </span>
              </motion.span>
            );
          })}
        </div>

        <p
          className="shrink-0 self-center text-2xs text-muted-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          {spec.xAxis[1]}
        </p>
      </div>
      <p className="mt-1 text-center text-2xs font-medium text-muted-foreground">
        {spec.yAxis[0]}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

function TimelineFigure({
  spec,
}: {
  spec: Extract<FigureSpec, { kind: "timeline" }>;
}) {
  const reduced = useReducedMotion();
  return (
    <ol className="relative flex min-w-[30rem] items-start">
      <span
        aria-hidden
        className="absolute left-0 right-0 top-[0.4rem] h-px bg-gradient-to-r from-cyan/50 via-violet/50 to-transparent"
      />
      {spec.items.map((item, i) => (
        <motion.li
          key={`${item.at}-${item.label}`}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.3, delay: i * 0.08 }}
          className="relative flex-1 pr-3"
        >
          <span className="relative z-10 block size-3 rounded-full border-2 border-cyan bg-background" />
          <p className="mt-2 font-mono text-2xs tnum text-cyan">{item.at}</p>
          <p className="text-xs font-semibold leading-snug">{item.label}</p>
          {item.note && (
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              {item.note}
            </p>
          )}
        </motion.li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// bars
// ---------------------------------------------------------------------------

function BarsFigure({ spec }: { spec: Extract<FigureSpec, { kind: "bars" }> }) {
  const reduced = useReducedMotion();
  const max = Math.max(...spec.items.map((i) => i.value), 1);

  return (
    <ul className="space-y-2.5">
      {spec.items.map((item, i) => {
        const tint = item.accent ? ACCENT_VAR[item.accent] : "var(--cyan)";
        return (
          <li key={item.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium">{item.label}</span>
              <span
                className="shrink-0 font-mono text-xs font-semibold tnum"
                style={{ color: `rgb(${tint})` }}
              >
                {item.value.toLocaleString()}
                {spec.unit && (
                  <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
                    {spec.unit}
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, rgb(${tint} / 0.6), rgb(${tint}))`,
                }}
                initial={reduced ? false : { width: 0 }}
                whileInView={{ width: `${(item.value / max) * 100}%` }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.6, delay: i * 0.06, ease: "easeOut" }}
              />
            </div>
            {item.note && (
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                {item.note}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
