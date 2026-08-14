import { z } from "zod";

/**
 * A path-addressed document store the model edits with a small command set.
 *
 * This is the generalisation of what `memory-fs.ts` was: the same six commands
 * (`view`, `create`, `str_replace`, `insert`, `delete`, `rename`) and the same
 * path confinement, but parameterised by root and by size limits so a second
 * filesystem can reuse them instead of copying them.
 *
 * There are now two roots, and they are deliberately separate:
 *
 *  - `/memories` — durable facts about the *user*, one per account, tiny.
 *  - `/workspace` — the files of the *build in progress*, one per conversation,
 *    large enough to hold a real page.
 *
 * Copying this module for the second one would have meant two copies of the
 * traversal check, which is the security boundary. Path confinement must exist
 * exactly once.
 *
 * The workspace root also gets a seventh command, `append`. That is not a
 * convenience: a model asked for a 900-line page hits the provider's output
 * limit mid-file, and appending in chunks is the only way to write something
 * longer than one response can carry. It is gated per-root because appending to
 * a memory note is a way to grow it without ever reviewing it.
 *
 * Pure and storage-agnostic — `FsStore` is injected — so every rule here is
 * testable in the node-only suite.
 */

export interface FsFile {
  /** Absolute, always under the store's root. */
  path: string;
  text: string;
  updatedAt: number;
}

export interface FsStore {
  list(): Promise<FsFile[]>;
  read(path: string): Promise<FsFile | undefined>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface FsResult {
  content: string;
  isError?: boolean;
}

/**
 * Ceilings for one filesystem. A runaway model must not be able to fill the
 * user's disk, and on a browser that budget is shared with every other origin.
 */
export interface FsLimits {
  /** Absolute, no trailing slash, e.g. `/memories`. */
  root: string;
  maxFileBytes: number;
  maxFiles: number;
  /**
   * Ceiling on the whole store, not just one file. Separate from
   * `maxFileBytes * maxFiles` because that product is usually far more than a
   * browser will actually grant before it starts evicting origins.
   */
  maxTotalBytes?: number;
  /** `view` output is truncated past this. */
  maxViewChars?: number;
  /**
   * Whether `append` is accepted. Off by default, and enforced here rather than
   * only in the schema: the schema is what the model was *offered*, and a model
   * can send a command it was never offered.
   */
  allowAppend?: boolean;
}

const DEFAULT_VIEW_CHARS = 32 * 1024;

// ── path confinement ────────────────────────────────────────────────────────

/**
 * Resolve a model-supplied path, or explain why it is rejected.
 *
 * This is the security boundary. The model chooses these strings, so they are
 * untrusted input: `/memories/../../etc/passwd`, `/workspace/../atlas-keys`, or
 * a path with an embedded NUL must not resolve. Normalisation happens BEFORE
 * the prefix check — checking the prefix first and normalising after is the
 * classic ordering bug, since `/memories/../secret` passes a naive
 * `startsWith` and then escapes.
 */
export function resolveConfinedPath(
  raw: string,
  root: string,
): { path: string } | { error: string } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { error: "Path is required." };
  }
  // Backslashes are not separators here, but a Windows-style path would silently
  // become a legal *file name* containing slashes, which then round-trips
  // differently through display and comparison. Reject rather than translate.
  if (raw.includes("\\")) {
    return { error: "Use forward slashes in paths." };
  }
  // eslint-disable-next-line no-control-regex -- rejecting control chars is the point
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return { error: "Path contains control characters." };
  }
  if (!raw.startsWith("/")) {
    return { error: `Path must be absolute and start with ${root}/.` };
  }

  // Normalise: collapse empty segments and resolve . / .. arithmetically.
  const out: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      // A `..` that would pop past the root is an escape attempt, not a no-op.
      if (out.length === 0) return { error: "Path escapes the root directory." };
      out.pop();
      continue;
    }
    out.push(seg);
  }
  const path = `/${out.join("/")}`;

  if (path !== root && !path.startsWith(`${root}/`)) {
    return { error: `Path must be inside ${root}/.` };
  }
  // `..` inside a segment (`foo..bar`) is harmless; a segment that is only dots
  // is not, and normalisation above already handled the exact `..` case.
  return { path };
}

// ── command schema ──────────────────────────────────────────────────────────

