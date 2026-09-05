"use client";

import * as React from "react";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  Check,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PROVIDERS } from "@/lib/catalog";
import type { CatalogDiffEntry } from "@/lib/catalog/snapshot";
import type { ProviderId } from "@/lib/catalog/types";
import { syncedAgo, useCatalogStatus } from "@/lib/hooks/use-catalog-status";
import { cn } from "@/lib/utils";

// What the daily provider sync actually did.
//
// The sync has always produced a `diff` — models added, prices moved, models
// retired — and shipped it to the browser on every catalog page. Its only
// consumer was a screen-reader announcement. So the app knew that NVIDIA had
// published four new models overnight and told nobody who could see.
//
// Two pieces here. `<SyncPill />` is the ambient one: how fresh the catalog is
// and whether each provider answered. `<CatalogUpdates />` is what it opens.

/* ------------------------------------------------------------------ */
/* The pill                                                            */
/* ------------------------------------------------------------------ */

export function SyncPill({ className }: { className?: string }) {
  const status = useCatalogStatus();
  const [open, setOpen] = React.useState(false);

  if (status.loading) {
    return (
      <span
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-2xs text-muted-foreground",
          className,
        )}
      >
        Checking catalog…
      </span>
    );
  }

  // The bundled catalog is not a sync result and must not wear a sync result's
  // clothes: no timestamp, no green tick, and a reason.
  if (status.origin === "baseline") {
    return (
      <span
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border border-amber/30 bg-amber/10 px-2.5 text-2xs text-amber",
          className,
        )}
        title="No provider key is configured, so Atlas is serving the model list bundled at build time."
      >
        <TriangleAlert className="size-3" aria-hidden />
        Bundled catalog
      </span>
    );
  }

  const added = status.diff.filter((d) => d.kind === "new_model").length;
  const failed = Object.values(status.sources).some((s) => s?.status === "failed");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-2xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground",
          className,
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            failed ? "bg-amber" : "bg-success",
          )}
        />
        Synced {syncedAgo(status.syncedAt)}
        {status.stats && <span className="tabular-nums">· {status.stats.models}</span>}
        {added > 0 && <span className="text-amber">· {added} new</span>}
      </button>
      <CatalogUpdates open={open} onOpenChange={setOpen} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The drawer                                                          */
/* ------------------------------------------------------------------ */

const KIND_META: Record<
  CatalogDiffEntry["kind"],
  { label: string; icon: typeof Sparkles; tone: string }
> = {
  new_model: { label: "Added", icon: Sparkles, tone: "text-amber" },
  price_change: { label: "Price changed", icon: TrendingDown, tone: "text-accent" },
  deprecation: { label: "Retired", icon: Archive, tone: "text-muted-foreground" },
};

