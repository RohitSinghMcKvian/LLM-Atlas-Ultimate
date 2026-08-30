import { z } from "zod";
import { getModelById } from "@/lib/catalog";
import { MODULES } from "@/lib/modules";

/**
 * Taking the person somewhere in Atlas.
 *
 * Every other Atlas tool answers a question. This one is the first that *acts*,
 * and the whole registry up to now has been read-only, so the shape of this one
 * decides what "acting" means here.
 *
 * ### It resolves a destination; it does not navigate
 *
 * `hrefForOpen` is pure. The navigation itself is a port, so three things hold
 * that would not otherwise:
 *
 *  - a surface with no router (the MCP server, a test) simply cannot navigate,
 *    rather than navigating somewhere nobody can see;
 *  - the destination is checked before anything moves - an id the catalog does
 *    not have is refused here, instead of opening `/cost?model=made-up` and
 *    leaving the person on a page apologising for the agent;
 *  - the resolution is unit-testable without a DOM, which is the same seam
 *    every other tool in this directory already uses.
 *
 * ### Only parameters a page actually reads
 *
 * Each one below is a `searchParams` key some route handler in
 * `app/(workspace)/` destructures today. Inventing a richer link vocabulary
 * would have produced URLs that look like deep links and land on a default
 * view, which is worse than not offering the parameter: the agent would report
 * having done something it did not do.
 */

/** Modules this tool can open, and the state each accepts. */
const OPENABLE = [
  "chat",
  "compare",
  "cost",
  "leaderboard",
  "playground",
  "news",
  "bench",
  "router",
  "prompt",
  "vault",
  "hub",
  "learn",
  "datasets",
  "notebooks",
  "flow",
  "code",
] as const;

export type OpenableModule = (typeof OPENABLE)[number];

export const openToolSchema = z.object({
  module: z
    .enum(OPENABLE)
    .describe("Which part of Atlas to open. Use the module id, e.g. `cost`, `compare`."),
  model_ids: z
    .array(z.string().max(120))
    .max(6)
    .optional()
    .describe(
      "Catalog model ids to preselect. `compare` takes several; `chat` and `cost` take the first.",
    ),
  access: z
    .enum(["free", "byok"])
    .optional()
    .describe("For `leaderboard`: filter to models the user can run on that footing."),
  prompt_text: z
    .string()
    .max(2000)
    .optional()
    .describe("For `playground`: prefill the prompt box with this."),
  search_query: z.string().max(200).optional().describe("For `news`: prefill the search."),
  topic: z
    .string()
    .max(40)
    .optional()
    .describe("For `news`: a topic id from atlas_news, to open the feed filtered to it."),
  article_id: z
    .string()
    .max(120)
    .optional()
    .describe("For `news`: an article id from atlas_news, to open that story."),
  reason: z
    .string()
    .max(200)
    .describe("One short line the person will see, saying why this is the right page."),
});

export type OpenToolInput = z.output<typeof openToolSchema>;

export interface OpenTarget {
  /** Where to go. Always same-origin and always begins with `/`. */
  href: string;
  /** The module's product name, for what the agent says afterwards. */
  moduleName: string;
}

export type OpenResolution = OpenTarget | { error: string };

/**
 * Where a request lands, or why it cannot.
 *
 * Unknown model ids are named individually rather than reported as a count: the
 * model can correct `claude-opus-4` to `claude-opus-5` from the name, and cannot
 * correct anything from "2 ids were not found".
 */
export function hrefForOpen(input: OpenToolInput): OpenResolution {
  const mod = MODULES.find((m) => m.id === input.module);
  if (!mod) return { error: `Atlas has no module called "${input.module}".` };
  if (mod.status !== "live") {
    return { error: `${mod.name} is not built yet, so there is nothing to open.` };
  }

  const ids = input.model_ids ?? [];
  const unknown = ids.filter((id) => !getModelById(id));
  if (unknown.length) {
    return {
      error:
        `Not in the catalog: ${unknown.join(", ")}. ` +
        `Look the model up with atlas_catalog search first, and use the id it returns.`,
    };
  }

  const params = new URLSearchParams();
  switch (input.module) {
    case "compare":
      // The route splits on "," and trims, so several ids are one parameter.
      if (ids.length) params.set("models", ids.join(","));
      break;
    case "chat":
    case "cost":
      // Both read a single `model`. Passing the first rather than refusing a
      // list: "compare these two on cost" is a reasonable thing to say, and
      // opening the cost page on the first is a better answer than an error.
      if (ids[0]) params.set("model", ids[0]);
      break;
    case "leaderboard":
      if (input.access) params.set("access", input.access);
      break;
    case "playground":
      if (input.prompt_text) params.set("prompt", input.prompt_text);
      break;
    case "news":
      // The three keys `parseNewsSearchParams` reads. Not the whole filter
      // vocabulary - `src`, `verified`, `sort`, `view` are shape-of-the-page
      // choices the reader makes, and an agent setting them is rearranging
      // someone's furniture to answer a question.
      if (input.search_query) params.set("q", input.search_query);
      if (input.topic) params.set("t", input.topic);
      if (input.article_id) params.set("a", input.article_id);
      break;
    default:
      // Every other module takes no parameters today. Silently dropping state
      // it cannot use is right: the destination is still the correct one.
      break;
  }

  const query = params.toString();
  return { href: query ? `${mod.href}?${query}` : mod.href, moduleName: mod.name };
}

/** How a surface performs the navigation. Absent means it cannot. */
export type NavigatePort = (href: string) => void;

export interface OpenToolResult {
  content: string;
  isError?: boolean;
}

export function runOpenTool(input: OpenToolInput, navigate?: NavigatePort): OpenToolResult {
  const resolved = hrefForOpen(input);
  if ("error" in resolved) return { content: resolved.error, isError: true };

  if (!navigate) {
    // Not an error. The destination is real and the person can reach it; this
    // surface just cannot move them there, and saying where to go is a useful
    // answer rather than a failure.
    return {
      content: `This surface cannot navigate. Tell the person to open ${resolved.href} (${resolved.moduleName}).`,
    };
  }

  navigate(resolved.href);
  return {
    content:
      `Opened ${resolved.moduleName} at ${resolved.href}. ` +
      `The person is now looking at it, so describe what they will see rather than repeating the link.`,
  };
}