export const FS_COMMANDS = [
  "view",
  "create",
  "str_replace",
  "insert",
  "delete",
  "rename",
] as const;

/** The workspace variant. `append` is what makes a file longer than one turn. */
export const FS_COMMANDS_WITH_APPEND = [...FS_COMMANDS, "append"] as const;

export type FsCommandName = (typeof FS_COMMANDS_WITH_APPEND)[number];

const pathField = z.string().min(1).max(512);

/**
 * Build the wire schema for one root.
 *
 * ONE flat object with a `command` enum and optional fields, not a
 * discriminated union. A union is the more honest model of these commands, and
 * it is what the executor works with internally — but `z.toJSONSchema` renders
 * a discriminated union as a top-level `anyOf`, and OpenAI-style function
 * calling requires the top level of a tool's parameters to be
 * `{"type": "object"}`. A union here would produce a tool definition several
 * providers reject outright.
 *
 * The cost is that "which fields are required" moves out of the schema and into
 * `requireFields` below. That turns out to be an improvement: the model gets
 * `create requires file_text` instead of a Zod union-discrimination error.
 */
export function fsCommandSchema(opts: {
  root: string;
  maxFileBytes: number;
  append?: boolean;
}) {
  const { root, maxFileBytes, append = false } = opts;
  const commands = append ? FS_COMMANDS_WITH_APPEND : FS_COMMANDS;

  const base = {
    command: z
      .enum(commands as unknown as [FsCommandName, ...FsCommandName[]])
      .describe("Which operation to perform."),
    path: pathField
      .optional()
      .describe(
        `Target file for view/create/str_replace/insert/delete${append ? "/append" : ""}. ` +
          `Defaults to ${root}, which lists the directory.`,
      ),
    file_text: z
      .string()
      .max(maxFileBytes)
      .optional()
      .describe("create: the full new contents of the file."),
    old_str: z
      .string()
      .min(1)
      .optional()
      .describe("str_replace: exact text to replace. Must appear exactly once."),
    new_str: z.string().optional().describe("str_replace: replacement text. Omit to delete."),
    insert_line: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("insert: insert after this 1-indexed line. 0 inserts at the top."),
    insert_text: z
      .string()
      .optional()
      .describe("insert: text to insert. Newlines split it into multiple lines."),
    old_path: pathField.optional().describe("rename: the file to move."),
    new_path: pathField.optional().describe("rename: the new path."),
  };

  if (!append) return z.object(base);

  return z.object({
    ...base,
    append_text: z
      .string()
      .max(maxFileBytes)
      .optional()
      .describe(
        "append: text added to the end of the file exactly as given, with no separator " +
          "inserted. Include the leading newline yourself. Creates the file if it does not " +
          "exist. Use this to write a file longer than one response can hold.",
      ),
  });
}

/** The shape every root's schema parses to, from the executor's point of view. */
export interface FsCommandInput {
  command: FsCommandName;
  path?: string;
  file_text?: string;
  old_str?: string;
  new_str?: string;
  insert_line?: number;
  insert_text?: string;
  old_path?: string;
  new_path?: string;
  append_text?: string;
}

/** Which fields each command needs, checked in the executor. */
const REQUIRED_FIELDS: Record<FsCommandName, string[]> = {
  view: [],
  create: ["path", "file_text"],
  str_replace: ["path", "old_str"],
  insert: ["path", "insert_line", "insert_text"],
  delete: ["path"],
  rename: ["old_path", "new_path"],
  append: ["path", "append_text"],
};

function requireFields(input: FsCommandInput): string | null {
  const missing = REQUIRED_FIELDS[input.command].filter(
    (f) => (input as unknown as Record<string, unknown>)[f] === undefined,
  );
  return missing.length ? `${input.command} requires ${missing.join(" and ")}.` : null;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n… truncated (${s.length} chars total)`;
}

/** Line-numbered view, matching the text-editor tool's shape so edits line up. */
function numbered(text: string): string {
  if (text === "") return "(empty file)";
  return text
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(5, " ")}\t${line}`)
    .join("\n");
}

export function byteLength(s: string): number {
  return typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(s).length
    : // Node <11 / exotic runtimes: over-estimate rather than under-estimate.
      s.length * 2;
}

function tooLarge(text: string, limits: FsLimits): FsResult | null {
  const size = byteLength(text);
  return size > limits.maxFileBytes
    ? {
        content: `File would be ${size} bytes, over the ${limits.maxFileBytes}-byte limit. Split it across files or remove older content.`,
        isError: true,
      }
    : null;
}

