import type { Skill } from "./parse";

/**
 * Progressive disclosure for skills (spec §4, Skills).
 *
 * The whole point of a skill is that installing it is cheap. Only `name` and
 * `description` sit in the system prompt; the body loads when the model decides
 * a turn calls for it. Ten installed skills should cost ten lines, not ten
 * documents — `disclosureRatio` below exists so that claim is measurable rather
 * than asserted, and it is what the unit tests assert against.
 *
 * **Inference label:** Anthropic documents that skills use progressive
 * disclosure and that the description drives invocation, but not the exact
 * prompt wording or the loading mechanism. The `skill` tool with `list`/`load`
 * commands is this implementation's choice — the alternative, injecting bodies
 * on a keyword match, would make loading implicit and unauditable, and the model
 * could not tell the user which skill it followed.
 */

/** The always-in-context index: names and descriptions, never bodies. */
export function skillsIndexBlock(skills: Skill[]): string {
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return "";
  const lines = enabled
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => `- ${s.id}: ${s.name} — ${s.description}`);
  return (
    "Skills available to you. Each is a set of instructions you can load when a " +
    "task matches its description. Call the `skill` tool with the skill's id to " +
    "read it BEFORE starting that kind of task, and then follow it. Do not guess " +
    "at a skill's contents from its description.\n" +
    lines.join("\n")
  );
}

/**
 * Render a loaded skill for the model.
 *
 * The tool restriction is stated in the text as well as enforced in
 * `executeTool`, because a model told only by an error message after the fact
 * wastes a round discovering a boundary it could have been given up front.
 */
export function renderSkill(skill: Skill): string {
  const header = [`# ${skill.name}`, skill.version ? `_version ${skill.version}_` : ""]
    .filter(Boolean)
    .join("\n");
  const tools = skill.allowedTools
    ? skill.allowedTools.length === 0
      ? "\n\nWhile following this skill, use no tools."
      : `\n\nWhile following this skill, you may use only these tools: ${skill.allowedTools.join(", ")}.`
    : "";
  return `${header}\n\n${skill.body}${tools}`;
}

/**
 * How much of the installed skill text stays out of context until needed.
 *
 * 0 means the index costs as much as the bodies (no saving); approaching 1 means
 * nearly all of it is deferred. Returns 0 for an empty set so callers never see
 * a divide-by-zero NaN.
 */
export function disclosureRatio(skills: Skill[]): number {
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return 0;
  const full = enabled.reduce((n, s) => n + s.name.length + s.description.length + s.body.length, 0);
  if (full === 0) return 0;
  const index = skillsIndexBlock(enabled).length;
  return Math.max(0, 1 - index / full);
}
