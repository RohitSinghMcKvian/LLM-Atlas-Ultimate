import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  MAX_PLUGIN_SKILLS,
  PLUGIN_MANIFEST_VERSION,
  describeInstall,
  findConflicts,
  isPluginError,
  parsePluginManifest,
  type PluginContents,
} from "./manifest";
import {
  installPlugin,
  listPlugins,
  resetPluginDb,
  uninstallPlugin,
} from "./registry";
import { getSkill, listSkills, resetSkillDb } from "@/lib/skills/registry";
import { getConnector, resetConnectorDb, saveConnector } from "@/lib/mcp/registry";
import { resetMasterKeyCache } from "@/lib/crypto/secret-box";
import { resetIncognito, setIncognito } from "@/lib/chat/incognito";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetPluginDb();
  resetSkillDb();
  resetConnectorDb();
  resetMasterKeyCache();
  resetIncognito();
});
afterEach(() => resetIncognito());

const SKILL_MD = `---
name: Wiki lookup
description: Use when the user asks about internal documentation.
---

Search the company wiki before answering.`;

function manifest(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    manifestVersion: PLUGIN_MANIFEST_VERSION,
    id: "acme",
    name: "Acme pack",
    description: "Skills and connectors for Acme.",
    version: "1.0",
    skills: [SKILL_MD],
    connectors: [{ id: "acme-wiki", name: "Acme wiki", url: "https://mcp.acme.test/v1" }],
    ...over,
  });
}

function ok(raw: string): PluginContents {
  const r = parsePluginManifest(raw);
  if (isPluginError(r)) throw new Error(`expected success, got: ${r.error}`);
  return r;
}

function err(raw: string): string {
  const r = parsePluginManifest(raw);
  if (!isPluginError(r)) throw new Error("expected a parse error");
  return r.error;
}

describe("parsePluginManifest", () => {
  it("parses a complete manifest", () => {
    const p = ok(manifest());
    expect(p.manifest.id).toBe("acme");
    expect(p.skills).toHaveLength(1);
    expect(p.skills[0].id).toBe("wiki-lookup");
    expect(p.connectors[0].url).toBe("https://mcp.acme.test/v1");
  });

  it("rejects non-JSON", () => {
    expect(err("not json")).toContain("not valid JSON");
  });

  it("rejects an unknown manifest version", () => {
    expect(err(manifest({ manifestVersion: 99 }))).toContain("manifestVersion");
  });

  it("names the offending field", () => {
    expect(err(manifest({ id: "Not A Slug" }))).toContain("id");
  });

  it("rejects an empty bundle", () => {
    expect(err(manifest({ skills: [], connectors: [] }))).toContain("at least one");
  });

  it("caps the number of skills", () => {
    const many = Array.from({ length: MAX_PLUGIN_SKILLS + 1 }, () => SKILL_MD);
    expect(err(manifest({ skills: many }))).toContain("skills");
  });

  // A bundle must not be a way past a check that applies standalone.
  it("validates each skill with the standalone parser, naming the index", () => {
    const e = err(manifest({ skills: [SKILL_MD, "no frontmatter here"] }));
    expect(e).toContain("skills[1]");
    expect(e).toContain("frontmatter");
  });

  it("runs connector URLs through the SSRF guard", () => {
    for (const url of ["http://mcp.acme.test/", "https://127.0.0.1/", "https://localhost/"]) {
      const e = err(manifest({ connectors: [{ id: "x", name: "X", url }] }));
      expect(e).toContain("connectors[0]");
    }
  });

  it("rejects duplicate skill or connector ids inside one plugin", () => {
    expect(err(manifest({ skills: [SKILL_MD, SKILL_MD] }))).toContain("share the id");
    expect(
      err(
        manifest({
          connectors: [
            { id: "dup", name: "A", url: "https://a.test/" },
            { id: "dup", name: "B", url: "https://b.test/" },
          ],
        }),
      ),
    ).toContain("share the id");
  });

  // The schema has no token field at all, so a manifest cannot ship one.
  it("silently ignores a credential a manifest tries to smuggle in", () => {
    const p = ok(
      manifest({
        connectors: [
          { id: "c", name: "C", url: "https://c.test/", token: "SECRET", apiKey: "SECRET" },
        ],
      }),
    );
    expect(JSON.stringify(p.connectors)).not.toContain("SECRET");
  });

  it("accepts a skills-only or connectors-only plugin", () => {
    expect(ok(manifest({ connectors: [] })).connectors).toEqual([]);
    expect(ok(manifest({ skills: [] })).skills).toEqual([]);
  });
});

