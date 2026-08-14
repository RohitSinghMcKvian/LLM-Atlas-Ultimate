"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Magnetic } from "@/components/motion/magnetic";
import { ProviderIcon } from "@/components/auth/brand-icons";
import { enabledProviders, type AuthProviderId } from "@/lib/auth/providers";
import { signInWithProvider } from "@/lib/auth/actions";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * "Continue with…" row.
 *
 * Renders nothing when no provider is enabled, so a deployment that only wants
 * email sign-in gets a clean panel rather than an empty divider.
 *
 * A click hands off to the provider and the page navigates away, so the pending
 * state is never cleared on the success path — only on failure. The row locks
 * while a hand-off is in flight because a second click during the redirect
 * starts a competing OAuth flow, and the second one's `state` invalidates the
 * first's.
 */
export function ProviderButtons({
  next,
  onError,
  className,
}: {
  next?: string | null;
  onError: (message: string) => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const providers = React.useMemo(() => enabledProviders(), []);
  const [pending, setPending] = React.useState<AuthProviderId | null>(null);

  if (providers.length === 0) return null;

  async function start(id: AuthProviderId) {
    if (pending) return;
    setPending(id);
    const { error } = await signInWithProvider(id, next);
    if (error) {
      onError(error);
      setPending(null);
    }
    // No else: on success the browser is already leaving.
  }

  return (
    <div className={cn("space-y-2.5", className)} aria-busy={pending !== null}>
      {providers.map((p, i) => {
        const isPending = pending === p.id;
        return (
          <motion.div
            key={p.id}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.05 + i * 0.06 }}
          >
            <Magnetic strength={reduce ? 0 : 8} className="block w-full">
              <button
                type="button"
                onClick={() => start(p.id)}
                disabled={pending !== null}
                className={cn(
                  "group relative flex h-12 w-full items-center gap-3 rounded-xl border border-border",
                  "bg-surface-2/60 px-4 text-sm font-medium text-foreground",
                  "transition-all duration-200 hover:border-border-strong hover:bg-surface-3",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                  "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "active:scale-[0.99] disabled:cursor-not-allowed",
                  // Only the button being used dims its siblings, so it stays
                  // obvious which provider the redirect belongs to.
                  pending && !isPending && "opacity-40",
                )}
              >
                {isPending ? (
                  <Loader2 className="size-[18px] shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <ProviderIcon id={p.id} className="size-[18px] shrink-0" />
                )}
                <span>
                  {isPending ? `Opening ${p.label}…` : `Continue with ${p.label}`}
                </span>
              </button>
            </Magnetic>
          </motion.div>
        );
      })}
    </div>
  );
}

/** True when at least one provider is configured — for deciding on the divider. */
export function hasProviders(): boolean {
  return enabledProviders().length > 0;
}
