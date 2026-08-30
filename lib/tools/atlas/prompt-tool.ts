import { z } from "zod";

/**
 * The prompt library, as a tool.
 *
 * The second thing the agent can *do* rather than answer, and it is here rather
 * than somewhere richer for a specific reason: a chat that spends four rounds
 * arriving at a prompt that works, and then leaves it in the transcript, has
 * produced nothing durable. The library is where the rest of Atlas already
 * looks for a prompt - the Playground opens one, `/prompt` versions it - so
 * saving into it is the difference between a conversation and a work product.
 *
 * Versioning is not reimplemented. `saveVersion` in `lib/store/prompt-store.ts`
 * appends with an incrementing `v`, which is what the Prompt page shows and
 * diffs; a tool that wrote a bare body would have produced entries the page
 * could not explain.
 *
 * Every write goes through the approval gate (`lib/tools/spec.ts` classes this
 * `write`), so the person sees the title and body before anything lands in a
 * library they own.
 */

export const promptToolSchema = z.object({
  command: z
    .enum(["list", "read", "save"])
    .describe(
      "list: every prompt in the library. read: one prompt's newest body. save: create a prompt, or add a version to one that exists.",
    ),
  prompt_id: z
    .string()
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Lower-case letters, digits and hyphens only.")
    .optional()
    .describe("For `read` and `save`. Saving with an id that exists adds a version to it."),
  title: z.string().max(120).optional().describe("For `save`, when creating."),
  body: z.string().max(20_000).optional().describe("The prompt text. Required for `save`."),
  note: z
    .string()
    .max(200)
    .optional()
    .describe("For `save`: what changed, shown beside the version number."),
  tags: z.array(z.string().max(40)).max(8).optional(),
});

export type PromptToolInput = z.output<typeof promptToolSchema>;

/** One prompt as this tool sees it. Flattened from the store's version history. */
export interface PromptSummary {
  id: string;
  title: string;
  tags: readonly string[];
  /** Newest body. */
  body: string;
  /** Newest version number. */
  version: number;
}

/**
 * How a surface reaches the library.
 *
 * A port rather than a direct `usePromptStore` import, for the reason every
 * other tool in this directory takes one: this module must stay a pure function
 * over injected data so it can be tested without a browser, and so a surface
 * that has no library (the MCP server) cannot write to one.
 */
export interface PromptPort {
  list: () => readonly PromptSummary[];
  /** Create, or append a version when the id exists. Returns what happened. */
  save: (input: {
    id: string;
    title: string;
    body: string;
    note: string;
    tags: readonly string[];
  }) => { created: boolean; version: number };
}

export interface PromptToolResult {
  content: string;
  isError?: boolean;
}

const NO_LIBRARY =
  "The prompt library is not available on this surface, so there is nothing to read or write.";

export function runPromptTool(input: PromptToolInput, port?: PromptPort): PromptToolResult {
  if (!port) return { content: NO_LIBRARY, isError: true };

  switch (input.command) {
    case "list": {
      const all = port.list();
      if (all.length === 0) {
        return { content: "The prompt library is empty." };
      }
      const lines = all.map(
        (p) =>
          `- ${p.id} — ${p.title} (v${p.version})` +
          (p.tags.length ? ` [${p.tags.join(", ")}]` : ""),
      );
      return { content: `${all.length} prompt(s):\n${lines.join("\n")}` };
    }

    case "read": {
      if (!input.prompt_id) return { content: "`read` needs a prompt_id.", isError: true };
      const found = port.list().find((p) => p.id === input.prompt_id);
      if (!found) {
        // Naming the alternatives rather than only the failure: the id is
        // usually close, and a model given the list corrects itself in the
        // same round instead of guessing again in the next one.
        const ids = port
          .list()
          .map((p) => p.id)
          .join(", ");
        return {
          content: `No prompt with id "${input.prompt_id}". The library has: ${ids || "nothing"}.`,
          isError: true,
        };
      }
      return {
        content: `${found.title} (${found.id}, v${found.version})\n\n${found.body}`,
      };
    }

    case "save": {
      if (!input.body?.trim()) return { content: "`save` needs a body.", isError: true };
      const id = input.prompt_id ?? slugify(input.title ?? "");
      if (!id) {
        return { content: "`save` needs a prompt_id or a title to derive one from.", isError: true };
      }
      const existing = port.list().find((p) => p.id === id);
      const result = port.save({
        id,
        title: input.title ?? existing?.title ?? id,
        body: input.body,
        note: input.note ?? (existing ? "Updated by Atlas" : "Initial"),
        tags: input.tags ?? existing?.tags ?? [],
      });
      return {
        content: result.created
          ? `Saved "${id}" as a new prompt (v${result.version}). It is in the library at /prompt.`
          : `Added v${result.version} to "${id}". Earlier versions are still there.`,
      };
    }
  }
}

/**
 * A title to an id.
 *
 * Only used when the model gave a title and no id, which is the common shape of
 * "save this as X". A collision is not a problem: the same slug means the same
 * prompt, and the store appends a version rather than overwriting.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
