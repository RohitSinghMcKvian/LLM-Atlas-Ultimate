"use client";

import { SKILLS, del, get, getAll, idbAvailable, openChatDb, put, putMany } from "@/lib/chat/idb";
import { isIncognito } from "@/lib/chat/incognito";
import { BUILTIN_SKILL_SOURCES } from "./builtin";
import { isParseError, parseSkillMd, type Skill, type SkillParseError } from "./parse";

/**
 * Installed skills, stored in IndexedDB and keyed by id.
 *
 * Built-ins are parsed from their SKILL.md sources on first run and written in
 * alongside user skills rather than being merged at read time. That costs one
 * seeding pass and buys two things: a built-in can be disabled and stay disabled
 * across reloads, and there is exactly one place a skill can come from, so the
 * "which definition won" question never arises.
 *
 * What seeding does NOT do is overwrite. A built-in the user has edited or
 * disabled stays that way when the app reloads — re-seeding on every start would
 * silently undo their change, which is the kind of behaviour that makes people
 * stop trusting a settings screen.
 */

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openChatDb().catch((e) => {
      // A transient failure (a blocked upgrade in another tab) should be retried
      // next call, not cached forever.
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** Test seam: drop the memoized connection. */
export function resetSkillDb(): void {
  dbPromise = null;
  seeded = null;
}

let seeded: Promise<void> | null = null;

/** Parse the shipped skills. Exported so a test can assert they are valid. */
export function builtinSkills(): Skill[] {
  const out: Skill[] = [];
  for (const src of BUILTIN_SKILL_SOURCES) {
    const parsed = parseSkillMd(src, { source: "builtin" });
    // A malformed built-in is a bug in this repo, not a user error. Skipping it
    // keeps the app usable; the test suite is what turns it into a failure.
    if (!isParseError(parsed)) out.push(parsed);
  }
  return out;
}

/** Write any built-in that isn't installed yet. Never overwrites. */
async function seedBuiltins(d: IDBDatabase): Promise<void> {
  const existing = await getAll<Skill>(d, SKILLS);
  const have = new Set(existing.map((s) => s.id));
  const missing = builtinSkills().filter((s) => !have.has(s.id));
  if (missing.length) await putMany(d, SKILLS, missing);
}

async function ready(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  let d: IDBDatabase;
  try {
    d = await db();
  } catch {
    return null;
  }
  if (!seeded) {
    seeded = seedBuiltins(d).catch(() => {
      seeded = null;
    });
  }
  await seeded;
  return d;
}

/** Every installed skill, enabled or not. */
export async function listSkills(): Promise<Skill[]> {
  const d = await ready();
  if (!d) return [];
  try {
    return (await getAll<Skill>(d, SKILLS)).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Only the skills that should appear in the system-prompt index. */
export async function listEnabledSkills(): Promise<Skill[]> {
  return (await listSkills()).filter((s) => s.enabled);
}

export async function getSkill(id: string): Promise<Skill | undefined> {
  const d = await ready();
  if (!d) return undefined;
  try {
    return await get<Skill>(d, SKILLS, id);
  } catch {
    return undefined;
  }
}

/**
 * Install or replace a skill from SKILL.md text.
 *
 * Returns the parse error unchanged so the editor can show it verbatim. Writes
 * are blocked in incognito, like every other storage path in the app — a
 * temporary chat that installed a skill would outlive itself.
 */
export async function saveSkillMd(
  content: string,
  opts: { id?: string; source?: Skill["source"] } = {},
): Promise<Skill | SkillParseError> {
  const parsed = parseSkillMd(content, { source: opts.source });
  if (isParseError(parsed)) return parsed;
  if (isIncognito()) return { error: "Skills cannot be changed in a temporary chat." };

  const d = await ready();
  if (!d) return { error: "Local storage is unavailable, so the skill could not be saved." };

  // Editing keeps the original id even if the name changed, so the skill the
  // model was told about does not silently become a different one.
  const id = opts.id ?? parsed.id;
  const previous = await get<Skill>(d, SKILLS, id);
  if (previous && previous.source === "builtin" && opts.source !== "builtin") {
    // Editing a built-in is allowed, but the result is the user's skill from
    // then on — otherwise re-seeding logic and provenance disagree.
    parsed.source = "user";
  }
  const skill: Skill = {
    ...parsed,
    id,
    // A rename must not silently re-enable something the user turned off.
    enabled: previous?.enabled ?? parsed.enabled,
    updatedAt: Date.now(),
  };
  await put(d, SKILLS, skill);
  return skill;
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<void> {
  if (isIncognito()) return;
  const d = await ready();
  if (!d) return;
  const skill = await get<Skill>(d, SKILLS, id);
  if (!skill) return;
  await put(d, SKILLS, { ...skill, enabled, updatedAt: Date.now() });
}

export async function deleteSkill(id: string): Promise<void> {
  if (isIncognito()) return;
  const d = await ready();
  if (!d) return;
  await del(d, SKILLS, id);
}

/**
 * Reinstall the shipped skills, overwriting local edits to them.
 *
 * The explicit counterpart to seeding's never-overwrite rule: recovering a
 * built-in you have broken should be possible, but only when asked for.
 */
export async function restoreBuiltinSkills(): Promise<number> {
  if (isIncognito()) return 0;
  const d = await ready();
  if (!d) return 0;
  const builtins = builtinSkills();
  await putMany(d, SKILLS, builtins);
  return builtins.length;
}
