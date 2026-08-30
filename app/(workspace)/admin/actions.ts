"use server";

import { getProfile, isAdminRole } from "@/lib/auth/session";
import { performSync } from "@/lib/catalog/store";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import type { CatalogDiffEntry, CatalogSourceResult } from "@/lib/catalog/snapshot";
import type { ProviderId } from "@/lib/catalog/types";

/**
 * Trigger a catalog sync from the admin UI.
 *
 * Calls `performSync()` in-process rather than POSTing to `/api/v1/catalog/sync`.
 * That route exists for Vercel Cron and CI, where the only available credential
 * is a bearer secret; reaching it from here would mean either shipping
 * `CATALOG_SYNC_SECRET` to the browser or self-fetching an absolute URL. A
 * server action needs neither — but it therefore has to carry its own gate,
 * because a server action is a public endpoint like any other.
 *
 * The gate mirrors the reasoning in `middleware.ts`: when Supabase is configured
 * the caller must actually hold the admin role, and when it is not configured
 * there are no accounts to hold any role, so the surface is refused outright
 * rather than left ungoverned. `middleware.ts` already redirects `/admin` away
 * in that second case; this is the matching server-side half, so the action
 * cannot be invoked directly by anyone who skips the page.
 */

export interface SyncResult {
  ok: boolean;
  /** Set when the sync could not be attempted at all. */
  error?: string;
  version?: string;
  syncedAt?: string;
  models?: number;
  free?: number;
  diff?: CatalogDiffEntry[];
  diffCount?: number;
  sources?: Partial<Record<ProviderId, CatalogSourceResult>>;
  warnings?: string[];
  /** The sanity gate ran and kept the previous catalog. */
  rejected?: boolean;
}

export async function syncCatalogAction(): Promise<SyncResult> {
  if (!isSupabaseServerConfigured()) {
    return {
      ok: false,
      error:
        "Supabase is not configured, so no account can hold the admin role. Configure Supabase to govern this action.",
    };
  }

  const profile = await getProfile();
  if (!profile || !isAdminRole(profile.role)) {
    return { ok: false, error: "Admin role required." };
  }

  try {
    const record = await performSync();
    // The route contract this mirrors: a tripped sanity gate is reported as a
    // 200 with `ok: false`, because the sync ran and deliberately declined to
    // install its result. Treating it as success would show "synced" over an
    // unchanged catalog.
    const rejected = record.warnings.some((w) =>
      w.includes("keeping the previous catalog"),
    );

    return {
      ok: !rejected,
      rejected,
      version: record.version,
      syncedAt: record.syncedAt,
      models: record.models.length,
      free: record.stats.free,
      diff: record.diff.slice(0, 25),
      diffCount: record.diff.length,
      sources: record.sources,
      warnings: record.warnings,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Sync failed.",
    };
  }
}
