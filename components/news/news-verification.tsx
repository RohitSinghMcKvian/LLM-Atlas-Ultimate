"use client";

import * as React from "react";
import { CircleHelp, Newspaper, ShieldCheck, Users, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { verificationPresentation } from "@/lib/news/format";
import { isNegativeSignal, signalLabel } from "@/lib/news/sync/verify";
import type { NewsArticle, Verification, VerificationLevel } from "@/lib/news/types";
import { cn } from "@/lib/utils";

// How Atlas states what it knows about a story's provenance.
//
// The rule this file exists to enforce: the badge is never colour alone. Every
// level has a distinct icon AND a text label AND an `sr-only` sentence spelling
// out what it means — a reader who cannot distinguish green from amber, or who
// cannot hover, gets exactly the same information.
//
// And the claim is always about provenance, never truth. "Verified" here means
// "published on the source's own domain", not "accurate".

const LEVEL_ICON: Record<VerificationLevel, typeof ShieldCheck> = {
  verified: ShieldCheck,
  corroborated: Users,
  reported: Newspaper,
  unconfirmed: CircleHelp,
};

export function VerificationBadge({
  verification,
  article,
  compact,
  className,
}: {
  verification: Verification;
  article: Pick<NewsArticle, "host" | "brand">;
  compact?: boolean;
  className?: string;
}) {
  const presentation = verificationPresentation(
    verification.level,
    verification.distinctDomains,
  );
  const Icon = LEVEL_ICON[verification.level];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={presentation.badge}
          className={cn("gap-1 backdrop-blur-sm", compact && "px-2 py-0 text-2xs", className)}
        >
          <Icon className={compact ? "size-3" : "size-3.5"} aria-hidden="true" />
          <span>{compact ? presentation.short : presentation.label}</span>
          {/* Never colour alone, and never hover alone. */}
          <span className="sr-only">. {presentation.description}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">{presentation.label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{presentation.description}</p>
        <ul className="mt-2 space-y-0.5">
          {verification.signals.slice(0, 4).map((signal) => (
            <li key={signal} className="flex items-start gap-1.5 text-2xs">
              {isNegativeSignal(signal) ? (
                <X className="mt-px size-3 shrink-0 text-amber" aria-hidden="true" />
              ) : (
                <Check className="mt-px size-3 shrink-0 text-success" aria-hidden="true" />
              )}
              <span className="text-muted-foreground">{signalLabel(signal, article)}</span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The full evidence panel, shown in the deep dive.
 *
 * Every signal is listed with a check or a cross and a plain-English sentence,
 * so a reader can disagree with the verdict on the evidence rather than having
 * to trust it.
 */
export function VerificationPanel({
  verification,
  article,
}: {
  verification: Verification;
  article: Pick<NewsArticle, "host" | "brand" | "domain">;
}) {
  const presentation = verificationPresentation(
    verification.level,
    verification.distinctDomains,
  );
  const Icon = LEVEL_ICON[verification.level];

  return (
    <section
      className="rounded-2xl border border-border bg-surface-2/50 p-4"
      aria-labelledby="verification-heading"
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 id="verification-heading" className="font-display text-sm font-semibold">
          {presentation.label}
        </h2>
        <span className="ml-auto font-mono text-2xs text-muted-foreground tnum">
          {verification.distinctDomains} domain
          {verification.distinctDomains === 1 ? "" : "s"} · {verification.corroboration} source
          {verification.corroboration === 1 ? "" : "s"}
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{presentation.description}</p>

      <ul className="mt-3 space-y-1.5">
        {verification.signals.map((signal) => {
          const negative = isNegativeSignal(signal);
          return (
            <li key={signal} className="flex items-start gap-2 text-xs">
              {negative ? (
                <X className="mt-0.5 size-3.5 shrink-0 text-amber" aria-hidden="true" />
              ) : (
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
              )}
              <span className={negative ? "text-amber" : "text-muted-foreground"}>
                {signalLabel(signal, article)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The standing disclosure.
 *
 * Deliberately plain and permanently visible rather than tucked behind an info
 * icon. A feature that stamps "Verified" on things owes the reader an unglamorous
 * sentence about what that word does and does not mean.
 */
export function VerificationDisclosure({ className }: { className?: string }) {
  return (
    <p className={cn("text-2xs leading-relaxed text-muted-foreground", className)}>
      Atlas reports <strong className="font-medium text-foreground">provenance, not truth</strong>.
      Verification describes who published a story and on whose domain — never whether it is
      correct. Always read the source.
    </p>
  );
}
