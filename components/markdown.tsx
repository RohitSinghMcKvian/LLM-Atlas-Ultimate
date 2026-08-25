"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { Check, Copy, Hash } from "lucide-react";
import { MermaidBlock } from "@/components/mermaid";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";
// No highlight.js stylesheet. `github-dark.css` used to be imported here and
// the `.hljs-*` rules in globals.css then had to out-specify it, which is why
// code blocks stayed dark on the light theme. The token rules stand alone now.

function extractText(node: React.ReactNode): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node))
    return extractText((node.props as any).children);
  return "";
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const codeEl = React.Children.toArray(children)[0] as React.ReactElement | undefined;
  const className: string = (codeEl?.props as any)?.className ?? "";
  const lang = /language-(\w+)/.exec(className)?.[1] ?? "text";
  const text = extractText((codeEl?.props as any)?.children);
  const [copied, setCopied] = React.useState(false);
  const [nums, setNums] = React.useState(false);

  // Mermaid renders as a live diagram rather than a code block.
  if (lang === "mermaid") return <MermaidBlock code={text} />;

  const lineCount = text.replace(/\n$/, "").split("\n").length;

  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-border bg-code">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-2xs uppercase tracking-wide text-muted-foreground">
          {lang}
        </span>
        <div className="flex items-center gap-3">
          {lineCount > 1 && (
            <button
              onClick={() => setNums((n) => !n)}
              title="Toggle line numbers"
              className={cn(
                "inline-flex items-center gap-1 text-2xs transition-colors hover:text-foreground",
                nums ? "text-action" : "text-muted-foreground",
              )}
            >
              <Hash className="size-3" /> Lines
            </button>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? (
              <>
                <Check className="size-3 text-success" /> Copied
              </>
            ) : (
              <>
                <Copy className="size-3" /> Copy
              </>
            )}
          </button>
        </div>
      </div>
      <div className="flex overflow-x-auto">
        {nums && lineCount > 1 && (
          <pre
            aria-hidden
            className="select-none border-r border-border/60 py-4 pl-4 pr-3 text-right text-sm leading-relaxed text-muted-foreground/50"
          >
            {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
          </pre>
        )}
        <pre className="min-w-0 flex-1 p-4 text-sm leading-relaxed">
          <code className={className}>{(codeEl?.props as any)?.children}</code>
        </pre>
      </div>
    </div>
  );
}

export const Markdown = React.memo(function Markdown({
  children,
  className,
  streaming = false,
}: {
  children: string;
  className?: string;
  /**
   * While true, skip syntax highlighting (the expensive step) so re-rendering
   * a rapidly-growing code block stays smooth. The block is highlighted once
   * streaming completes.
   */
  streaming?: boolean;
}) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none prose-invert",
        "prose-headings:font-display prose-headings:tracking-tight",
        "prose-p:text-foreground/90 prose-li:text-foreground/90",
        "prose-a:text-action prose-a:no-underline hover:prose-a:underline",
        "prose-strong:text-foreground prose-code:text-action",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-transparent prose-pre:p-0",
        className,
      )}
    >
      <ReactMarkdown
        // `singleDollarTextMath: false` - remark-math's default treats a pair
        // of single `$` as inline math, which collides with the one thing
        // this whole product talks about constantly: prices. Found live, in
        // an answer quoting two catalog prices ("$0.16/M ... $0.35/M"): the
        // text between them was parsed as one LaTeX span and rendered as
        // squashed, italicised nonsense. `$$…$$` still works for real math;
        // a lone `$` now stays literal, which is what a price is.
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={streaming ? [rehypeKatex] : [rehypeHighlight, rehypeKatex]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock)
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            return (
              <code
                className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[0.85em] text-action"
                {...props}
              >
                {children}
              </code>
            );
          },
          a: ({ children, ...props }) => (
            <a target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
