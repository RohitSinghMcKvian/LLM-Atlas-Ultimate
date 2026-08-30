"use client";

import * as React from "react";
import { Database, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { syncCatalogAction, type SyncResult } from "./actions";
import { PROVIDERS } from "@/lib/catalog/providers";
import type { ProviderId } from "@/lib/catalog/types";

/**
 * Trigger a catalog refresh and read the last run's diff without a shell.
 *
 * The sync itself is layered — Vercel Cron runs it daily and `getCatalogSnapshot`
 * refreshes in the background when a served snapshot goes stale — so this is the
 * operator's way to force one and *see the result*, which is otherwise only
 * visible as a date on the catalog page.
 */
export function CatalogSyncCard() {
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<SyncResult | null>(null);

  function run() {
    startTransition(async () => {
      setResult(await syncCatalogAction());
    });
  }

  return (
    <Card className="sm:col-span-2 lg:col-span-3">
      <CardHeader>
        <Database className="size-4 text-muted-foreground" />
        <CardTitle className="text-base">Catalog sync</CardTitle>
        <CardDescription>
          Pull the live model lists from NVIDIA NIM and OpenRouter, merge them over
          the curated baseline, and install the result.
        </CardDescription>
      </CardHeader>

      <div className="px-6 pb-6">
        <Button onClick={run} disabled={pending} size="sm" className="gap-2">
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {pending ? "Syncing…" : "Sync now"}
        </Button>

        {result && <SyncReport result={result} />}
      </div>
    </Card>
  );
}

function SyncReport({ result }: { result: SyncResult }) {
  // Three outcomes, not two. A tripped sanity gate returns `ok: false` with no
  // `error` — the sync ran and declined to install, which must not read as
  // either a success or a crash.
  if (result.error) {
    return (
      <p className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
        {result.error}
      </p>
    );
  }

  const sources = Object.entries(result.sources ?? {}) as [
    ProviderId,
    NonNullable<SyncResult["sources"]>[ProviderId],
  ][];

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={result.ok ? "success" : "warning"}>
          {result.ok ? "Synced" : "Kept previous catalog"}
        </Badge>
        {result.models !== undefined && (
          <span className="text-xs text-muted-foreground">
            {result.models} models · {result.free} free
          </span>
        )}
        {result.syncedAt && (
          <span className="text-xs text-muted-foreground">
            {new Date(result.syncedAt).toLocaleString()}
          </span>
        )}
      </div>

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sources.map(([id, s]) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-2 py-1 text-2xs"
            >
              <span
                className={
                  s?.status === "ok"
                    ? "size-1.5 rounded-full bg-success"
                    : s?.status === "failed"
                      ? "size-1.5 rounded-full bg-danger"
                      : "size-1.5 rounded-full bg-muted-foreground"
                }
              />
              {PROVIDERS[id]?.name ?? id}
              <span className="text-muted-foreground">
                {s?.status === "ok" ? `${s.count} models` : s?.status}
              </span>
            </span>
          ))}
        </div>
      )}

      {result.warnings && result.warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber/30 bg-amber/5 p-3 text-xs text-muted-foreground">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {result.diffCount !== undefined && (
        <div>
          <p className="text-xs font-medium">
            {result.diffCount === 0
              ? "No changes since the previous snapshot."
              : `${result.diffCount} change${result.diffCount === 1 ? "" : "s"}`}
          </p>
          {result.diff && result.diff.length > 0 && (
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border bg-surface-2/40 p-3">
              {result.diff.map((d) => (
                <li key={`${d.kind}:${d.modelId}`} className="flex gap-2 text-2xs">
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {d.kind.replace("_", " ")}
                  </span>
                  <span className="truncate">{d.detail}</span>
                </li>
              ))}
            </ul>
          )}
          {result.diffCount > (result.diff?.length ?? 0) && (
            <p className="mt-1.5 text-2xs text-muted-foreground">
              Showing the first {result.diff?.length} of {result.diffCount}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
