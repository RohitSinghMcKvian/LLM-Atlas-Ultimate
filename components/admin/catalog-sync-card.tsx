"use client";

import * as React from "react";
import { Database, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { runCatalogSync, type SyncActionResult } from "@/app/(workspace)/admin/actions";
import { invalidateCatalogStatus, syncedAgo, useCatalogStatus } from "@/lib/hooks/use-catalog-status";
import { cn } from "@/lib/utils";

// Trigger a catalog refresh and read the result, without a shell.
//
// This card was a placeholder describing work that had not been done. The
// underlying capability was entirely there — `performSync()` behind a bearer
// secret and a daily cron — but there was no way for the operator to run one on
// demand, or to see whether the last one had been rejected by the sanity gates,
// short of `curl` with a secret pasted from `.env.local`.
//
// The button calls a server action, so `CATALOG_SYNC_SECRET` never reaches the
// browser and authorization is the admin's session rather than a shared token.

export function CatalogSyncCard() {
  const status = useCatalogStatus();
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<SyncActionResult | null>(null);

  async function sync() {
    setRunning(true);
    setResult(null);
    try {
      const r = await runCatalogSync();
      setResult(r);
      invalidateCatalogStatus();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "Sync failed." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="sm:col-span-2">
      <CardHeader>
        <Database className="size-4 text-muted-foreground" />
        <CardTitle className="text-base">Catalog sync</CardTitle>
        <CardDescription>
          Poll every provider now, and read what changed. Runs automatically every{" "}
          {status.intervalHours} hours, and on the first request after a snapshot
          goes stale.
        </CardDescription>
      </CardHeader>

      <div className="space-y-3 px-5 pb-5">
        <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          {status.loading ? (
            "Reading status…"
          ) : (
            <>
              <Badge variant={status.origin === "synced" ? "accent" : "amber"}>
                {status.origin === "synced" ? "Synced" : "Bundled catalog"}
              </Badge>
              {status.origin === "synced" && <span>{syncedAgo(status.syncedAt)}</span>}
              {status.stats && (
                <span className="tabular-nums">
                  {status.stats.models} models · {status.stats.free} free ·{" "}
                  {status.stats.deprecated} retiring
                </span>
              )}
            </>
          )}
        </div>

        <Button variant="primary" size="sm" onClick={sync} disabled={running}>
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Syncing…
            </>
          ) : (
            <>
              <RefreshCw className="size-4" /> Sync now
            </>
          )}
        </Button>

        {result && <SyncResult result={result} />}
      </div>
    </Card>
  );
}

function SyncResult({ result }: { result: SyncActionResult }) {
  if (result.error) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {result.error}
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-2/40 p-3 text-xs">
      <p className="flex flex-wrap items-center gap-2">
        <Badge variant={result.rejected ? "amber" : "accent"}>
          {result.rejected ? "Rejected" : "Applied"}
        </Badge>
        <span className="tabular-nums">{result.models} models</span>
        {Object.entries(result.sources ?? {}).map(([id, s]) => (
          <span
            key={id}
            className={cn(
              "font-mono text-2xs",
              s.status === "ok" ? "text-muted-foreground" : "text-amber",
            )}
          >
            {id}: {s.status}
            {s.status === "ok" ? ` (${s.count}${s.ms ? `, ${s.ms}ms` : ""})` : ""}
          </span>
        ))}
      </p>

      {(result.warnings ?? []).map((w) => (
        <p key={w} className="text-amber">
          {w}
        </p>
      ))}

      {result.diff && result.diff.length > 0 ? (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto">
          {result.diff.map((d) => (
            <li key={`${d.kind}-${d.modelId}`} className="text-muted-foreground">
              {d.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          Nothing changed — every provider answered and the catalog already
          matched. This is the steady state, not a failure.
        </p>
      )}
    </div>
  );
}
