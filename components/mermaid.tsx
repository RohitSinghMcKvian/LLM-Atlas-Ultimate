"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

/** Lazy-load + initialize Mermaid once, themed for the dark surface. */
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark",
        fontFamily: "inherit",
        themeVariables: {
          background: "transparent",
          primaryColor: "#0f1420",
          primaryBorderColor: "#22d3ee",
          primaryTextColor: "#e6edf3",
          lineColor: "#7c5cff",
          fontSize: "13px",
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let seq = 0;

/**
 * Render a Mermaid diagram. Tolerant of streaming: renders whenever the source
 * parses, and quietly keeps the last good SVG (or the raw source) otherwise, so
 * a half-streamed diagram never flashes an error.
 */
export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = React.useState<string>("");
  const [state, setState] = React.useState<"idle" | "loading" | "error">("loading");
  const idRef = React.useRef(`mmd-${seq++}`);

  React.useEffect(() => {
    let cancelled = false;
    const src = code.trim();
    if (!src) return;
    setState((s) => (svg ? s : "loading"));

    loadMermaid()
      .then(async (mermaid) => {
        try {
          await mermaid.parse(src); // throws on incomplete/invalid source
          const { svg: out } = await mermaid.render(`${idRef.current}-${seq++}`, src);
          if (!cancelled) {
            setSvg(out);
            setState("idle");
          }
        } catch {
          // Incomplete while streaming, or genuinely invalid. Keep last good SVG.
          if (!cancelled && !svg) setState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (svg) {
    return (
      <div
        className="my-4 flex justify-center overflow-x-auto rounded-xl border border-border bg-surface/50 p-4 [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  return (
    <div className="my-4 flex items-center gap-2 rounded-xl border border-border bg-surface/50 px-4 py-3 text-xs text-muted-foreground">
      {state === "error" ? (
        <>
          <AlertTriangle className="size-3.5 text-amber" /> Couldn&apos;t render diagram
        </>
      ) : (
        <>
          <Loader2 className="size-3.5 animate-spin text-cyan" /> Rendering diagram…
        </>
      )}
    </div>
  );
}
