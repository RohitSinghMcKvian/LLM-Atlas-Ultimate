"use client";

import { PLUGINS, del, get, getAll, idbAvailable, openChatDb, put } from "@/lib/chat/idb";
import { isIncognito } from "@/lib/chat/incognito";
import { deleteSkill, saveSkillMd } from "@/lib/skills/registry";
import { toSkillMd } from "@/lib/skills/parse";
import { deleteConnector, saveConnector } from "@/lib/mcp/registry";
import {
  isPluginError,
  parsePluginManifest,
  type PluginContents,
  type PluginError,
} from "./manifest";

/**
 * Installed plugins.
 *
 * The record exists for exactly one reason: **an uninstall must be able to undo
 * precisely what the install did, and nothing more.** So the record stores the
 * ids it created, not the manifest it came from. Re-deriving them from a stored
 * manifest at uninstall time would remove whatever currently holds those ids —
 * including a skill the user has since rewritten, or a connector they added
 * themselves that happened to collide.
 *
 * Installs are also recorded item by item as they succeed, so a failure halfway
 * through leaves a record of what actually landed rather than a claim about what
 * was intended.
 */

export interface InstalledPlugin {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  homepage?: string;
  /** Ids this install created. The uninstall contract. */
  skillIds: string[];
  connectorIds: string[];
  installedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openChatDb().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export function resetPluginDb(): void {
  dbPromise = null;
}

async function ready(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  try {
    return await db();
  } catch {
    return null;
  }
}

export async function listPlugins(): Promise<InstalledPlugin[]> {
  const d = await ready();
  if (!d) return [];
  try {
    return (await getAll<InstalledPlugin>(d, PLUGINS)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return [];
  }
}

export async function getPlugin(id: string): Promise<InstalledPlugin | undefined> {
  const d = await ready();
  if (!d) return undefined;
  try {
    return await get<InstalledPlugin>(d, PLUGINS, id);
  } catch {
    return undefined;
  }
}

export interface InstallResult {
  plugin: InstalledPlugin;
  /** Items that failed to install. The plugin is still recorded for the rest. */
  failures: string[];
}

/**
 * Install a validated plugin.
 *
 * Not transactional — IndexedDB cannot span the three stores this touches in one
 * transaction, and pretending otherwise would be worse than admitting it. What
 * it does instead is record each item as it lands, so a partial install is
 * *uninstallable*: whatever succeeded is in `skillIds`/`connectorIds` and comes
 * back out cleanly.
 */
export async function installPlugin(
  contents: PluginContents,
): Promise<InstallResult | PluginError> {
  if (isIncognito()) return { error: "Plugins cannot be installed in a temporary chat." };
  const d = await ready();
  if (!d) return { error: "Local storage is unavailable, so the plugin was not installed." };

  const existing = await get<InstalledPlugin>(d, PLUGINS, contents.manifest.id);
  if (existing) return { error: `"${existing.name}" is already installed.` };

  const skillIds: string[] = [];
  const connectorIds: string[] = [];
  const failures: string[] = [];

  for (const skill of contents.skills) {
    const saved = await saveSkillMd(toSkillMd(skill), { id: skill.id });
    if ("error" in saved) failures.push(`skill ${skill.id}: ${saved.error}`);
    else skillIds.push(saved.id);
  }

  for (const c of contents.connectors) {
    // No token: an installed connector starts unauthenticated and the user
    // supplies its credentials themselves.
    const saved = await saveConnector({ id: c.id, name: c.name, url: c.url });
    if ("error" in saved) failures.push(`connector ${c.id}: ${saved.error}`);
    else connectorIds.push(saved.id);
  }

  if (skillIds.length === 0 && connectorIds.length === 0) {
    return { error: `Nothing could be installed. ${failures.join("; ")}` };
  }

  const plugin: InstalledPlugin = {
    ...contents.manifest,
    skillIds,
    connectorIds,
    installedAt: Date.now(),
  };
  await put(d, PLUGINS, plugin);
  return { plugin, failures };
}

/**
 * Remove a plugin and exactly the items it installed.
 *
 * Reads the recorded ids rather than re-deriving them, so an item the user has
 * since replaced under the same id is still removed — that is the contract they
 * agreed to at install time — but nothing outside the recorded set is touched.
 */
export async function uninstallPlugin(id: string): Promise<void> {
  if (isIncognito()) return;
  const d = await ready();
  if (!d) return;
  const plugin = await get<InstalledPlugin>(d, PLUGINS, id);
  if (!plugin) return;

  for (const skillId of plugin.skillIds) await deleteSkill(skillId);
  // Deleting the connector takes its sealed tokens and approval rules with it,
  // so a plugin reinstalled later starts from "ask" rather than inheriting
  // permissions granted to the previous install.
  for (const connectorId of plugin.connectorIds) await deleteConnector(connectorId);

  await del(d, PLUGINS, id);
}

/** Parse, then install, in one step for the UI. */
export async function installFromManifest(
  raw: string,
): Promise<InstallResult | PluginError> {
  const contents = parsePluginManifest(raw);
  if (isPluginError(contents)) return contents;
  return installPlugin(contents);
}
