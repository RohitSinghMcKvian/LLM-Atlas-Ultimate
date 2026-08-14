// SKILL.md parsing (spec §4, Skills).
//
// Generalized from `parseAgentMd` in lib/engine/orchestrator.ts, which already
// parsed `---` frontmatter plus a markdown body for `.atlas/agents/*.md`. That
// function stays where it is — it produces an `AgentRole` for the /code
// subagent runner, which is a different shape and a different lifecycle. What is
// shared is the *grammar*, so this module owns a stricter version of it and the
// two consumers keep their own types.
//
// Deliberately not a YAML dependency. The frontmatter this needs is
// `key: scalar` and `key: [a, b]`, which is a few lines of parsing; pulling in a
// YAML engine to read four keys would contradict the repo's convention (see
// lib/chat/idb.ts and lib/crypto/secret-box.ts, which make the same call).
// Anything a real YAML file could express and this cannot is rejected with a
// message, never silently misread.

export interface Skill {
  /** Slug derived from the file path, or from the name when there is no path. */
  id: string;
  name: string;
  /**
   * One line telling the model WHEN to use this skill. It is the only part of a
   * skill that is always in context, so it carries the whole cost of having the
   * skill installed — and the whole burden of getting it invoked.
   */
  description: string;
  /** The instructions, loaded only when the skill is invoked. */
  body: string;
  /**
   * Tools this skill is permitted to use while loaded. `undefined` means "no
   * restriction"; an empty array means "no tools at all", which is a meaningful
   * thing for a skill to declare and must not be conflated with the former.
   */
  allowedTools?: string[];
  version?: string;
  /** Where it came from. Built-ins cannot be edited or deleted. */
  source: "builtin" | "user";
  enabled: boolean;
  updatedAt: number;
}

export interface SkillParseError {
  error: string;
}

/** Frontmatter keys this parser understands. Unknown keys are reported. */
const KNOWN_KEYS = new Set(["name", "description", "allowed-tools", "version"]);

export const MAX_SKILL_BODY_CHARS = 32_000;
export const MAX_DESCRIPTION_CHARS = 500;
const MAX_NAME_CHARS = 64;

/** Lower-case, hyphenated, filesystem-and-URL-safe. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Parse one `key: value` frontmatter line.
 *
 * Supports the two shapes a SKILL.md actually uses: a scalar, and an inline list
 * (`[a, b]` or a bare comma-separated run). Quotes are stripped from scalars so
 * `name: "My Skill"` and `name: My Skill` agree.
 */
function parseValue(raw: string): string | string[] {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
  }
  return unquote(v);
}

function unquote(s: string): string {
  const m = /^(['"])([\s\S]*)\1$/.exec(s);
  return m ? m[2] : s;
}

/**
 * Parse SKILL.md content into a Skill, or explain the rejection.
 *
 * Returns an error object rather than throwing or returning null: a user pasting
 * a skill into the editor needs to be told *what* is wrong with it, and
 * `parseAgentMd`'s `null` return — which conflates "no frontmatter", "empty
 * body" and "malformed" — is exactly the feedback that isn't actionable.
 */
export function parseSkillMd(
  content: string,
  opts: { path?: string; source?: Skill["source"] } = {},
): Skill | SkillParseError {
  const text = content.trim();
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) {
    return {
      error:
        "Missing frontmatter. A skill starts with a `---` block containing at least `name` and `description`.",
    };
  }

  const meta: Record<string, string | string[]> = {};
  const unknown: string[] = [];
  for (const line of m[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const kv = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(trimmed);
    if (!kv) {
      return { error: `Could not parse frontmatter line: ${trimmed}` };
    }
    const key = kv[1].toLowerCase();
    if (!KNOWN_KEYS.has(key)) {
      unknown.push(key);
      continue;
    }
    meta[key] = parseValue(kv[2]);
  }
  if (unknown.length) {
    // Reported rather than ignored: a typo'd `descripton:` would otherwise fail
    // the required-field check with a confusing message about a key that looks
    // present in the file.
    return {
      error: `Unknown frontmatter key(s): ${unknown.join(", ")}. Supported: ${[...KNOWN_KEYS].join(", ")}.`,
    };
  }

  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  const description =
    typeof meta.description === "string" ? meta.description.trim() : "";
  const body = m[2].trim();

  if (!name) return { error: "Frontmatter needs a `name`." };
  if (name.length > MAX_NAME_CHARS)
    return { error: `\`name\` must be ${MAX_NAME_CHARS} characters or fewer.` };
  if (!description)
    return {
      error:
        "Frontmatter needs a `description`. It is the only part of the skill the model sees until it is invoked, so it must say when to use the skill.",
    };
  if (description.length > MAX_DESCRIPTION_CHARS)
    return {
      error: `\`description\` must be ${MAX_DESCRIPTION_CHARS} characters or fewer — it is in context on every request.`,
    };
  if (!body) return { error: "Skill body is empty. Put the instructions below the frontmatter." };
  if (body.length > MAX_SKILL_BODY_CHARS)
    return {
      error: `Skill body is ${body.length} characters, over the ${MAX_SKILL_BODY_CHARS} limit. Split it into more than one skill.`,
    };

  const allowedRaw = meta["allowed-tools"];
  const allowedTools =
    allowedRaw === undefined
      ? undefined
      : Array.isArray(allowedRaw)
        ? allowedRaw
        : // A bare scalar is treated as a one-or-more comma-separated list, so
          // `allowed-tools: web_search` and `allowed-tools: [web_search]` agree.
          allowedRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);

  const fromPath = opts.path
    ? slugify(opts.path.split("/").filter(Boolean).slice(-2, -1)[0] ?? opts.path)
    : "";
  const id = fromPath || slugify(name);
  if (!id) return { error: "Could not derive an id from the skill name." };

  return {
    id,
    name,
    description,
    body,
    allowedTools,
    version: typeof meta.version === "string" ? meta.version : undefined,
    source: opts.source ?? "user",
    enabled: true,
    updatedAt: Date.now(),
  };
}

/** True when a parse returned an error rather than a skill. */
export function isParseError(r: Skill | SkillParseError): r is SkillParseError {
  return "error" in r;
}

/** Round-trip a Skill back to SKILL.md, for the editor and for export. */
export function toSkillMd(skill: Skill): string {
  const lines = [`name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.allowedTools) lines.push(`allowed-tools: [${skill.allowedTools.join(", ")}]`);
  if (skill.version) lines.push(`version: ${skill.version}`);
  return `---\n${lines.join("\n")}\n---\n\n${skill.body}\n`;
}
