import { isMcpToolName, parseToolName } from "@/lib/mcp/protocol";

/**
 * One description of what every tool *is*, across all three sources.
 *
 * Atlas has built-in tools (`lib/chat/tools.ts`), connector tools discovered
 * from an MCP server (`lib/mcp/bridge.ts`), and now tools that drive Atlas's own
 * modules. `executeTool` already dispatches all of them and `runMcpTool` already
 * owns the connector approval gate, so the dispatch half was never the gap. What
 * was missing is a single place that knows a tool's *class* - whether running it
 * reads, reaches the network, writes something, or spends money - because that
 * is what decides whether it may run unattended.
 *
 * ### Why a table rather than a field on each tool
 *
 * The obvious alternative is to put `sideEffect` on `ChatTool` in
 * `lib/chat/tools.ts` and read it back here. That is structurally
 * drift-proof, and it means editing thirteen working tool definitions and their
 * 1,400 lines of tests to add metadata none of them uses yet. A table plus
 * `spec.test.ts` asserting it covers `TOOL_NAMES` exactly - no missing entry, no
 * stale one - buys the same guarantee at the cost of one test, and leaves the
 * existing tools untouched. If the table and the registry ever disagree, the
 * test fails on the next run rather than the policy quietly mis-classifying
 * something.
 */

/**
 * What running a tool actually does.
 *
 * Ordered by how much a mistaken call costs, which is the order the policy cares
 * about:
 *
 * - `read` - pure, local, free, offline. Reading a project file, querying the
 *   graph, costing a workload.
 * - `network` - reaches a third party. Reversible and free, but it is an
 *   outbound request carrying something the user typed, so it stays behind the
 *   toggle it already has.
 * - `write` - changes state the user owns. A saved prompt, a file in the
 *   workspace, a memory.
 * - `spend` - costs money. A bench run, a compare fan-out: real tokens against
 *   somebody's key.
 */
export type SideEffect = "read" | "network" | "write" | "spend";

/** Where a tool comes from, for the prompt index and the console. */
export type ToolSurface = "core" | "atlas" | "connector";

export interface ToolClass {
  name: string;
  surface: ToolSurface;
  sideEffect: SideEffect;
  /** Short human label. The console shows this, not the wire name. */
  title: string;
}

/**
 * The built-in tools, classified.
 *
 * `write` here means "changes something the user owns", which is why `artifact`,
 * `workspace`, `memory` and `run_python` are writes even though every one of
 * them is already gated by an explicit composer toggle. The toggle and the class
 * answer different questions: the toggle is whether the capability is offered at
 * all, the class is what happens if the model uses it.
 */
export const BUILTIN_CLASSES: Record<string, ToolClass> = {
  web_search: { name: "web_search", surface: "core", sideEffect: "network", title: "Web search" },
  list_project_files: {
    name: "list_project_files",
    surface: "core",
    sideEffect: "read",
    title: "List project files",
  },
  read_project_file: {
    name: "read_project_file",
    surface: "core",
    sideEffect: "read",
    title: "Read project file",
  },
  artifact: { name: "artifact", surface: "core", sideEffect: "write", title: "Edit the build" },
  workspace: { name: "workspace", surface: "core", sideEffect: "write", title: "Workspace files" },
  tasks: { name: "tasks", surface: "core", sideEffect: "write", title: "Task ledger" },
  memory: { name: "memory", surface: "core", sideEffect: "write", title: "Memory" },
  search_past_chats: {
    name: "search_past_chats",
    surface: "core",
    sideEffect: "read",
    title: "Search past chats",
  },
  recall_context: {
    name: "recall_context",
    surface: "core",
    sideEffect: "read",
    title: "Recall earlier turns",
  },
  // Read-only by construction, but it starts parallel model runs against the
  // build's budget - the most expensive thing one call in this app can do.
  spawn_subagents: {
    name: "spawn_subagents",
    surface: "core",
    sideEffect: "spend",
    title: "Sub-agents",
  },
  skill: { name: "skill", surface: "core", sideEffect: "read", title: "Load a skill" },
  github: { name: "github", surface: "core", sideEffect: "network", title: "GitHub" },
  run_python: { name: "run_python", surface: "core", sideEffect: "write", title: "Run Python" },
};

