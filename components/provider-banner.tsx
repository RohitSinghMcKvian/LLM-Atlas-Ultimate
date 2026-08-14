"use client";

import { KeyRound, ExternalLink, Gift } from "lucide-react";
import { PROVIDER_LIST } from "@/lib/catalog";
import { useKeysStore } from "@/lib/store/keys-store";

/**
 * Shown when no operator provider key is configured (so free open models can't
 * run yet). Surfaces two paths: the operator can connect a free-tier key, OR
 * the user can bring their own OpenRouter key to run any model immediately.
 */
export function ProviderBanner() {
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const hasKey = useKeysStore((s) => s.keyPresent);

  return (
    <div className="rounded-2xl border border-amber/30 bg-amber/5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber/15 text-amber">
          <KeyRound className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">Connect a key to run live models</p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-success">
              <Gift className="size-3.5" /> Open models are free
            </span>{" "}
            once the operator connects a provider key. To run closed/paid models
            (GPT, Claude, Gemini, Grok…) bring your own OpenRouter key.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setKeyModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
            >
              <KeyRound className="size-3.5" />
              {hasKey ? "OpenRouter key connected" : "Connect your OpenRouter key"}
            </button>

            <span className="px-1 text-2xs text-muted-foreground">
              or operator free-tier:
            </span>

            {PROVIDER_LIST.map((p) => (
              <a
                key={p.id}
                href={p.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-border-strong"
              >
                {p.name}
                <ExternalLink className="size-3 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
