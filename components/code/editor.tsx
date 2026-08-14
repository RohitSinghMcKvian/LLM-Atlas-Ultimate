"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

const Monaco = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-code text-xs text-muted-foreground">
        Loading editor…
      </div>
    ),
  },
);

/**
 * A design token as bare hex, no leading `#` — the form Monaco's `rules` want.
 * Reads whichever theme is currently on `<html>`.
 */
function hex(name: string): string {
  if (typeof window === "undefined") return "000000";
  const parts = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return "000000";
  return parts
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The editor theme, built from the live design tokens rather than a hand-kept
 * copy of them. The copy this replaces had drifted — its own greys, a cyan
 * cursor, and a light theme that defined three colours out of thirty, so light
 * mode fell back to stock `vs` for everything else.
 *
 * Syntax maps onto the same elevation bands as the highlight.js rules in
 * globals.css, so a snippet in chat and the same code in the editor match.
 */
function buildTheme(dark: boolean) {
  return {
    base: (dark ? "vs-dark" : "vs") as "vs-dark" | "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: hex("--muted-foreground"), fontStyle: "italic" },
      { token: "keyword", foreground: hex("--accent") },
      { token: "string", foreground: hex("--elev-2") },
      { token: "number", foreground: hex("--elev-3") },
      { token: "type", foreground: hex("--elev-0") },
      { token: "function", foreground: hex("--action") },
    ],
    colors: {
      "editor.background": `#${hex("--code")}`,
      "editor.foreground": `#${hex("--foreground")}`,
      "editorLineNumber.foreground": `#${hex("--border-strong")}`,
      "editorLineNumber.activeForeground": `#${hex("--muted-foreground")}`,
      "editor.selectionBackground": `#${hex("--action")}2e`,
      "editor.lineHighlightBackground": `#${hex("--surface-2")}`,
      "editorCursor.foreground": `#${hex("--action")}`,
      "editorIndentGuide.background1": `#${hex("--border")}`,
      "editorGutter.background": `#${hex("--code")}`,
      "editorWidget.background": `#${hex("--popover")}`,
      "editorWidget.border": `#${hex("--border-strong")}`,
      "scrollbarSlider.background": `#${hex("--border-strong")}80`,
    },
  };
}

export function CodeEditor({
  path,
  value,
  language,
  onChange,
}: {
  path: string;
  value: string;
  language: string;
  onChange?: (v: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const monacoRef = React.useRef<Parameters<
    NonNullable<React.ComponentProps<typeof Monaco>["beforeMount"]>
  >[0] | null>(null);
  const themeName = resolvedTheme === "light" ? "atlas-light" : "atlas-dark";

  // Only the tokens of the *active* theme are computable — `:root` and `.dark`
  // are not both live at once — so the theme is rebuilt on every toggle rather
  // than defined twice up front. Monaco allows redefining a name in place.
  React.useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    monaco.editor.defineTheme(themeName, buildTheme(resolvedTheme !== "light"));
    monaco.editor.setTheme(themeName);
  }, [themeName, resolvedTheme]);

  return (
    <Monaco
      path={path}
      value={value}
      language={language}
      theme={resolvedTheme === "light" ? "atlas-light" : "atlas-dark"}
      onChange={(v) => onChange?.(v ?? "")}
      beforeMount={(monaco) => {
        monacoRef.current = monaco;
        monaco.editor.defineTheme(
          themeName,
          buildTheme(resolvedTheme !== "light"),
        );
      }}
      options={{
        fontSize: 13,
        fontFamily: "var(--font-mono), 'JetBrains Mono', monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        renderLineHighlight: "all",
        padding: { top: 14, bottom: 14 },
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: false,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        overviewRulerLanes: 0,
        automaticLayout: true,
      }}
    />
  );
}