/** Atlas's own modules, filled in by `lib/tools/atlas/*`. */
export const ATLAS_CLASSES: Record<string, ToolClass> = {
  atlas_graph: { name: "atlas_graph", surface: "atlas", sideEffect: "read", title: "Atlas graph" },
  atlas_catalog: {
    name: "atlas_catalog",
    surface: "atlas",
    sideEffect: "read",
    title: "Model catalog",
  },
  atlas_cost: { name: "atlas_cost", surface: "atlas", sideEffect: "read", title: "Cost engine" },
  atlas_news: { name: "atlas_news", surface: "atlas", sideEffect: "read", title: "Atlas News" },
  // The first two Atlas tools that are not reads.
  //
  // `atlas_open` is a `write` even though nothing is persisted and the back
  // button undoes it, because "changes state the user owns" includes the page
  // they are looking at. An agent that can move someone mid-sentence, without
  // being asked, is the behaviour that makes in-app assistants feel like
  // something happening *to* you - and the gate remembers "always allow" per
  // tool, so a person who wants it instant says so once.
  atlas_open: { name: "atlas_open", surface: "atlas", sideEffect: "write", title: "Open a page" },
  atlas_prompt: {
    name: "atlas_prompt",
    surface: "atlas",
    sideEffect: "write",
    title: "Prompt library",
  },
};

export const ALL_CLASSES: Record<string, ToolClass> = { ...BUILTIN_CLASSES, ...ATLAS_CLASSES };

/**
 * Classify any tool name, including one Atlas has never seen.
 *
 * A connector tool is classified `write` rather than by its server's
 * `readOnlyHint`, for the reason `lib/mcp/approval.ts` already states: the hint
 * is a claim by the party being authorised, so it may inform what the prompt
 * says and must never decide what runs. An unknown non-connector name is also
 * `write` - the conservative answer is the only safe default for something the
 * registry does not describe.
 */
export function classify(name: string): ToolClass {
  const known = ALL_CLASSES[name];
  if (known) return known;
  if (isMcpToolName(name)) {
    const parsed = parseToolName(name);
    return {
      name,
      surface: "connector",
      sideEffect: "write",
      title: parsed ? `${parsed.connectorId}: ${parsed.toolName}` : name,
    };
  }
  return { name, surface: "core", sideEffect: "write", title: name };
}

/**
 * Whether a call has to be shown to a person before it runs.
 *
 * `read` and `network` do not: reads are free, local and reversible, and every
 * network tool is already behind a toggle the user set deliberately - prompting
 * again would ask them to re-consent to a choice they just made. `write` and
 * `spend` do, because neither is undone by saying no afterwards.
 */
export function needsApproval(name: string): boolean {
  const { sideEffect } = classify(name);
  return sideEffect === "write" || sideEffect === "spend";
}

/**
 * The prompt index for a set of tools.
 *
 * One block for all three surfaces, replacing separate per-source blocks: the
 * model sees a single flat tool list on the wire, so a system prompt that
 * describes them in three separate places invites it to reason about which
 * "kind" of tool to reach for instead of which tool.
 */
export function toolIndexBlock(names: readonly string[]): string {
  if (names.length === 0) return "";
  const bySurface = new Map<ToolSurface, ToolClass[]>();
  for (const name of names) {
    const c = classify(name);
    const list = bySurface.get(c.surface);
    if (list) list.push(c);
    else bySurface.set(c.surface, [c]);
  }

  const lines: string[] = ["<atlas_tools>"];
  for (const surface of ["core", "atlas", "connector"] as const) {
    const list = bySurface.get(surface);
    if (!list?.length) continue;
    lines.push(`${SURFACE_LABELS[surface]}:`);
    for (const c of list.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const gate = needsApproval(c.name) ? " (asks first)" : "";
      lines.push(`- ${c.name} - ${c.title}${gate}`);
    }
  }
  lines.push("</atlas_tools>");
  return lines.join("\n");
}

const SURFACE_LABELS: Record<ToolSurface, string> = {
  core: "Chat tools",
  atlas: "Atlas modules (local data, free to read)",
  connector: "Connected services",
};
