import { ATLAS_TOOL_NAMES } from "@/lib/tools/atlas";
import { classify } from "@/lib/tools/spec";

/**
 * Typed sub-agents.
 *
 * `lib/engine/orchestrator.ts` has five built-in roles for Atlas Code
 * (explorer, implementer, tester, reviewer, researcher) and they are the right
 * shape but the wrong job: they are defined around a filesystem and a test
 * command, neither of which chat has. These five are defined around what chat
 * can actually reach - the graph, the web, the catalog's arithmetic, the build,
 * and the answer itself.
 *
 * Each role is a *narrowing*, never a widening. A role's `tools` list can only
 * remove from what the turn already offers: `toolsFor` intersects rather than
 * unions, so a role cannot hand a sub-agent a capability the user did not
 * enable. That property is what makes it safe to let a model choose the role.
 */

export type RoleId = "cartographer" | "scout" | "analyst" | "builder" | "critic";

export interface AgentRole {
  id: RoleId;
  label: string;
  /** One line, shown on the swimlane. */
  blurb: string;
  /**
   * Tools this role may use, before intersection with the turn's own set.
   * Every one of these is a `read` or `network` class except the builder's.
   */
  tools: string[];
  /** Whether this role may change anything. Exactly one role can. */
  writes: boolean;
  /** Prompt fragment. Appended after the shared sub-agent instructions. */
  prompt: string;
  /**
   * Share of the run's remaining budget this role may spend, before the
   * per-agent floor. Reading is cheap; building is not.
   */
  budgetShare: number;
  maxRounds: number;
}

/**
 * The Atlas tools a read-only role may hold.
 *
 * Derived, not listed. `ATLAS_TOOL_NAMES` used to be entirely reads, so taking
 * all of it was the same thing; the moment `atlas_open` and `atlas_prompt`
 * joined the registry it stopped being, and a "read-only" cartographer would
 * have been handed a tool that can move the person to another page in the
 * middle of a fan-out they cannot see. `roleWritesMatchTools` catches that in a
 * test, and this makes the catch unnecessary for whatever is added next.
 */
const READ_ATLAS = ATLAS_TOOL_NAMES.filter((n) => classify(n).sideEffect === "read");

export const ROLES: Record<RoleId, AgentRole> = {
  cartographer: {
    id: "cartographer",
    label: "Cartographer",
    blurb: "Reads the Atlas graph and catalog",
    tools: [...READ_ATLAS],
    writes: false,
    prompt:
      "You answer from the Atlas knowledge graph and catalog only. Use `atlas_graph` to find how " +
      "things relate and `atlas_catalog` for exact figures. Every number you report must come from " +
      "a tool result in this investigation - if the graph does not have it, say so. Never fill a " +
      "gap from memory: the catalog changes weekly and your recollection of it is wrong.",
    budgetShare: 0.15,
    maxRounds: 4,
  },
  scout: {
    id: "scout",
    label: "Scout",
    blurb: "Searches the web and Atlas News",
    tools: ["web_search", "atlas_news", "github"],
    writes: false,
    prompt:
      "You gather external evidence. Search, then report what the sources actually say with their " +
      "URLs. Distinguish what a source states from what you infer. If the sources disagree, report " +
      "the disagreement rather than picking a side.",
    budgetShare: 0.25,
    maxRounds: 4,
  },
  analyst: {
    id: "analyst",
    label: "Analyst",
    blurb: "Runs the numbers",
    // Deliberately no `run_python`, even though arithmetic is what this role is
    // for. The chat interpreter writes files into the exec mount, which makes it
    // a write - and a write would exclude the analyst from every read-only run,
    // which is exactly where a trustworthy number matters most. `atlas_cost` is
    // the real engine the Cost page runs, so nothing is actually lost.
    tools: ["atlas_cost", "atlas_catalog", "atlas_graph"],
    writes: false,
    prompt:
      "You do the arithmetic. Use `atlas_cost` for anything about money - it is the same engine the " +
      "Cost page runs, so your figures will match what the user can see. State the assumptions " +
      "behind every number. A figure with no assumptions attached is worse than no figure.",
    budgetShare: 0.2,
    maxRounds: 5,
  },
  builder: {
    id: "builder",
    label: "Builder",
    blurb: "Writes files and artifacts",
    tools: ["workspace", "artifact", "tasks", "run_python"],
    writes: true,
    prompt:
      "You make the thing. Work in small steps and record each one in the task ledger so the run " +
      "survives compaction. Do not explain what you are about to do at length - do it, then say " +
      "what you did.",
    budgetShare: 0.3,
    maxRounds: 12,
  },
  critic: {
    id: "critic",
    label: "Critic",
    blurb: "Looks for what is wrong",
    tools: [...READ_ATLAS, "web_search"],
    writes: false,
    prompt:
      "You look for what is wrong with the work so far: an unsupported claim, a number with no " +
      "source, a comparison against a benchmark one side never ran, a recommendation that ignores " +
      "a stated constraint. Report only real problems, each with what would fix it. If the work is " +
      "sound, say so in one line - inventing a criticism to seem useful is the failure mode here.",
    budgetShare: 0.1,
    maxRounds: 3,
  },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

export function isRoleId(v: unknown): v is RoleId {
  return typeof v === "string" && v in ROLES;
}

/**
 * The tools a role actually gets this turn.
 *
 * Intersection, never union. `available` is what the user's toggles already
 * permit; a role can only take a subset of it. Read the other way round - role
 * list wins - a role definition would become a way to switch on web search for
 * someone who turned it off.
 */
export function toolsFor(role: AgentRole, available: readonly string[]): string[] {
  const offered = new Set(available);
  return role.tools.filter((t) => offered.has(t));
}

/**
 * Whether a role can do anything useful with what is on offer.
 *
 * A scout with no web search and no news corpus is a model with no tools being
 * asked to research - which produces confident prose from pre-training, the
 * exact failure the fan-out exists to avoid. Better to not spawn it.
 */
export function roleIsUseful(role: AgentRole, available: readonly string[]): boolean {
  return toolsFor(role, available).length > 0;
}

/**
 * Reject a role that writes when the run is read-only.
 *
 * Checked here as well as at the tool gate, because the two protect different
 * things: the gate stops a call, and this stops the model being told it has a
 * builder at all - which it would otherwise plan around and then fail.
 */
export function allowedRoles(available: readonly string[], allowWrites: boolean): AgentRole[] {
  return ROLE_IDS.map((id) => ROLES[id])
    .filter((r) => (allowWrites || !r.writes) && roleIsUseful(r, available))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Whether every tool a role declares is classified as it claims. */
export function roleWritesMatchTools(role: AgentRole): boolean {
  const writes = role.tools.some((t) => {
    const c = classify(t);
    return c.sideEffect === "write" || c.sideEffect === "spend";
  });
  return writes === role.writes;
}

/** One line per role, for the planner's prompt. */
export function rolesBlock(roles: readonly AgentRole[]): string {
  if (roles.length === 0) return "";
  return [
    "<agents>",
    ...roles.map((r) => `- ${r.id}: ${r.blurb}. Tools: ${r.tools.join(", ")}.`),
    "</agents>",
  ].join("\n");
}
