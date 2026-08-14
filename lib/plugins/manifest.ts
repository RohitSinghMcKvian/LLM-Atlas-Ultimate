import { z } from "zod";
import { MAX_DESCRIPTION_CHARS, parseSkillMd, isParseError, type Skill } from "@/lib/skills/parse";
import { guardConnectorUrl } from "@/lib/mcp/url-guard";

/**
 * Plugin manifests (spec §4, Plugins).
 *
 * A plugin is not a new capability — it is a *bundle* of the ones P5 and P6
 * already built: some skills, some connectors, some settings, installed and
 * removed as one unit. Building it any other way would have meant a second
 * extension mechanism competing with those two.
 *
 * That framing decides the security posture. A plugin can contain instructions
 * the model follows (skills) and endpoints it will call (connectors), so
 * installing one is a trust decision at least as consequential as adding either
 * separately. Two rules follow, both enforced here rather than left to the UI:
 *
 *  1. **Everything inside is validated by the same parser that validates it
 *     standalone.** A skill in a plugin goes through `parseSkillMd`; a connector
 *     URL goes through `guardConnectorUrl`. A bundle is not a way in past a check.
 *  2. **A plugin never carries credentials.** No token field exists in the
 *     schema, so an installed connector starts unauthenticated and the user
 *     supplies its token themselves. A manifest that shipped a token would be
 *     asking the user to trust a credential they cannot see.
 */

export const PLUGIN_MANIFEST_VERSION = 1;
export const MAX_PLUGIN_SKILLS = 16;
export const MAX_PLUGIN_CONNECTORS = 8;

const idField = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits and hyphens");

const connectorSpec = z.object({
  id: idField,
  name: z.string().min(1).max(64),
  url: z.string().min(1),
  // Deliberately absent: any token/secret field. See the note above.
});

export const pluginManifestSchema = z.object({
  manifestVersion: z.literal(PLUGIN_MANIFEST_VERSION),
  id: idField,
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(MAX_DESCRIPTION_CHARS),
  version: z.string().max(32).optional(),
  author: z.string().max(64).optional(),
  homepage: z.string().max(300).optional(),
  /** SKILL.md documents, verbatim. Parsed with the standalone parser. */
  skills: z.array(z.string()).max(MAX_PLUGIN_SKILLS).default([]),
  connectors: z.array(connectorSpec).max(MAX_PLUGIN_CONNECTORS).default([]),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export interface PluginContents {
  manifest: Omit<PluginManifest, "skills" | "connectors">;
  skills: Skill[];
  connectors: { id: string; name: string; url: string }[];
}

export interface PluginError {
  error: string;
}

export function isPluginError<T>(r: T | PluginError): r is PluginError {
  return typeof r === "object" && r !== null && "error" in r;
}

/**
 * Parse and fully validate a manifest.
 *
 * Rejects with a message naming what is wrong and where — a plugin author
 * needs to know *which* skill failed, not that "the plugin is invalid".
 */
export function parsePluginManifest(raw: string): PluginContents | PluginError {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: "Plugin manifest is not valid JSON." };
  }

  const parsed = pluginManifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".") || "(root)";
    return { error: `${path}: ${issue.message}` };
  }
  const m = parsed.data;

  if (m.skills.length === 0 && m.connectors.length === 0) {
    return { error: "A plugin must contain at least one skill or connector." };
  }

  // Skills go through the standalone parser, so a bundle cannot smuggle in a
  // skill that would be rejected on its own.
  const skills: Skill[] = [];
  for (const [i, src] of m.skills.entries()) {
    const skill = parseSkillMd(src, { source: "user" });
    if (isParseError(skill)) return { error: `skills[${i}]: ${skill.error}` };
    skills.push(skill);
  }
  const skillIds = new Set<string>();
  for (const s of skills) {
    if (skillIds.has(s.id)) return { error: `Two skills share the id "${s.id}".` };
    skillIds.add(s.id);
  }

  // Connector URLs go through the same SSRF guard the proxy uses, so a plugin
  // cannot install a connector pointing at a private address.
  const connectors: PluginContents["connectors"] = [];
  const connectorIds = new Set<string>();
  for (const [i, c] of m.connectors.entries()) {
    const guard = guardConnectorUrl(c.url.trim());
    if (!guard.ok || !guard.url) {
      return { error: `connectors[${i}] (${c.id}): ${guard.reason ?? "invalid URL"}` };
    }
    if (connectorIds.has(c.id)) return { error: `Two connectors share the id "${c.id}".` };
    connectorIds.add(c.id);
    connectors.push({ id: c.id, name: c.name.trim(), url: guard.url.toString() });
  }

  const { skills: _s, connectors: _c, ...manifest } = m;
  void _s;
  void _c;
  return { manifest, skills, connectors };
}

export interface InstallConflict {
  kind: "skill" | "connector";
  id: string;
  /** What is already installed under that id. */
  existing: string;
}

/**
 * Find what an install would overwrite.
 *
 * Surfaced *before* installing rather than discovered afterwards. A plugin whose
 * skill id collides with one the user wrote would otherwise silently replace
 * their work, and uninstalling the plugin later would then delete something that
 * was never part of it.
 */
export function findConflicts(
  contents: PluginContents,
  installed: { skills: { id: string; name: string }[]; connectors: { id: string; name: string }[] },
): InstallConflict[] {
  const out: InstallConflict[] = [];
  for (const s of contents.skills) {
    const hit = installed.skills.find((x) => x.id === s.id);
    if (hit) out.push({ kind: "skill", id: s.id, existing: hit.name });
  }
  for (const c of contents.connectors) {
    const hit = installed.connectors.find((x) => x.id === c.id);
    if (hit) out.push({ kind: "connector", id: c.id, existing: hit.name });
  }
  return out;
}

/**
 * What an install will do, in plain language, for the confirmation step.
 *
 * The user is agreeing to instructions the model will follow and endpoints it
 * may call, so the summary names both counts explicitly rather than saying
 * "1 plugin".
 */
export function describeInstall(contents: PluginContents): string {
  const parts: string[] = [];
  if (contents.skills.length) {
    parts.push(
      `${contents.skills.length} skill${contents.skills.length === 1 ? "" : "s"} Atlas will follow`,
    );
  }
  if (contents.connectors.length) {
    parts.push(
      `${contents.connectors.length} connector${contents.connectors.length === 1 ? "" : "s"} Atlas may call`,
    );
  }
  return parts.join(" and ");
}
