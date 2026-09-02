"use client";

import * as React from "react";
import type { PluggableList } from "unified";
import { needsHighlight, needsMath } from "@/lib/markdown/plugin-needs";

/**
 * The two expensive rehype plugins, fetched only when the text needs them.
 *
 * Measured on the production build, `rehype-katex` drags in KaTeX at **258 KB**
 * and `rehype-highlight` drags in lowlight/highlight.js inside a **325 KB**
 * markdown chunk. Both were static imports in `components/markdown.tsx`, which
 * five routes import — Chat, Compare, Playground, Code and Learn each paid the
 * full ~580 KB before their first paint, whether or not a single message on
 * screen contained a formula or a fenced code block. Most do not contain
 * either; almost none contain both.
 *
 * So the plugins are chosen per render, from the text itself — see
 * `lib/markdown/plugin-needs.ts` for the predicates and why they are shaped
 * the way they are.
 *
 * ### The upgrade pass
 *
 * The first render of a document that needs a plugin happens without it, and a
 * second render follows once the chunk lands. Nothing is held back in between,
 * because the in-between state is one this component already shows constantly:
 * `streaming` has always skipped highlighting, and a formula arrives through
 * the stream one delimiter at a time regardless. A frame of flat code colour or
 * of visible `$$` is what every message looks like while it is being written.
 *
 * Both promises are module-level, so the second `<Markdown>` on a page reuses
 * the first one's fetch, and a document that needs a plugin the session has
 * already loaded renders with it on its *first* pass — no upgrade at all.
 */

type Plugin = PluggableList[number];

let highlightPromise: Promise<Plugin> | null = null;
let highlightPlugin: Plugin | null = null;

let katexPromise: Promise<Plugin> | null = null;
let katexPlugin: Plugin | null = null;

function loadHighlight(): Promise<Plugin> {
  highlightPromise ??= import("rehype-highlight").then((m) => {
    highlightPlugin = m.default as Plugin;
    return highlightPlugin;
  });
  return highlightPromise;
}

function loadKatex(): Promise<Plugin> {
  katexPromise ??= Promise.all([
    import("rehype-katex"),
    // The stylesheet is 24 KB and is useless without the plugin, so it travels
    // with it rather than sitting in every route's CSS.
    import("katex/dist/katex.min.css"),
  ]).then(([m]) => {
    katexPlugin = m.default as Plugin;
    return katexPlugin;
  });
  return katexPromise;
}

export function useMarkdownPlugins(text: string, streaming: boolean): PluggableList {
  const wantsHighlight = !streaming && needsHighlight(text);
  const wantsMath = needsMath(text);

  // Bumped when a plugin lands, to pull the loaded value into this render.
  const [, bump] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (!wantsHighlight || highlightPlugin) return;
    let live = true;
    void loadHighlight().then(() => {
      if (live) bump();
    });
    return () => {
      live = false;
    };
  }, [wantsHighlight]);

  React.useEffect(() => {
    if (!wantsMath || katexPlugin) return;
    let live = true;
    void loadKatex().then(() => {
      if (live) bump();
    });
    return () => {
      live = false;
    };
  }, [wantsMath]);

  // The plugin refs are module-scoped and change without React knowing, so the
  // `bump` above is what re-runs this; listing them as dependencies is what
  // makes the memo pick up the new values when it does.
  return React.useMemo(() => {
    const plugins: PluggableList = [];
    if (wantsHighlight && highlightPlugin) plugins.push(highlightPlugin);
    if (wantsMath && katexPlugin) plugins.push(katexPlugin);
    return plugins;
  }, [wantsHighlight, wantsMath]);
}
