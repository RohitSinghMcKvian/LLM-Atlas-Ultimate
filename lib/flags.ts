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
  chatCodeExec: {
    label: "Code execution",
    description:
      "A sandboxed Python interpreter in Chat with the build workspace mounted, able to produce real .xlsx/.docx/.pdf files. Off by default because the runtime is a ~10MB CDN download.",
    defaultOn: false,
  },
  turnActions: {
    label: "Carry tool history",
    description:
      "Append a one-line record of what each recent turn did to its assistant message, so the model can see across turns what it already built. Bounded to 2000 characters per request.",
    defaultOn: false,
  },
  longContext: {
    label: "Long-context memory",
    description:
      "When a long conversation is compacted, have the model write a real summary of the folded turns instead of keeping their opening sentences, and let it read the original wording back with a recall tool. Costs one small model call per fold, capped at $0.05.",
    defaultOn: false,
  },
  transcriptTrim: {
    label: "Trim tool transcript",
    description:
      "Replace older tool results with a one-line stub inside a long build. The loop re-sends every prior round on every round, which is the real limit on how long a build can run. Changes what goes on the wire.",
    defaultOn: false,
  },
  chatPyExecWorker: {
    label: "Python in a worker",
    description:
      "Run chat's Python off the main thread. Stop can then actually interrupt a running script, and a long analysis no longer freezes the page. Falls back to the main thread if the worker cannot start.",
    defaultOn: false,
  },
  autoContinue: {
    label: "Auto-continue",
    description:
      "Resume a build automatically when it runs out of tool rounds mid-work. Never fires on a cost, time or no-progress stop.",
    defaultOn: false,
  },
  chatSubagents: {
    label: "Sub-agents",
    description:
      "Let a build spawn up to 3 read-only investigations in parallel and act on their reports. They cannot write anything. Build mode only; their spend is charged to the build's own budget.",
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
  artifactSelfRepair: {
    label: "Artifact self-repair",
    description:
      "Run a finished artifact headlessly, and spend a model turn fixing it if it is broken before the user sees it.",
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
