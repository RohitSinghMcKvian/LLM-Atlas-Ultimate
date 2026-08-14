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

import type { Accent } from "./accent";

export type ModuleGroup = "Build" | "Research" | "Catalog" | "Learn";
export type { Accent };

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

/** @deprecated Import `ACCENT_RGB` from `lib/accent` — it follows the theme. */
export { ACCENT_RGB as ACCENT_HEX } from "./accent";

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
    accent: "ridge",
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
    accent: "shelf",
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
    accent: "ridge",
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
    accent: "upland",
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
    accent: "ridge",
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
    accent: "shelf",
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
    accent: "upland",
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
    accent: "shelf",
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
    accent: "upland",
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
    accent: "shelf",
    status: "live",
    flagship: true,
  },
  {
    id: "news",
    label: "News",
    name: "Atlas News",
    tagline: "Verified AI news, hourly",
    description:
      "Live AI news from ~30 first-party, research and press sources. De-duplicated across publishers, scored for provenance, and re-synced every hour — every story links to the original.",
    href: "/news",
    icon: Newspaper,
    group: "Catalog",
    accent: "ridge",
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
    accent: "ridge",
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
    accent: "shelf",
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
    accent: "ridge",
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
    accent: "upland",
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
    accent: "shelf",
    status: "live",
  },
];

export const MODULE_GROUPS: ModuleGroup[] = [
  "Build",
  "Research",
  "Catalog",
  "Learn",
];

// `MODULES` is static, so both lookups are precomputed once. `modulesByGroup`
// runs inside the sidebar's render loop (once per group, every render) and
// previously allocated a fresh array each time, which defeated memoization in
// anything downstream.

const MODULE_INDEX: Map<string, ModuleDef> = new Map(
  MODULES.map((m) => [m.id, m]),
);

const MODULES_BY_GROUP: Record<ModuleGroup, ModuleDef[]> = MODULES.reduce(
  (acc, m) => {
    (acc[m.group] ??= []).push(m);
    return acc;
  },
  {} as Record<ModuleGroup, ModuleDef[]>,
);

// Every group in MODULE_GROUPS resolves to an array, even if it holds no
// modules — callers `.map` the result unconditionally.
for (const group of MODULE_GROUPS) MODULES_BY_GROUP[group] ??= [];

export function getModule(id: string): ModuleDef | undefined {
  return MODULE_INDEX.get(id);
}

export function modulesByGroup(group: ModuleGroup): ModuleDef[] {
  return MODULES_BY_GROUP[group] ?? [];
}
