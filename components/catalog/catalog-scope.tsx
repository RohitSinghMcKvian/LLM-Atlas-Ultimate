"use client";

import * as React from "react";
import { announce } from "@/lib/atlas-events";
import { installSnapshot, type CatalogSnapshot } from "@/lib/catalog/snapshot";

// Hands a server-rendered snapshot to the client catalog.
//
// The install happens in the render body, *before* `children` render. React runs
// a component's body before the tree it returns, so every catalog consumer below
// this point — during SSR and during hydration — reads the same object the server
// serialized. That is what makes the swap free of hydration mismatches and free
// of the content flash a post-mount fetch would cause.
//
// `installSnapshot` is idempotent and monotonic, so StrictMode's double render is
// a no-op and a client that already fetched something newer keeps it.

export function CatalogScope({
  snapshot,
  children,
}: {
  snapshot: CatalogSnapshot;
  children: React.ReactNode;
}) {
  installSnapshot(snapshot);

  useAnnounceCatalogUpdate(snapshot);

  return <>{children}</>;
}

/** Tell assistive tech when the catalog changes under the user. */
function useAnnounceCatalogUpdate(snapshot: CatalogSnapshot): void {
  const announced = React.useRef(snapshot.version);

  React.useEffect(() => {
    if (announced.current === snapshot.version) return;
    announced.current = snapshot.version;

    const added = snapshot.diff.filter((d) => d.kind === "new_model").length;
    announce(
      added > 0
        ? `Model catalog updated — ${snapshot.stats.models} models, ${added} new.`
        : `Model catalog updated — ${snapshot.stats.models} models.`,
    );
  }, [snapshot]);
}
