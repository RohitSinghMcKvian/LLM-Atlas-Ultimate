/**
 * Routes that must be entered with a real document navigation.
 *
 * `/code` is cross-origin isolated: `next.config.mjs` sends
 * `Cross-Origin-Opener-Policy: same-origin` and
 * `Cross-Origin-Embedder-Policy: require-corp` for `/code/:path*`, which is what
 * gives the page `SharedArrayBuffer` and lets WebContainer boot the Node
 * runtime.
 *
 * Those are **document** headers. A client-side navigation does not fetch a new
 * document — it patches the one already on screen — so arriving at `/code` from
 * anywhere else left the page un-isolated with no way to recover except
 * `location.reload()`, which is exactly what `useCrossOriginIsolationReload()`
 * in `components/code/code-client.tsx` does.
 *
 * That recovery works, and it stays as the backstop for any entry path this set
 * misses. But it means the normal way in — clicking Code in the sidebar — costs
 * *two* page setups: the router fetches the RSC payload, downloads and parses
 * ~1.15 MB of route JS, hydrates, mounts the client, discovers it is not
 * isolated, and throws all of it away for a full reload that does the same work
 * again. Measured in the browser, `sameDoc: false` and `navType: "reload"`
 * after a single sidebar click.
 *
 * Linking straight to a document navigation makes it one load instead of two,
 * and removes the window in which the page renders un-isolated and the
 * workspace could settle on the in-memory fallback.
 */
const DOCUMENT_NAV_PREFIXES = ["/code"];

/** Whether `href` has to be entered by replacing the document. */
export function needsDocumentNav(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  return DOCUMENT_NAV_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Navigate to `href`, replacing the document when that route requires it.
 *
 * For imperative callers (the command palette, keyboard shortcuts) that would
 * otherwise reach for `router.push`.
 */
export function navigateTo(href: string, push: (href: string) => void): void {
  if (needsDocumentNav(href) && typeof window !== "undefined") {
    window.location.assign(href);
    return;
  }
  push(href);
}
