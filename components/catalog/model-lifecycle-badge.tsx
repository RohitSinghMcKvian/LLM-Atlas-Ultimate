import { Archive, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isNewModel } from "@/lib/catalog";
import type { CatalogModel } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

// Where a model is in its life, as one badge.
//
// The daily sync already tracks all of this — `firstSeen` becomes `addedAt` the
// first time a provider lists a model, and two consecutive absences move it to
// `deprecated` and then delete it — but until now nothing rendered any of it.
// `isNewModel()` shipped with a test and zero callers, so a model appearing in
// Atlas the morning after NVIDIA published it looked exactly like one that had
// been there for a year.
//
// **Two dimensions, two channels.** Access (who pays) owns the hue: free is
// `accent`, bring-your-own-key is `action`. Lifecycle therefore cannot also own
// a hue without the two colliding on the same row, so it uses `amber` — the
// "something changed, look here" colour this app already reserves for temporal
// signals — and grey for the end of life. A row can carry one of each and still
// be readable.
//
// Everything here is derived from the model, so nothing needs clearing: a New
// badge expires on its own fourteen days after the provider first listed it.

/** How fresh a model has to be to earn a New badge. */
export const NEW_FOR_DAYS = 14;

function daysSince(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const when = Date.parse(iso);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, Math.floor((Date.now() - when) / 86_400_000));
}

function agePhrase(model: CatalogModel): string {
  const days = daysSince(model.addedAt ?? model.releaseDate);
  if (days === undefined) return "recently";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export interface ModelLifecycleBadgeProps {
  model: CatalogModel;
  /** Hide the word and keep only the icon, for dense rows. */
  compact?: boolean;
  className?: string;
}

/**
 * The lifecycle badge, or nothing at all.
 *
 * Renders `null` for the overwhelming majority of models — a GA model that has
 * been around a while is the unmarked default, and badging it would make the
 * badge meaningless everywhere else.
 */
export function ModelLifecycleBadge({ model, compact, className }: ModelLifecycleBadgeProps) {
  if (model.status === "deprecated") {
    return (
      <Badge
        variant="default"
        className={cn("gap-1", className)}
        title={`${model.name} is no longer served by any provider and is being removed from Atlas.`}
      >
        <Archive className="size-3" aria-hidden />
        {/* The visible word carries the meaning when it is there; the sr-only
            copy fills in only when `compact` has removed it. Rendering both
            unconditionally made a screen reader say "Retired Retired — no
            longer served by any provider". */}
        {compact ? (
          <span className="sr-only">Retired — no longer served by any provider</span>
        ) : (
          "Retired"
        )}
      </Badge>
    );
  }

  if (model.status === "upcoming") {
    return (
      <Badge
        variant="amber"
        className={cn("gap-1", className)}
        title={`${model.name} has been announced but no provider serves it yet.`}
      >
        <Clock className="size-3" aria-hidden />
        {compact ? (
          <span className="sr-only">Upcoming — announced, not yet servable</span>
        ) : (
          "Upcoming"
        )}
      </Badge>
    );
  }

  if (isNewModel(model, NEW_FOR_DAYS)) {
    return (
      <Badge
        variant="amber"
        className={cn("gap-1", className)}
        title={`Added to Atlas ${agePhrase(model)}, when a provider first listed it.`}
      >
        <Sparkles className="size-3" aria-hidden />
        {compact ? (
          <span className="sr-only">New — added {agePhrase(model)}</span>
        ) : (
          "New"
        )}
      </Badge>
    );
  }

  return null;
}