/**
 * Whether writing `text` to `path` would push the whole store over its ceiling.
 *
 * Counts every *other* file plus the proposed content, so an edit that shrinks a
 * file is never rejected for the size it used to be.
 */
async function overTotal(
  store: FsStore,
  path: string,
  text: string,
  limits: FsLimits,
): Promise<FsResult | null> {
  if (!limits.maxTotalBytes) return null;
  const files = await store.list();
  let total = byteLength(text);
  for (const f of files) if (f.path !== path) total += byteLength(f.text);
  return total > limits.maxTotalBytes
    ? {
        content:
          `This would bring ${limits.root} to ${total} bytes, over its ${limits.maxTotalBytes}-byte ` +
          `budget. Delete a file you no longer need first.`,
        isError: true,
      }
    : null;
}

// ── the executor ────────────────────────────────────────────────────────────

/**
 * Run one filesystem command against `store`.
 *
 * Never throws for a bad request. Every rejection — bad path, missing file,
 * ambiguous `str_replace`, oversize write — comes back as `isError` prose the
 * model can read and correct, which is the only failure mode it can act on. An
 * exception would abort the turn instead.
 */
export async function runFsCommand(
  input: FsCommandInput,
  store: FsStore,
  limits: FsLimits,
): Promise<FsResult> {
  const { root } = limits;
  const viewChars = limits.maxViewChars ?? DEFAULT_VIEW_CHARS;

  if (input.command === "append" && !limits.allowAppend) {
    return { content: `append is not available in ${root}.`, isError: true };
  }

  const missing = requireFields(input);
  if (missing) return { content: missing, isError: true };

  // Resolve every path up front so no command can act on an unchecked one.
  const paths: Record<string, string> = {};
  const rawPaths: [string, string][] =
    input.command === "rename"
      ? [
          ["old_path", input.old_path ?? ""],
          ["new_path", input.new_path ?? ""],
        ]
      : // `view` with no path means "list the directory".
        [["path", input.path ?? root]];
  for (const [field, raw] of rawPaths) {
    const r = resolveConfinedPath(raw, root);
    if ("error" in r) return { content: `${field}: ${r.error}`, isError: true };
    paths[field] = r.path;
  }

  switch (input.command) {
    case "view": {
      const path = paths.path;
      if (path === root) {
        const files = await store.list();
        if (files.length === 0) {
          return { content: `${root}/ is empty.` };
        }
        const lines = files
          .slice()
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((f) => `${f.path} (${byteLength(f.text)} bytes)`);
        return { content: `${root}/\n${lines.join("\n")}` };
      }
      const file = await store.read(path);
      if (!file) return { content: `No such file: ${path}`, isError: true };
      return { content: truncate(numbered(file.text), viewChars) };
    }

    case "create": {
      const path = paths.path;
      if (path === root) {
        return { content: `${root} is the directory, not a file.`, isError: true };
      }
      // Non-null: `requireFields` above already rejected a create without it.
      const fileText = input.file_text!;
      const over = tooLarge(fileText, limits);
      if (over) return over;
      const existing = await store.read(path);
      if (!existing && (await store.list()).length >= limits.maxFiles) {
        return {
          content: `${root} is full (${limits.maxFiles} files). Delete something first.`,
          isError: true,
        };
      }
      const overAll = await overTotal(store, path, fileText, limits);
      if (overAll) return overAll;
      await store.write(path, fileText);
      return { content: `${existing ? "Overwrote" : "Created"} ${path}.` };
    }

    case "append": {
      const path = paths.path;
      if (path === root) {
        return { content: `${root} is the directory, not a file.`, isError: true };
      }
      const addition = input.append_text!;
      const existing = await store.read(path);
      if (!existing && (await store.list()).length >= limits.maxFiles) {
        return {
          content: `${root} is full (${limits.maxFiles} files). Delete something first.`,
          isError: true,
        };
      }
      // Raw concatenation, no separator inserted. A file append is a byte
      // operation; guessing at a newline would corrupt a chunk that deliberately
      // continues the previous line mid-statement.
      const next = (existing?.text ?? "") + addition;
      const over = tooLarge(next, limits);
      if (over) return over;
      const overAll = await overTotal(store, path, next, limits);
      if (overAll) return overAll;
      await store.write(path, next);
      const lines = next.split("\n").length;
      return {
        content: `${existing ? "Appended to" : "Created"} ${path} (now ${lines} lines, ${byteLength(next)} bytes).`,
      };
    }

    case "str_replace": {
      const path = paths.path;
      const file = await store.read(path);
      if (!file) return { content: `No such file: ${path}`, isError: true };
      // Count occurrences before replacing. A silent first-match replace is how
      // an edit lands in the wrong place; making ambiguity an error forces the
      // model to quote more surrounding context instead.
      const parts = file.text.split(input.old_str!);
      const hits = parts.length - 1;
      if (hits === 0) {
        return {
          content: `old_str was not found in ${path}. View the file and copy the text exactly.`,
          isError: true,
        };
      }
      if (hits > 1) {
        return {
          content: `old_str appears ${hits} times in ${path}. Include more surrounding text so it matches exactly once.`,
          isError: true,
        };
      }
      // Omitted new_str means "delete the matched text".
      const next = parts.join(input.new_str ?? "");
      const over = tooLarge(next, limits);
      if (over) return over;
      const overAll = await overTotal(store, path, next, limits);
      if (overAll) return overAll;
      await store.write(path, next);
      return { content: `Edited ${path}.` };
    }

    case "insert": {
      const path = paths.path;
      const file = await store.read(path);
      if (!file) return { content: `No such file: ${path}`, isError: true };
      // Non-null: `requireFields` above already rejected an insert without them.
      const at = input.insert_line!;
      const lines = file.text === "" ? [] : file.text.split("\n");
      if (at > lines.length) {
        return {
          content: `insert_line ${at} is past the end of ${path} (${lines.length} lines).`,
          isError: true,
        };
      }
      const inserted = input.insert_text!.split("\n");
      const next = [...lines.slice(0, at), ...inserted, ...lines.slice(at)].join("\n");
      const over = tooLarge(next, limits);
      if (over) return over;
      const overAll = await overTotal(store, path, next, limits);
      if (overAll) return overAll;
      await store.write(path, next);
      return { content: `Inserted ${inserted.length} line(s) into ${path} after line ${at}.` };
    }

    case "delete": {
      const path = paths.path;
      if (path === root) {
        return {
          content: `Refusing to delete ${root} itself. Delete individual files.`,
          isError: true,
        };
      }
      const file = await store.read(path);
      if (!file) return { content: `No such file: ${path}`, isError: true };
      await store.remove(path);
      return { content: `Deleted ${path}.` };
    }

    case "rename": {
      const from = paths.old_path;
      const to = paths.new_path;
      if (from === to) return { content: `old_path and new_path are the same.`, isError: true };
      if (to === root) {
        return { content: `${root} is the directory, not a file.`, isError: true };
      }
      const file = await store.read(from);
      if (!file) return { content: `No such file: ${from}`, isError: true };
      if (await store.read(to)) {
        return {
          content: `${to} already exists. Delete it first or pick another name.`,
          isError: true,
        };
      }
      // Write-then-remove: an interruption between the two leaves a duplicate,
      // which the user can see and clean up. The other order loses the file.
      await store.write(to, file.text);
      await store.remove(from);
      return { content: `Renamed ${from} to ${to}.` };
    }
  }
}

/**
 * The model-visible index of what a filesystem holds.
 *
 * Only paths and sizes, never contents. Progressive disclosure: the model learns
 * that a file exists and can `view` it when a turn actually calls for it,
 * instead of paying for every stored byte on every request.
 *
 * `maxEntries` bounds the block itself. A build with two hundred files would
 * otherwise put two hundred lines in every single request — the listing has to
 * stay small even when the store does not.
 */
export function fsDirectoryBlock(
  files: FsFile[],
  opts: { lead: string; maxEntries?: number },
): string {
  if (files.length === 0) return "";
  const max = opts.maxEntries ?? 60;
  const sorted = files.slice().sort((a, b) => a.path.localeCompare(b.path));
  const shown = sorted.slice(0, max);
  const lines = shown.map((f) => `- ${f.path} (${byteLength(f.text)} bytes)`);
  if (sorted.length > shown.length) {
    lines.push(`- … and ${sorted.length - shown.length} more`);
  }
  return `${opts.lead}\n${lines.join("\n")}`;
}
