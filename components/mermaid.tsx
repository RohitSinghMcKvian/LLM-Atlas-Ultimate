"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

/** A design token as `#rrggbb`. Mermaid's theme takes literals only. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const parts = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return `#${parts
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Lazy-load + initialize Mermaid once, themed from the live design tokens.
 *
 * It used to be pinned to `theme: "dark"` with four hardcoded colours, one of
 * which (`#7c5cff`) matched nothing in the palette — so diagrams stayed dark on
 * the light theme and never matched the surface they sat on either way.
 *
 * Initialization is once-only by design (the promise is cached), so a diagram
 * rendered before a theme toggle keeps the old colours until remount. That is
 * the same trade the module already made and is worth the single init.
 */
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      const dark = document.documentElement.classList.contains("dark");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "neutral",
        fontFamily: "inherit",
        themeVariables: {
          background: "transparent",
          primaryColor: token("--surface-2", dark ? "#202225" : "#F0EFEC"),
          primaryBorderColor: token("--action", dark ? "#D9752F" : "#B0521A"),
          primaryTextColor: token("--foreground", dark ? "#E9E9EA" : "#17181A"),
          lineColor: token("--border-strong", dark ? "#3A3D42" : "#CFCCC7"),
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
          <Loader2 className="size-3.5 animate-spin text-action" /> Rendering diagram…
        </>
      )}
    </div>
  );
}
