"use client";

import * as React from "react";
import { Plus, Trash2, ShieldCheck, Webhook, FlaskConical } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCodeStore } from "@/lib/store/code-store";
import { useFlagsStore } from "@/lib/store/flags-store";
import { FLAG_DEFS, FLAG_IDS } from "@/lib/flags";
import {
  POLICY_TOOLS,
  describeHook,
  type PolicyDecision,
  type Hook,
} from "@/lib/code/policy";
import { cn } from "@/lib/utils";

const DECISION_STYLE: Record<PolicyDecision, string> = {
  allow: "text-success",
  ask: "text-amber",
  deny: "text-danger",
};

function Segmented({
  value,
  onChange,
}: {
  value: PolicyDecision;
  onChange: (d: PolicyDecision) => void;
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
      {(["allow", "ask", "deny"] as const).map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={cn(
            "px-2 py-1 text-2xs capitalize transition-colors",
            value === d
              ? cn("bg-surface-3 font-medium", DECISION_STYLE[d])
              : "text-muted-foreground hover:bg-surface-2",
          )}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function ConfigDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  // Field selectors, not the whole store: this dialog stays mounted while an
  // agent runs, and the store's trace/events churn every 48ms.
  const toolPolicy = useCodeStore((s) => s.toolPolicy);
  const hooks = useCodeStore((s) => s.hooks);
  const costCeilingUsd = useCodeStore((s) => s.costCeilingUsd);
  const setToolDecision = useCodeStore((s) => s.setToolDecision);
  const setHooks = useCodeStore((s) => s.setHooks);
  const setCostCeiling = useCodeStore((s) => s.setCostCeiling);

  const [event, setEvent] = React.useState<"pre" | "post">("post");
  const [toolMatch, setToolMatch] = React.useState("write_file|edit_file");
  const [ruleText, setRuleText] = React.useState("");

  function addHook() {
    const rule = ruleText.trim();
    const match = toolMatch.trim() || ".*";
    if (!rule) return;
    const hook: Hook = {
      id: uid(),
      enabled: true,
      event,
      toolMatch: match,
      ...(event === "pre" ? { pattern: rule } : { run: rule }),
    };
    setHooks([...hooks, hook]);
    setRuleText("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agent configuration</DialogTitle>
          <DialogDescription>
            Per-tool permissions and hooks — enforced on every tool call the agent makes.
          </DialogDescription>
        </DialogHeader>

        {/* Tool permissions */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Tool permissions
          </h3>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {POLICY_TOOLS.map((tool) => (
              <div key={tool} className="flex items-center justify-between gap-3 px-3 py-2">
                <code className="text-xs">{tool}</code>
                <Segmented
                  value={toolPolicy[tool] ?? "allow"}
                  onChange={(d) => setToolDecision(tool, d)}
                />
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            <span className="text-amber">ask</span> pauses the run for your approval;{" "}
            <span className="text-danger">deny</span> refuses the call and tells the agent why.
          </p>
        </section>

        {/* Hooks */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Webhook className="size-3.5" /> Hooks
          </h3>
          <div className="space-y-1.5">
            {hooks.length === 0 && (
              <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                No hooks. Add one below — e.g. run <code>npm test</code> after every edit.
              </p>
            )}
            {hooks.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"
              >
                <Switch
                  checked={h.enabled}
                  onCheckedChange={(v) =>
                    setHooks(hooks.map((x) => (x.id === h.id ? { ...x, enabled: v } : x)))
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate font-mono text-xs", !h.enabled && "opacity-50")}>
                    {describeHook(h)}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {h.event === "pre" ? "pre — blocks matching calls" : "post — output fed to the agent"}
                  </p>
                </div>
                <button
                  onClick={() => setHooks(hooks.filter((x) => x.id !== h.id))}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-danger"
                  title="Delete hook"
                  aria-label="Delete hook"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add hook */}
          <div className="mt-2 space-y-2 rounded-xl border border-border bg-surface-2/40 p-3">
            <div className="flex gap-1.5">
              {(
                [
                  ["post", "Run command after"],
                  ["pre", "Block call when"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setEvent(v)}
                  className={cn(
                    "rounded-lg border px-2 py-1 text-2xs",
                    event === v
                      ? "border-cyan/40 bg-surface-3 text-foreground"
                      : "border-border text-muted-foreground hover:bg-surface-2",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={toolMatch}
                onChange={(e) => setToolMatch(e.target.value)}
                placeholder="tool match, e.g. write_file|edit_file"
                className="h-8 flex-1 font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={ruleText}
                onChange={(e) => setRuleText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addHook()}
                placeholder={
                  event === "pre" ? "args regex, e.g. rm\\s+-rf" : "command, e.g. npm test"
                }
                className="h-8 flex-1 font-mono text-xs"
              />
              <Button size="sm" variant="secondary" onClick={addHook} disabled={!ruleText.trim()}>
                <Plus className="size-3.5" /> Add
              </Button>
            </div>
          </div>
        </section>

        {/* Cost guard (A.5) */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Cost ceiling
          </h3>
          <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">Abort a run past</span>
            <span className="text-xs">$</span>
            <Input
              type="number"
              min={0}
              step={0.05}
              value={costCeilingUsd || ""}
              onChange={(e) => setCostCeiling(Number(e.target.value) || 0)}
              placeholder="0 (off)"
              className="h-7 w-24 text-xs"
            />
            <span className="text-2xs text-muted-foreground">
              Subagents inherit the same ceiling.
            </span>
          </div>
        </section>

        {/* Labs (Depth v2 feature flags) */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <FlaskConical className="size-3.5" /> Labs
          </h3>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {FLAG_IDS.map((id) => {
              const def = FLAG_DEFS[id];
              return (
                <div key={id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs">{def.label}</p>
                    <p className="truncate text-2xs text-muted-foreground">{def.description}</p>
                  </div>
                  <FlagSwitch id={id} />
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Experimental depth features — each flips on independently and can be turned off at
            any time.
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function FlagSwitch({ id }: { id: (typeof FLAG_IDS)[number] }) {
  const on = useFlagsStore((s) => s.overrides[id] ?? FLAG_DEFS[id].defaultOn);
  const setFlag = useFlagsStore((s) => s.setFlag);
  return <Switch checked={on} onCheckedChange={(v) => setFlag(id, v)} />;
}
