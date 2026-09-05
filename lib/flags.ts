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
  atlasGraph: {
    label: "Atlas knowledge graph",
    description:
      "Build a graph over the catalog, benchmarks, providers and news so the agent can answer relational questions about Atlas's own data. Derived in the browser from the snapshot already loaded — no network, no key.",
    defaultOn: false,
  },
  graphRag: {
    label: "Graph retrieval",
    description:
      "Retrieve from the knowledge graph alongside project files, and cite the nodes an answer rests on. Falls back to text retrieval when a question names no entity.",
    defaultOn: false,
  },
  agentConsole: {
    label: "Agent console",
    description:
      "A Map tab beside Run and Files showing what the agent retrieved, which sub-agents are working, and what the run has spent.",
    defaultOn: false,
  },
  atlasDock: {
    label: "Ask Atlas anywhere",
    description:
      "A summonable agent panel on every screen that can see what is on the page. Opens from the marker at the right edge, or with ⌘J.",
    // The one flag in this file that ships on, per Part E's own rule: a depth
    // item flips default-on once its phase passes verification, and this one
    // was driven live in a browser end to end - retrieval, tool calls, the
    // sub-agent fan-out, and the approval gate in both directions. It is also
    // the flag whose whole purpose is to be reachable from anywhere, which a
    // control nobody can find is not.
    defaultOn: true,
  },
  mcpServer: {
    label: "Serve Atlas over MCP",
    description:
      "Expose the catalog, graph, cost and news tools to external MCP clients. Public, read-only data only, and also requires ATLAS_MCP_SERVER_ENABLED on the server.",
    defaultOn: false,
  },
  voiceCapture: {
    label: "Voice turn-taking",
    description:
      "Detect speech and silence so the microphone closes when you stop talking, instead of waiting for a click.",
    defaultOn: false,
  },
  voiceLexicon: {
    label: "Voice vocabulary",
    description:
      "Correct model names, benchmarks and prices in what the microphone heard, using the catalog as the vocabulary. Only corrects an unambiguous match.",
    defaultOn: false,
  },
  voiceMode: {
    label: "Voice conversation",
    description:
      "A spoken conversation: the answer is read aloud as it is written, and talking over it interrupts. Answers are shorter and skip anything that only makes sense on screen.",
    defaultOn: false,
  },
  voiceCommands: {
    label: "Voice control",
    description:
      "Let spoken commands operate Atlas — open a module, pick models, filter a list. Navigation happens straight away; anything that saves or changes your data is read back and waits for a yes.",
    defaultOn: false,
  },
  voiceWake: {
    label: "Hey Atlas",
    description:
      "Listen for the words \"Hey Atlas\" while the app is open, so a conversation can be started without touching anything. Recognition runs in your browser and nothing is recorded, but the microphone is live on every page while this is on.",
    defaultOn: false,
  },
} as const satisfies Record<string, FlagDef>;

export type FlagId = keyof typeof FLAG_DEFS;

export const FLAG_IDS = Object.keys(FLAG_DEFS) as FlagId[];
