"use server";

import { revalidatePath } from "next/cache";
import { performSync } from "@/lib/catalog/store";
import { requireAdmin } from "@/lib/auth/session";

// The admin catalog-sync trigger.
//
// A server action rather than a fetch to `/api/v1/catalog/sync`, because that
// route is protected by `CATALOG_SYNC_SECRET` and the only way to call it from
// the browser would be to hand the browser the secret. `performSync()` is what
// that route calls anyway; the difference is that the caller here is proven to
// be an admin by the session rather than by a shared bearer token.

export interface SyncActionResult {
  ok: boolean;
  error?: string;
  syncedAt?: string;
  models?: number;
  /** Whether the sanity gates rejected the run and kept the previous catalog. */
  rejected?: boolean;
  warnings?: string[];
  sources?: Record<string, { status: string; count: number; ms?: number }>;
  diff?: { kind: string; modelId: string; detail: string }[];
}

export async function runCatalogSync(): Promise<SyncActionResult> {
  // Redirects rather than returning for a non-admin, which is the behaviour we
  // want: this is a real authorization check on the action itself, not a hint
  // from the UI that rendered the button. It matters here more than usual —
  // `(workspace)/admin/layout.tsx` currently has its own `requireAdmin()` call
  // commented out, so middleware is the only other gate.
  await requireAdmin();

  try {
    const record = await performSync();
    const rejected = record.warnings.some((w) => w.includes("keeping the previous catalog"));

    revalidatePath("/admin");
    return {
      ok: !rejected,
      rejected,
      syncedAt: record.syncedAt,
      models: record.models.length,
      warnings: record.warnings,
      sources: Object.fromEntries(
        Object.entries(record.sources).map(([id, r]) => [
          id,
          { status: r?.status ?? "skipped", count: r?.count ?? 0, ms: r?.ms },
        ]),
      ),
      // Capped: a first sync against an empty previous can produce hundreds.
      diff: record.diff.slice(0, 40),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sync failed." };
  }
}
