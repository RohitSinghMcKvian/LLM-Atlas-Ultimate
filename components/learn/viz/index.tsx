"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { VizKey } from "@/lib/learn/types";

/**
 * The visualization registry.
 *
 * Every widget is code-split. A lesson typically renders one of them, and the
 * suite together is heavier than all the curriculum text combined — loading
 * the tokenizer's split tables on the routing lesson would be pure waste.
 *
 * Lessons reference a viz by `VizKey`, never by import, so the curriculum data
 * modules stay free of JSX and this file is the only place that knows the
 * mapping.
 */

function VizSkeleton() {
  return (
    <div
      className="h-64 w-full animate-pulse rounded-2xl border border-border bg-surface-2/40"
      aria-hidden
    />
  );
}

const REGISTRY: Record<VizKey, React.ComponentType> = {
  tokenizer: dynamic(() => import("./tokenizer-viz").then((m) => m.TokenizerViz), {
    loading: VizSkeleton,
  }),
  embeddings: dynamic(
    () => import("./embeddings-viz").then((m) => m.EmbeddingsViz),
    { loading: VizSkeleton },
  ),
  attention: dynamic(() => import("./attention-viz").then((m) => m.AttentionViz), {
    loading: VizSkeleton,
  }),
  sampling: dynamic(() => import("./sampling-viz").then((m) => m.SamplingViz), {
    loading: VizSkeleton,
  }),
  "context-window": dynamic(
    () => import("./context-window-viz").then((m) => m.ContextWindowViz),
    { loading: VizSkeleton },
  ),
  transformer: dynamic(
    () => import("./transformer-viz").then((m) => m.TransformerViz),
    { loading: VizSkeleton },
  ),
  rag: dynamic(() => import("./rag-viz").then((m) => m.RagViz), {
    loading: VizSkeleton,
  }),
  chunking: dynamic(
    () => import("./chunking-viz").then((m) => m.ChunkingViz),
    { loading: VizSkeleton },
  ),
  "tool-loop": dynamic(
    () => import("./tool-loop-viz").then((m) => m.ToolLoopViz),
    { loading: VizSkeleton },
  ),
  "agent-loop": dynamic(
    () => import("./agent-loop-viz").then((m) => m.AgentLoopViz),
    { loading: VizSkeleton },
  ),
  "memory-tiers": dynamic(
    () => import("./memory-tiers-viz").then((m) => m.MemoryTiersViz),
    { loading: VizSkeleton },
  ),
  "eval-matrix": dynamic(
    () => import("./eval-matrix-viz").then((m) => m.EvalMatrixViz),
    { loading: VizSkeleton },
  ),
  reasoning: dynamic(
    () => import("./reasoning-viz").then((m) => m.ReasoningViz),
    { loading: VizSkeleton },
  ),
  scaling: dynamic(() => import("./scaling-viz").then((m) => m.ScalingViz), {
    loading: VizSkeleton,
  }),
  latency: dynamic(() => import("./latency-viz").then((m) => m.LatencyViz), {
    loading: VizSkeleton,
  }),
  "cost-frontier": dynamic(
    () => import("./cost-frontier-viz").then((m) => m.CostFrontierViz),
    { loading: VizSkeleton },
  ),
};

export function LessonViz({ viz, caption }: { viz: VizKey; caption?: string }) {
  const Component = REGISTRY[viz];
  if (!Component) return null;
  return (
    <div className="not-prose">
      <Component />
      {caption && (
        <p className="mt-1.5 px-1 text-2xs leading-relaxed text-muted-foreground">
          {caption}
        </p>
      )}
    </div>
  );
}