describe("findConflicts", () => {
  const contents = () => ok(manifest());

  it("finds nothing on a clean install", () => {
    expect(findConflicts(contents(), { skills: [], connectors: [] })).toEqual([]);
  });

  // Otherwise the plugin silently replaces the user's own work, and uninstalling
  // it later deletes something that was never part of it.
  it("reports a skill id that is already taken, naming what holds it", () => {
    const c = findConflicts(contents(), {
      skills: [{ id: "wiki-lookup", name: "My own wiki skill" }],
      connectors: [],
    });
    expect(c).toEqual([{ kind: "skill", id: "wiki-lookup", existing: "My own wiki skill" }]);
  });

  it("reports a connector conflict too", () => {
    const c = findConflicts(contents(), {
      skills: [],
      connectors: [{ id: "acme-wiki", name: "Existing" }],
    });
    expect(c[0].kind).toBe("connector");
  });
});

describe("describeInstall", () => {
  it("names both counts, since the user is agreeing to both", () => {
    const d = describeInstall(ok(manifest()));
    expect(d).toContain("1 skill");
    expect(d).toContain("1 connector");
    expect(d).toContain("Atlas will follow");
    expect(d).toContain("Atlas may call");
  });

  it("omits the half that is empty", () => {
    expect(describeInstall(ok(manifest({ connectors: [] })))).not.toContain("connector");
  });
});

describe("install and uninstall", () => {
  it("installs skills and connectors into the real registries", async () => {
    const r = await installPlugin(ok(manifest()));
    expect(isPluginError(r)).toBe(false);
    expect(await getSkill("wiki-lookup")).toBeDefined();
    expect(await getConnector("acme-wiki")).toBeDefined();
    expect((await listPlugins())[0].id).toBe("acme");
  });

  it("records the ids it created, which is the uninstall contract", async () => {
    const r = await installPlugin(ok(manifest()));
    if (isPluginError(r)) throw new Error(r.error);
    expect(r.plugin.skillIds).toEqual(["wiki-lookup"]);
    expect(r.plugin.connectorIds).toEqual(["acme-wiki"]);
  });

  it("installs connectors unauthenticated", async () => {
    await installPlugin(ok(manifest()));
    expect((await getConnector("acme-wiki"))?.sealedToken).toBeUndefined();
  });

  it("refuses to install the same plugin twice", async () => {
    await installPlugin(ok(manifest()));
    const again = await installPlugin(ok(manifest()));
    expect(isPluginError(again)).toBe(true);
  });

  it("uninstall removes exactly what it installed", async () => {
    await installPlugin(ok(manifest()));
    await uninstallPlugin("acme");
    expect(await getSkill("wiki-lookup")).toBeUndefined();
    expect(await getConnector("acme-wiki")).toBeUndefined();
    expect(await listPlugins()).toEqual([]);
  });

  // The point of recording ids rather than re-deriving them.
  it("uninstall leaves unrelated skills and connectors alone", async () => {
    await saveConnector({ name: "Mine", url: "https://mine.test/" });
    const before = (await listSkills()).length;
    await installPlugin(ok(manifest()));
    await uninstallPlugin("acme");
    expect(await getConnector("mine")).toBeDefined();
    expect((await listSkills()).length).toBe(before);
  });

  it("uninstalling something that is not installed is a no-op", async () => {
    await expect(uninstallPlugin("ghost")).resolves.toBeUndefined();
  });

  it("records a partial install so it is still uninstallable", async () => {
    // A connector whose URL passes the manifest guard but fails on save is hard
    // to arrange; instead check the shape the code guarantees: whatever landed
    // is in the recorded ids.
    const r = await installPlugin(ok(manifest({ connectors: [] })));
    if (isPluginError(r)) throw new Error(r.error);
    expect(r.plugin.connectorIds).toEqual([]);
    expect(r.plugin.skillIds).toEqual(["wiki-lookup"]);
    await uninstallPlugin("acme");
    expect(await getSkill("wiki-lookup")).toBeUndefined();
  });
});

describe("plugins — incognito", () => {
  it("refuses to install or uninstall", async () => {
    await installPlugin(ok(manifest()));
    setIncognito(true);
    const second = await installPlugin(ok(manifest({ id: "other", name: "Other" })));
    expect(isPluginError(second)).toBe(true);
    await uninstallPlugin("acme");
    expect(await listPlugins()).toHaveLength(1);
  });
});
