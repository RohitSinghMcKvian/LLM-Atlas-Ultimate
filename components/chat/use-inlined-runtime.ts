"use client";

import * as React from "react";
import {
  inlineRuntimeScripts,
  needsInlineRuntime,
  runtimeFilesIn,
  runtimeUrl,
} from "@/lib/chat/artifact-runtime-inline";

/**
 * Module-level so the ~3MB React/Babel set is fetched once per session rather
 * than once per artifact. Keyed by absolute URL, so two origins never share an
 * entry. Promises are cached, not just results, so two artifacts mounting in the
 * same tick issue one request between them.
 */
const cache = new Map<string, Promise<string | null>>();

function load(url: string): Promise<string | null> {
  let hit = cache.get(url);
  if (!hit) {
    hit = fetch(url)
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null);
    cache.set(url, hit);
  }
  return hit;
}

/**
 * An artifact document with its runtime spliced in, when the origin requires it.
 *
 * On a public origin this returns its input unchanged and never touches the
 * network — production keeps the `<script src>` path exactly as it is. On a
 * private origin (localhost, a LAN IP, `*.local`) the opaque-origin frame cannot
 * fetch anything from Atlas at all, so the parent reads the files and hands them
 * over as inline script bodies. See `lib/chat/artifact-runtime-inline.ts` for why.
 *
 * The input document is returned while the fetch is in flight and if it fails.
 * Rendering with linked tags is the status quo — broken on a private origin, but
 * broken in the way the error bridge already reports — whereas rendering nothing
 * would turn a slow first load into a blank panel.
 */
export function useInlinedRuntime(doc: string, origin: string): string {
  const enabled = needsInlineRuntime(origin);
  const files = React.useMemo(
    () => (enabled && doc ? runtimeFilesIn(doc) : []),
    [enabled, doc],
  );
  // Joined, so the effect keys on *which* files rather than on a fresh array
  // identity every render.
  const key = files.join(",");
  const [sources, setSources] = React.useState<ReadonlyMap<string, string>>(new Map());

  React.useEffect(() => {
    if (!key) return;
    let alive = true;
    void (async () => {
      const wanted = key.split(",");
      const loaded = await Promise.all(wanted.map((f) => load(runtimeUrl(origin, f))));
      if (!alive) return;
      const next = new Map<string, string>();
      wanted.forEach((f, i) => {
        const code = loaded[i];
        if (code != null) next.set(f, code);
      });
      // Only re-render when something actually arrived: an all-failed fetch must
      // not swap one identical document for another.
      if (next.size) setSources(next);
    })();
    return () => {
      alive = false;
    };
  }, [key, origin]);

  return React.useMemo(
    () => (enabled && doc ? inlineRuntimeScripts(doc, sources) : doc),
    [enabled, doc, sources],
  );
}
