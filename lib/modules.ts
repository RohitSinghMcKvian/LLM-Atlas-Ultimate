import type { LucideIcon } from "lucide-react";
import {
  MessagesSquare,
  SquareTerminal,
  GitCompareArrows,
  Trophy,
  Calculator,
  Newspaper,
  GraduationCap,
  Workflow,
  FlaskConical,
  Gauge,
  Library,
  Boxes,
  KeyRound,
  Router,
  Database,
  NotebookPen,
} from "lucide-react";

export type ModuleGroup = "Build" | "Research" | "Catalog" | "Learn";
export type Accent = "cyan" | "violet" | "amber";

export interface ModuleDef {
  id: string;
  /** Short label used in nav. */
  label: string;
  /** Full product name. */
  name: string;
  tagline: string;
  description: string;
  href: string;
  icon: LucideIcon;
  group: ModuleGroup;
  accent: Accent;
  status: "live" | "soon";
  flagship?: boolean;
}

export const ACCENT_HEX: Record<Accent, string> = {
  cyan: "#22D3EE",
  violet: "#A78BFA",
  amber: "#F5A623",
};

export const MODULES: ModuleDef[] = [
  {
    id: "chat",
    label: "Chat",
    name: "Atlas Chat",
    tagline: "Premium chat over any model",
    description:
      "A Claude-chat-class conversational interface over any model, with artifacts, tools, MCP, and persistent memory.",
    href: "/chat",
    icon: MessagesSquare,
    group: "Build",
    accent: "cyan",
    status: "live",
    flagship: true,
  },
  {
    id: "code",
    label: "Code",
    name: "Atlas Code",
    tagline: "Agentic coding workspace",
    description:
      "An editor + terminal + agent that plans, edits, runs, and verifies code in a sandbox — with a live Atlas Brain trace.",
    href: "/code",
    icon: SquareTerminal,
    group: "Build",
    accent: "violet",
    status: "live",
  },
  {
    id: "flow",
    label: "Flow",
    name: "Atlas Flow",
    tagline: "Visual multi-agent builder",
    description:
      "A declarative + visual builder for multi-agent workflows that compiles to a runnable Atlas Brain graph.",
    href: "/flow",
    icon: Workflow,
    group: "Build",
    accent: "cyan",
    status: "live",
  },
  {
    id: "playground",
    label: "Playground",
    name: "Atlas Playground",
    tagline: "Prompt & parameter scratchpad",
    description:
      "Run one prompt across models, tweak temperature and system prompts, diff outputs, and save to Atlas Prompt.",
    href: "/playground",
    icon: FlaskConical,
    group: "Build",
    accent: "amber",
    status: "live",
  },
  {
    id: "compare",
    label: "Compare",
    name: "Atlas Compare",
    tagline: "Multi-model research, in parallel",
    description:
      "Run one query across many models concurrently, then synthesize the answers with agreements and divergences surfaced.",
    href: "/compare",
    icon: GitCompareArrows,
    group: "Research",
    accent: "cyan",
    status: "live",
    flagship: true,
  },
  {
    id: "bench",
    label: "Bench",
    name: "Atlas Bench",
    tagline: "Bring-your-own reproducible evals",
    description:
      "Run prompt sets against models and contribute fully-reproducible results back to the leaderboard.",
    href: "/bench",
    icon: Gauge,
    group: "Research",
    accent: "violet",
    status: "live",
  },
  {
    id: "datasets",
    label: "Datasets",
    name: "Atlas Datasets",
    tagline: "Corpora & knowledge bases",
    description:
      "Chunk, embed, and index corpora that feed memory and RAG across the workspace.",
    href: "/datasets",
    icon: Database,
    group: "Research",
    accent: "amber",
    status: "soon",
  },
  {
    id: "notebooks",
    label: "Notebooks",
    name: "Atlas Notebooks",
    tagline: "Long-form research documents",
    description:
      "Weave live model runs, citations, and notes into durable research documents.",
    href: "/notebooks",
    icon: NotebookPen,
    group: "Research",
    accent: "violet",
    status: "soon",
  },
  {
    id: "leaderboard",
    label: "Leaderboard",
    name: "Atlas Leaderboard",
    tagline: "The complete model catalog",
    description:
      "Capabilities, benchmarks, pricing, and rankings for existing and upcoming models — every number attributed.",
    href: "/leaderboard",
    icon: Trophy,
    group: "Catalog",
    accent: "amber",
    status: "live",
    flagship: true,
  },
  {
    id: "cost",
    label: "Cost",
    name: "Atlas Cost",
    tagline: "Enterprise cost calculator",
    description:
      "Model and compare real workload cost across open-source self-hosting and frontier APIs, with a cost-vs-capability frontier.",
    href: "/cost",
    icon: Calculator,
    group: "Catalog",
    accent: "violet",
    status: "live",
    flagship: true,
  },
  {
    id: "news",
    label: "News",
    name: "Atlas News",
    tagline: "Hourly-syncing AI news",
    description:
      "A de-duplicated, hourly-updating feed of AI news with neutral summaries and 'what changed' model-diff cards.",
    href: "/news",
    icon: Newspaper,
    group: "Catalog",
    accent: "cyan",
    status: "live",
  },
  {
    id: "router",
    label: "Router",
    name: "Atlas Router",
    tagline: "Unified inference gateway",
    description:
      "One API across many providers and local inference, with cost-aware routing, fallback, retries, and caching.",
    href: "/router",
    icon: Router,
    group: "Catalog",
    accent: "cyan",
    status: "live",
  },
  {
    id: "learn",
    label: "Learn",
    name: "Atlas Learn",
    tagline: "Beginner to expert, hands-on",
    description:
      "A model-connected AI/LLM curriculum with live lessons, auto-graded exercises, and shareable certification.",
    href: "/learn",
    icon: GraduationCap,
    group: "Learn",
    accent: "violet",
    status: "live",
  },
  {
    id: "prompt",
    label: "Prompt",
    name: "Atlas Prompt",
    tagline: "Versioned prompt library",
    description:
      "Templates, variables, evals, and changelogs — shared across Chat, Code, and Flow.",
    href: "/prompt",
    icon: Library,
    group: "Learn",
    accent: "cyan",
    status: "live",
  },
  {
    id: "hub",
    label: "Hub",
    name: "Atlas Hub",
    tagline: "Your model orchestrator home",
    description:
      "The launchpad for every model — trending, new, free open weights, and frontier BYOK — with one-click jump into chat, compare, or cost.",
    href: "/hub",
    icon: Boxes,
    group: "Catalog",
    accent: "amber",
    status: "live",
    flagship: true,
  },
  {
    id: "vault",
    label: "Vault",
    name: "Atlas Vault",
    tagline: "Keys, secrets & access trail",
    description:
      "Manage your model key, operator provider status, and tool credentials — each masked, testable, and audited, with secrets never exposed to Atlas servers.",
    href: "/vault",
    icon: KeyRound,
    group: "Learn",
    accent: "violet",
    status: "live",
  },
];

export const MODULE_GROUPS: ModuleGroup[] = [
  "Build",
  "Research",
  "Catalog",
  "Learn",
];

export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}

export function modulesByGroup(group: ModuleGroup): ModuleDef[] {
  return MODULES.filter((m) => m.group === group);
}
