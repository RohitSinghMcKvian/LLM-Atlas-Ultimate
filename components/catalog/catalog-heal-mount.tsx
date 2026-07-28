"use client";

import dynamic from "next/dynamic";

// The healer needs the catalog to decide what a dangling id should become, and
// it is mounted in the workspace layout — which every route parses. Importing it
// directly would put the whole model catalog in that chunk, the exact cost
// `components/shell/model-switcher.tsx` splits out. It renders nothing, so
// deferring it past hydration is free.
export const CatalogHeal = dynamic(
  () => import("./catalog-heal").then((m) => m.CatalogHeal),
  { ssr: false },
);
