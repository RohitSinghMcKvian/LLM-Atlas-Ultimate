"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

const Monaco = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-[#0b0d14] text-xs text-muted-foreground">
        Loading editor…
      </div>
    ),
  },
);

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

  return (
    <Monaco
      path={path}
      value={value}
      language={language}
      theme={resolvedTheme === "light" ? "atlas-light" : "atlas-dark"}
      onChange={(v) => onChange?.(v ?? "")}
      beforeMount={(monaco) => {
        monaco.editor.defineTheme("atlas-dark", {
          base: "vs-dark",
          inherit: true,
          rules: [
            { token: "comment", foreground: "8b91a3", fontStyle: "italic" },
            { token: "keyword", foreground: "a78bfa" },
            { token: "string", foreground: "34c799" },
            { token: "number", foreground: "f5a623" },
            { token: "type", foreground: "22d3ee" },
            { token: "function", foreground: "22d3ee" },
          ],
          colors: {
            "editor.background": "#0b0d14",
            "editor.foreground": "#e7e9ee",
            "editorLineNumber.foreground": "#3a3f50",
            "editorLineNumber.activeForeground": "#8b91a3",
            "editor.selectionBackground": "#22d3ee22",
            "editor.lineHighlightBackground": "#ffffff06",
            "editorCursor.foreground": "#22d3ee",
            "editorIndentGuide.background1": "#1b1e29",
            "editorGutter.background": "#0b0d14",
            "scrollbarSlider.background": "#ffffff10",
          },
        });
        monaco.editor.defineTheme("atlas-light", {
          base: "vs",
          inherit: true,
          rules: [{ token: "comment", foreground: "5a6172", fontStyle: "italic" }],
          colors: {
            "editor.background": "#ffffff",
            "editor.foreground": "#0c1018",
            "editorLineNumber.foreground": "#c2c8d4",
          },
        });
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
