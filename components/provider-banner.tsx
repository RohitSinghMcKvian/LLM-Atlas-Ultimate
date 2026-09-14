"use client";

import Link from "next/link";
import { KeyRound, Gift, ArrowRight } from "lucide-react";
import { PROVIDER_LIST } from "@/lib/catalog";
import { isEasyFreeLane } from "@/lib/catalog/free-tier-copy";
import { useKeysStore } from "@/lib/store/keys-store";

/**
 * Shown when no provider key is available, so nothing can run yet.
 *
 * Rewritten for the thirteen-lane world. It used to list every provider as an
 * external doc link and tell the user to bring an OpenRouter key — both now
 * wrong: thirteen links is a wall rather than a choice, and OpenRouter is no
 * longer the only key that helps. The real answer is the Vault's connect
 * surface, so this points there and names only the handful of lanes that are
 * genuinely free to start (`isEasyFreeLane` excludes card-gated trials, which
 * are not what someone clicking "get free models" means).
 */
export function ProviderBanner() {
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const hasKey = useKeysStore((s) => s.keysPresent.length > 0);

  const easy = PROVIDER_LIST.filter(isEasyFreeLane);

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
              <Gift className="size-3.5" /> Several providers are free
            </span>{" "}
            — {easy.map((p) => p.name).join(", ")} all give a recurring free tier with
            no card. Connect any one of them and open models run immediately.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href="/vault"
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
            >
              <KeyRound className="size-3.5" />
              {hasKey ? "Manage your keys" : "Connect a provider"}
              <ArrowRight className="size-3.5" />
            </Link>

            <button
              onClick={() => setKeyModalOpen(true, "openrouter")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-border-strong"
            >
              Quick: paste an OpenRouter key
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
