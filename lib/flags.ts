// Feature flags (Depth Spec v2, Part E mandate): every depth item lands dark
// behind a flag and flips default-on once its phase passes verification.
//
// Pure definitions only — user overrides live in lib/store/flags-store.ts.

export interface FlagDef {
  label: string;
  description: string;
  /** Effective value when the user has not overridden it. */
  defaultOn: boolean;
}

export const FLAG_DEFS = {
  taskLoop: {
    label: "Task Loop",
    description:
      "Closed-loop autonomy in Atlas Code: intake → explore → plan → execute → verify → self-correct → review → deliver.",
    defaultOn: false,
  },
  changeSets: {
    label: "Change sets",
    description: "Group agent edits into atomic change sets with per-hunk review.",
    defaultOn: false,
  },
  atlasMdLearning: {
    label: "ATLAS.md learning",
    description: "After a task, the agent proposes durable conventions for ATLAS.md as an approvable diff.",
    defaultOn: false,
  },
  chatEscalation: {
    label: "Chat → Code escalation",
    description: "Promote a chat (context, attachments, artifacts) into an Atlas Code task.",
    defaultOn: false,
  },
  evalLab: {
    label: "Eval lab",
    description: "Datasets, graders (incl. LLM-as-judge), scored model matrices, and regression tracking in Playground.",
    defaultOn: false,
  },
  deepResearch: {
    label: "Deep Research",
    description: "Multi-step agentic search in Chat with parallel queries and numbered citations.",
    defaultOn: false,
  },
  artifactsFileGen: {
    label: "File artifacts",
    description: "Generate real .docx/.xlsx/.pdf files from Chat artifacts.",
    defaultOn: false,
  },
  repoIntel: {
    label: "Repo intelligence",
    description: "Symbol index, import graph, and codebase constellation map for Atlas Code workspaces.",
    defaultOn: false,
  },
  gitExport: {
    label: "Git export",
    description: "Export agent change sets as a branch with conventional commits and a PR description.",
    defaultOn: false,
  },
  promptOptimizer: {
    label: "Prompt optimizer",
    description: "Auto-optimize prompts against an eval suite with a cost cap and variant lineage.",
    defaultOn: false,
  },
  promptCoaching: {
    label: "Prompt coaching",
    description: "Inline suggestions when a chat prompt is likely to underperform.",
    defaultOn: false,
  },
} as const satisfies Record<string, FlagDef>;

export type FlagId = keyof typeof FLAG_DEFS;

export const FLAG_IDS = Object.keys(FLAG_DEFS) as FlagId[];
