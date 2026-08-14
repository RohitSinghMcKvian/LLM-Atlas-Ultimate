import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  builtinSkills,
  deleteSkill,
  getSkill,
  listEnabledSkills,
  listSkills,
  resetSkillDb,
  restoreBuiltinSkills,
  saveSkillMd,
  setSkillEnabled,
} from "./registry";
import { BUILTIN_SKILL_SOURCES } from "./builtin";
import { isParseError, parseSkillMd } from "./parse";
import { skillsIndexBlock, renderSkill, disclosureRatio } from "./disclosure";
import { resetIncognito, setIncognito } from "@/lib/chat/incognito";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetSkillDb();
  resetIncognito();
});
afterEach(() => resetIncognito());

const CUSTOM = `---
name: Meeting notes
description: Use when the user pastes a transcript and wants it summarised.
allowed-tools: []
---

Summarise decisions, owners and dates. Nothing else.`;

describe("built-in skills", () => {
  // A malformed built-in would be silently skipped at runtime to keep the app
  // usable. This is what turns that into a failure.
  it("every shipped source parses", () => {
    for (const src of BUILTIN_SKILL_SOURCES) {
      const r = parseSkillMd(src, { source: "builtin" });
      expect(isParseError(r) ? r.error : "").toBe("");
    }
  });

  it("ships at least one and they all have unique ids", () => {
    const b = builtinSkills();
    expect(b.length).toBeGreaterThan(0);
    expect(new Set(b.map((s) => s.id)).size).toBe(b.length);
  });

  it("marks them as builtin and enabled", () => {
    for (const s of builtinSkills()) {
      expect(s.source).toBe("builtin");
      expect(s.enabled).toBe(true);
    }
  });
});

