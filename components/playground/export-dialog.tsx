"use client";

import * as React from "react";
import { Check, Copy, Code2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toCurl, toTypeScript, toPython } from "@/lib/playground/export-code";
import type { PlaygroundConfig } from "@/lib/playground/types";
import { getModelById } from "@/lib/catalog";
import { cn } from "@/lib/utils";

type Lang = "curl" | "typescript" | "python";

export function ExportDialog({
  open,
  onOpenChange,
  config,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: PlaygroundConfig;
}) {
  const [lang, setLang] = React.useState<Lang>("curl");
  const [modelId, setModelId] = React.useState(config.models[0] ?? "");
  const [copied, setCopied] = React.useState(false);

  // Track the model list as it changes while the dialog is closed.
  React.useEffect(() => {
    if (!config.models.includes(modelId)) setModelId(config.models[0] ?? "");
  }, [config.models, modelId]);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  const code = React.useMemo(() => {
    if (!modelId) return "// Select at least one model.";
    if (lang === "curl") return toCurl(config, modelId, origin);
    if (lang === "python") return toPython(config, modelId, origin);
    return toTypeScript(config, modelId, origin);
  }, [config, modelId, lang, origin]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code2 className="size-4 text-cyan" /> Export as code
          </DialogTitle>
          <DialogDescription>
            Reproduce this exact run against the Atlas Router — messages,
            parameters, and tools included. Variables are rendered in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5 text-xs">
            {(["curl", "typescript", "python"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={cn(
                  "rounded-md px-2.5 py-1 capitalize",
                  lang === l && "bg-surface shadow-sm",
                )}
              >
                {l === "curl" ? "cURL" : l === "typescript" ? "TypeScript" : "Python"}
              </button>
            ))}
          </div>
          {config.models.length > 1 && (
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="h-8 rounded-lg border border-border bg-surface-2/60 px-2 text-xs outline-none"
            >
              {config.models.map((id) => (
                <option key={id} value={id}>
                  {getModelById(id)?.name ?? id}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-cyan/40 hover:text-foreground"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-success" /> Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" /> Copy
              </>
            )}
          </button>
        </div>

        <pre className="max-h-[50vh] overflow-auto rounded-xl border border-border bg-[#0b0d14] p-4 font-mono text-[12px] leading-relaxed text-foreground/90">
          {code}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
