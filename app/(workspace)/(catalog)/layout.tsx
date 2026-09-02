import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";

/**
 * The catalog boundary — every route beneath here reads the model catalog.
 *
 * A route group, so none of this shows up in a URL: `/chat` is still `/chat`.
 * What it buys is a *segment* the router can cache, and the right set of routes
 * inside it.
 *
 * The install used to be repeated by all fourteen pages that show models. Each
 * one serialized the whole snapshot into its own RSC payload — ~11 KB gzipped
 * per route on the bundled 97-model baseline, several times that on a live
 * synced catalog — so the sidebar's `prefetch={true}` on seventeen modules
 * fetched the same catalog over and over, and every navigation fetched it
 * again. Hoisting it to a shared layout collapses that to one copy that the
 * router keeps: measured on the production build, navigating between the
 * dynamic catalog routes fell from ~13 KB to ~2 KB.
 *
 * It is deliberately *not* the workspace layout. Five routes show no models at
 * all — `/docs`, `/datasets`, `/notebooks`, `/prompt`, `/admin` — and hoisting
 * that far would have made each of them carry a catalog they never read, which
 * measured as a straight +11 KB on routes that were previously the cheapest in
 * the app. This group is exactly the set that reads it.
 *
 * The mechanism is otherwise unchanged: a server read handed to a client
 * component that installs the pointer in its render body, before any page below
 * renders — so SSR and hydration still agree on which models exist, with no
 * mismatch and no swap-in flash.
 */
export default async function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const snapshot = await getCatalogSnapshot();
  return <CatalogScope snapshot={snapshot}>{children}</CatalogScope>;
}
