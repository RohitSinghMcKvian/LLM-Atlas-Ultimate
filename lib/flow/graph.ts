import type { LucideIcon } from "lucide-react";
import {
  Webhook,
  Bot,
  Wrench,
  GitBranch,
  Flag,
  Brain,
  Search,
  TestTube,
} from "lucide-react";

export type NodeKind = "trigger" | "agent" | "tool" | "condition" | "output";

export interface FlowNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  label: string;
  /** Sub-label (model for agents, tool name, etc.). */
  sub?: string;
  /** For agents — a catalog model id. */
  model?: string;
  /** Optional instruction shown in the inspector. */
  instruction?: string;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
}

export interface KindMeta {
  label: string;
  icon: LucideIcon;
  accent: "ridge" | "shelf" | "upland" | "success";
}

export const KIND_META: Record<NodeKind, KindMeta> = {
  trigger: { label: "Trigger", icon: Webhook, accent: "ridge" },
  agent: { label: "Agent", icon: Bot, accent: "shelf" },
  tool: { label: "Tool", icon: Wrench, accent: "upland" },
  condition: { label: "Condition", icon: GitBranch, accent: "ridge" },
  output: { label: "Output", icon: Flag, accent: "success" },
};

export const NODE_W = 184;
export const NODE_H = 64;

export const SEED_NODES: FlowNode[] = [
  { id: "trigger", kind: "trigger", x: 40, y: 200, label: "Incoming task", sub: "webhook · /run" },
  {
    id: "planner",
    kind: "agent",
    x: 280,
    y: 200,
    label: "Planner",
    sub: "Claude Sonnet 4.5",
    model: "claude-sonnet-4-5",
    instruction: "Decompose the goal into a parallel plan.",
  },
  {
    id: "researcher",
    kind: "agent",
    x: 520,
    y: 80,
    label: "Researcher",
    sub: "DeepSeek V4 Pro",
    model: "deepseek-v4-pro",
    instruction: "Gather sources and synthesize findings.",
  },
  {
    id: "coder",
    kind: "agent",
    x: 520,
    y: 320,
    label: "Coder",
    sub: "Qwen 2.5 Coder",
    model: "qwen-2-5-coder-32b",
    instruction: "Implement the change and write tests.",
  },
  { id: "web", kind: "tool", x: 760, y: 80, label: "Web search", sub: "retrieval" },
  { id: "tests", kind: "tool", x: 760, y: 320, label: "Run tests", sub: "sandbox" },
  {
    id: "critic",
    kind: "condition",
    x: 1000,
    y: 200,
    label: "Critic",
    sub: "verify & merge",
    instruction: "Pass only if tests succeed and claims are grounded.",
  },
  { id: "output", kind: "output", x: 1240, y: 200, label: "Deliver result", sub: "diff + report" },
];

export const SEED_EDGES: FlowEdge[] = [
  { id: "e1", from: "trigger", to: "planner" },
  { id: "e2", from: "planner", to: "researcher" },
  { id: "e3", from: "planner", to: "coder" },
  { id: "e4", from: "researcher", to: "web" },
  { id: "e5", from: "coder", to: "tests" },
  { id: "e6", from: "web", to: "critic" },
  { id: "e7", from: "tests", to: "critic" },
  { id: "e8", from: "critic", to: "output" },
];

export const PALETTE: { kind: NodeKind; defaultLabel: string; sub?: string }[] = [
  { kind: "agent", defaultLabel: "New agent", sub: "Llama 3.3 70B" },
  { kind: "tool", defaultLabel: "New tool", sub: "custom" },
  { kind: "condition", defaultLabel: "Condition", sub: "if / else" },
  { kind: "output", defaultLabel: "Output", sub: "result" },
];

/** Topological layers for the run animation (parallel nodes share a layer). */
export function computeLayers(nodes: FlowNode[], edges: FlowEdge[]): string[][] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  });
  edges.forEach((e) => {
    adj.get(e.from)?.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  });

  const layers: string[][] = [];
  let frontier = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const seen = new Set<string>();
  while (frontier.length) {
    layers.push(frontier);
    frontier.forEach((id) => seen.add(id));
    const next: string[] = [];
    frontier.forEach((id) => {
      adj.get(id)?.forEach((to) => {
        indeg.set(to, (indeg.get(to) ?? 0) - 1);
        if ((indeg.get(to) ?? 0) === 0 && !seen.has(to)) next.push(to);
      });
    });
    frontier = next;
  }
  // any leftover (cycles) appended
  const leftover = nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  if (leftover.length) layers.push(leftover);
  return layers;
}

export const AGENT_ICONS = { Brain, Search, TestTube };