describe("registry", () => {
  it("seeds the built-ins on first read", async () => {
    const all = await listSkills();
    expect(all.length).toBe(builtinSkills().length);
  });

  it("installs a user skill alongside them", async () => {
    const saved = await saveSkillMd(CUSTOM);
    expect(isParseError(saved)).toBe(false);
    const all = await listSkills();
    expect(all.map((s) => s.id)).toContain("meeting-notes");
  });

  it("returns the parse error verbatim so the editor can show it", async () => {
    const r = await saveSkillMd("no frontmatter here");
    expect(isParseError(r)).toBe(true);
    if (isParseError(r)) expect(r.error).toContain("frontmatter");
  });

  it("does not install a skill that failed to parse", async () => {
    const before = (await listSkills()).length;
    await saveSkillMd("garbage");
    expect((await listSkills()).length).toBe(before);
  });

  it("toggles enabled state and it survives a re-read", async () => {
    const id = builtinSkills()[0].id;
    await setSkillEnabled(id, false);
    expect((await getSkill(id))?.enabled).toBe(false);
    expect((await listEnabledSkills()).map((s) => s.id)).not.toContain(id);
  });

  // Re-seeding on every start would silently undo a deliberate change.
  it("re-seeding does not resurrect a disabled built-in", async () => {
    const id = builtinSkills()[0].id;
    await setSkillEnabled(id, false);
    resetSkillDb(); // simulate a page reload
    expect((await getSkill(id))?.enabled).toBe(false);
  });

  it("re-seeding does not overwrite an edited built-in", async () => {
    const id = builtinSkills()[0].id;
    await saveSkillMd(`---\nname: Edited\ndescription: My own version.\n---\n\nMine.`, { id });
    resetSkillDb();
    const after = await getSkill(id);
    expect(after?.body).toBe("Mine.");
    expect(after?.source).toBe("user");
  });

  it("restoreBuiltinSkills explicitly overwrites an edited built-in", async () => {
    const id = builtinSkills()[0].id;
    await saveSkillMd(`---\nname: Edited\ndescription: My own version.\n---\n\nMine.`, { id });
    await restoreBuiltinSkills();
    const after = await getSkill(id);
    expect(after?.body).not.toBe("Mine.");
    expect(after?.source).toBe("builtin");
  });

  // Renaming must not silently change which skill the model was told about.
  it("editing keeps the original id even when the name changes", async () => {
    await saveSkillMd(CUSTOM);
    await saveSkillMd(`---\nname: Renamed entirely\ndescription: Still the same skill.\n---\n\nBody.`, {
      id: "meeting-notes",
    });
    expect((await getSkill("meeting-notes"))?.name).toBe("Renamed entirely");
    expect(await getSkill("renamed-entirely")).toBeUndefined();
  });

  it("editing preserves a disabled state rather than re-enabling", async () => {
    await saveSkillMd(CUSTOM);
    await setSkillEnabled("meeting-notes", false);
    await saveSkillMd(`---\nname: Meeting notes\ndescription: Updated.\n---\n\nNew body.`, {
      id: "meeting-notes",
    });
    expect((await getSkill("meeting-notes"))?.enabled).toBe(false);
  });

  it("deletes a skill", async () => {
    await saveSkillMd(CUSTOM);
    await deleteSkill("meeting-notes");
    expect(await getSkill("meeting-notes")).toBeUndefined();
  });

  it("sorts by name so the list is stable across renders", async () => {
    await saveSkillMd(CUSTOM);
    const names = (await listSkills()).map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("registry — incognito", () => {
  it("refuses to install a skill", async () => {
    setIncognito(true);
    const r = await saveSkillMd(CUSTOM);
    expect(isParseError(r)).toBe(true);
    expect(await getSkill("meeting-notes")).toBeUndefined();
  });

  it("refuses to toggle or delete", async () => {
    const id = builtinSkills()[0].id;
    await listSkills(); // seed first
    setIncognito(true);
    await setSkillEnabled(id, false);
    await deleteSkill(id);
    expect((await getSkill(id))?.enabled).toBe(true);
  });

  it("still reads, so installed skills stay usable in a temporary chat", async () => {
    await listSkills();
    setIncognito(true);
    expect((await listEnabledSkills()).length).toBeGreaterThan(0);
  });
});

describe("progressive disclosure", () => {
  it("index is empty when nothing is enabled", () => {
    expect(skillsIndexBlock([])).toBe("");
  });

  // The whole premise of skills: installing one is cheap.
  it("index carries descriptions but never bodies", () => {
    const s = builtinSkills();
    const block = skillsIndexBlock(s);
    for (const skill of s) {
      expect(block).toContain(skill.description);
      expect(block).not.toContain(skill.body);
    }
  });

  it("index lists ids, since that is what the tool takes", () => {
    const block = skillsIndexBlock(builtinSkills());
    for (const s of builtinSkills()) expect(block).toContain(s.id);
  });

  it("excludes disabled skills", () => {
    const [first, ...rest] = builtinSkills();
    const block = skillsIndexBlock([{ ...first, enabled: false }, ...rest]);
    expect(block).not.toContain(first.description);
  });

  // Measured, not asserted: the built-in set must actually defer most of itself.
  it("defers the large majority of installed skill text", () => {
    expect(disclosureRatio(builtinSkills())).toBeGreaterThan(0.6);
  });

  it("returns 0 rather than NaN for an empty set", () => {
    expect(disclosureRatio([])).toBe(0);
  });
});

describe("renderSkill", () => {
  it("includes the name and body", () => {
    const s = builtinSkills()[0];
    const out = renderSkill(s);
    expect(out).toContain(s.name);
    expect(out).toContain(s.body);
  });

  // Told up front as well as enforced, so the model doesn't spend a round
  // discovering the boundary through an error.
  it("states a tool restriction in the text", () => {
    const s = { ...builtinSkills()[0], allowedTools: ["web_search"] };
    expect(renderSkill(s)).toContain("only these tools: web_search");
  });

  it("states an empty restriction as 'no tools'", () => {
    const s = { ...builtinSkills()[0], allowedTools: [] };
    expect(renderSkill(s)).toContain("use no tools");
  });

  it("says nothing about tools when unrestricted", () => {
    const s = { ...builtinSkills()[0], allowedTools: undefined };
    expect(renderSkill(s)).not.toContain("While following this skill");
  });
});