export function CatalogUpdates({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useCatalogStatus();

  const groups = React.useMemo(() => {
    const by: Record<CatalogDiffEntry["kind"], CatalogDiffEntry[]> = {
      new_model: [],
      price_change: [],
      deprecation: [],
    };
    for (const d of status.diff) by[d.kind]?.push(d);
    return by;
  }, [status.diff]);

  const nothingChanged = status.diff.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(38rem,95vw)] max-w-none flex-col gap-0 overflow-hidden p-0" hideClose>
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-action/15 text-action">
            <RefreshCw className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold">Catalog updates</DialogTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Atlas polls every provider every {status.intervalHours} hours. Models
              they add appear here; models they retire are removed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* Provider health — the thing that explains an empty diff. */}
        <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
          {Object.entries(status.sources).map(([id, source]) => (
            <ProviderChip key={id} id={id as ProviderId} status={source?.status ?? "skipped"} count={source?.count ?? 0} />
          ))}
          <span className="ml-auto self-center text-2xs text-muted-foreground">
            Last synced {syncedAgo(status.syncedAt)}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {status.warnings.length > 0 && (
            <div className="mb-4 space-y-1.5">
              {status.warnings.map((w) => (
                <p
                  key={w}
                  className="flex items-start gap-2 rounded-xl border border-amber/30 bg-amber/10 px-3 py-2 text-xs"
                >
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber" aria-hidden />
                  {w}
                </p>
              ))}
            </div>
          )}

          {nothingChanged ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <Check className="mx-auto mb-2 size-5 text-success" aria-hidden />
              <p className="text-sm">Nothing changed in the last sync.</p>
              <p className="mx-auto mt-1 max-w-sm text-2xs text-muted-foreground">
                Every provider answered and the catalog matched what Atlas already
                had — the steady state, and the one most syncs reach.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {(["new_model", "price_change", "deprecation"] as const).map((kind) =>
                groups[kind].length === 0 ? null : (
                  <DiffGroup key={kind} kind={kind} entries={groups[kind]} />
                ),
              )}
            </div>
          )}

          {status.retired.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                Removed from Atlas
              </p>
              <ul className="space-y-1">
                {status.retired.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Archive className="size-3 shrink-0" aria-hidden />
                    <span className="truncate text-foreground">{r.name}</span>
                    <span className="shrink-0">· {RETIRE_REASON[r.reason]}</span>
                    {r.replacedBy && (
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <ArrowRight className="size-3" aria-hidden />
                        {r.replacedBy}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 text-2xs text-muted-foreground">
          <Link href="/leaderboard" className="text-action hover:underline">
            Browse the full catalog
          </Link>{" "}
          — retired models are hidden there by default, behind a “Show retired”
          toggle.
        </div>
      </DialogContent>
    </Dialog>
  );
}

const RETIRE_REASON: Record<string, string> = {
  delisted: "no longer served by any provider",
  expired: "retired upstream",
  replaced: "superseded",
  non_chat: "not a chat model",
};

function DiffGroup({
  kind,
  entries,
}: {
  kind: CatalogDiffEntry["kind"];
  entries: CatalogDiffEntry[];
}) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <section>
      <p className="mb-2 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className={cn("size-3.5", meta.tone)} aria-hidden />
        {meta.label}
        <span className="tabular-nums opacity-60">{entries.length}</span>
      </p>
      <ul className="space-y-1">
        {entries.map((d) => (
          <li
            key={`${d.kind}-${d.modelId}`}
            className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs"
          >
            {/* `detail` is written by the sync engine and already reads as a
                sentence — "Kimi K3 (Moonshot) added", "GPT-5 blended price down
                $8.50 → $6.00 /Mtok". Reformatting it here would mean two places
                deciding how a change is phrased. */}
            <span className="min-w-0 flex-1">{d.detail}</span>
            {kind === "price_change" && (
              <PriceDirection detail={d.detail} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Up or down, read off the sentence the sync engine wrote. */
function PriceDirection({ detail }: { detail: string }) {
  const down = detail.includes("price down");
  const Icon = down ? TrendingDown : TrendingUp;
  return (
    <Icon
      className={cn("mt-0.5 size-3.5 shrink-0", down ? "text-success" : "text-amber")}
      aria-label={down ? "cheaper" : "more expensive"}
    />
  );
}

function ProviderChip({
  id,
  status,
  count,
}: {
  id: ProviderId;
  status: "ok" | "failed" | "skipped";
  count: number;
}) {
  const name = PROVIDERS[id]?.short ?? id;
  if (status === "ok") {
    return (
      <Badge variant="accent" className="gap-1.5">
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {name} · {count}
      </Badge>
    );
  }
  return (
    <Badge
      variant={status === "failed" ? "amber" : "default"}
      className="gap-1.5"
      title={
        status === "failed"
          ? `${name} did not answer this sync — its models were carried forward unchanged.`
          : `${name} has no key configured.`
      }
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {name} · {status === "failed" ? "no answer" : "no key"}
    </Badge>
  );
}
