"use client";

import * as React from "react";
import { AlertTriangle, Package, Plug, Sparkles, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  describeInstall,
  findConflicts,
  isPluginError,
  parsePluginManifest,
  type InstallConflict,
  type PluginContents,
} from "@/lib/plugins/manifest";
import { installPlugin, listPlugins, uninstallPlugin, type InstalledPlugin } from "@/lib/plugins/registry";
import { listSkills } from "@/lib/skills/registry";
import { listConnectors } from "@/lib/mcp/registry";
import { timeAgo } from "@/lib/utils";

const TEMPLATE = `{
  "manifestVersion": 1,
  "id": "my-plugin",
  "name": "My plugin",
  "description": "What this bundle is for.",
  "skills": [
    "---\\nname: Example skill\\ndescription: Use when …\\n---\\n\\nInstructions here.\\n"
  ],
  "connectors": []
}`;

/**
 * Install and remove plugins.
 *
 * A plugin bundles skills (instructions Atlas will follow) and connectors
 * (endpoints it may call), so installing one is a trust decision — which is why
 * this is a two-step flow rather than a paste-and-go box. The manifest is parsed
 * and fully validated first, and what it will add is named in plain language,
 * with conflicts against what is already installed listed *before* the install
 * button appears. Nothing is written until that second click.
 *
 * There is no marketplace and no signature check. A manifest is trusted exactly
 * as far as the user trusts wherever they copied it from, and the dialog says so
 * rather than implying a review that does not exist.
 */
export function PluginsDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Fired after any install or uninstall, so the caller can refresh counts. */
  onChanged?: () => void;
}) {
  const [installed, setInstalled] = React.useState<InstalledPlugin[]>([]);
  const [raw, setRaw] = React.useState("");
  const [staged, setStaged] = React.useState<PluginContents | null>(null);
  const [conflicts, setConflicts] = React.useState<InstallConflict[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    void listPlugins()
      .then(setInstalled)
      .catch(() => setInstalled([]));
    onChanged?.();
  }, [onChanged]);

  React.useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  async function review() {
    setError(null);
    setNote(null);
    const parsed = parsePluginManifest(raw);
    if (isPluginError(parsed)) {
      setStaged(null);
      setError(parsed.error);
      return;
    }
    const [skills, connectors] = await Promise.all([listSkills(), listConnectors()]);
    setConflicts(findConflicts(parsed, { skills, connectors }));
    setStaged(parsed);
  }

  async function confirm() {
    if (!staged) return;
    const r = await installPlugin(staged);
    if (isPluginError(r)) {
      setError(r.error);
      return;
    }
    setStaged(null);
    setRaw("");
    setError(null);
    // A partial install is reported rather than smoothed over: the plugin is
    // recorded for what landed, and the rest did not happen.
    setNote(
      r.failures.length
        ? `Installed "${r.plugin.name}", but ${r.failures.length} item(s) failed: ${r.failures.join("; ")}`
        : `Installed "${r.plugin.name}".`,
    );
    reload();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-4 text-accent" /> Plugins
          </DialogTitle>
          <DialogDescription>
            A plugin bundles skills and connectors, installed and removed as one unit.
            Paste a manifest to review what it would add.
          </DialogDescription>
        </DialogHeader>

        {staged ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-accent/40 bg-accent/[0.06] px-3 py-2.5">
              <p className="text-sm font-medium">{staged.manifest.name}</p>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                {staged.manifest.description}
              </p>
              <p className="mt-2 text-xs">
                Installs {describeInstall(staged)}.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {staged.skills.map((s) => (
                  <li key={s.id} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <Sparkles className="size-3 shrink-0 text-amber" />
                    {s.name}
                    {s.allowedTools && (
                      <span>
                        — {s.allowedTools.length === 0 ? "no tools" : s.allowedTools.join(", ")}
                      </span>
                    )}
                  </li>
                ))}
                {staged.connectors.map((c) => (
                  <li key={c.id} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <Plug className="size-3 shrink-0 text-action" />
                    {c.name} — {c.url}
                  </li>
                ))}
              </ul>
            </div>

            {conflicts.length > 0 && (
              <div className="rounded-lg border border-danger/40 bg-danger/[0.06] px-3 py-2 text-2xs text-danger">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="size-3.5" /> This will replace what you already have:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {conflicts.map((c) => (
                    <li key={`${c.kind}:${c.id}`}>
                      {c.kind} <code>{c.id}</code> — currently &ldquo;{c.existing}&rdquo;
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  Uninstalling this plugin later will remove them.
                </p>
              </div>
            )}

            <p className="text-2xs text-muted-foreground">
              Skills are instructions Atlas will follow, and connectors are endpoints it may
              call. Install only what you trust — nothing here has been reviewed or signed.
              Connectors arrive unauthenticated; you supply their credentials yourself.
            </p>

            {error && (
              <p className="flex items-start gap-1.5 text-2xs text-danger">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStaged(null)}>
                Back
              </Button>
              <Button size="sm" onClick={confirm}>
                Install plugin
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="max-h-[32vh] space-y-1.5 overflow-y-auto">
              {installed.length === 0 && (
                <p className="text-2xs text-muted-foreground">No plugins installed.</p>
              )}
              {installed.map((p) => (
                <div key={p.id} className="group rounded-lg border border-border bg-surface-2/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    {p.version && (
                      <span className="rounded bg-surface px-1.5 py-0.5 text-2xs text-muted-foreground">
                        v{p.version}
                      </span>
                    )}
                    <span className="text-2xs text-muted-foreground/60">
                      {timeAgo(p.installedAt)}
                    </span>
                    <button
                      onClick={() => void uninstallPlugin(p.id).then(reload)}
                      title="Uninstall, removing exactly what it installed"
                      aria-label={`Uninstall ${p.name}`}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-danger" />
                    </button>
                  </div>
                  <p className="mt-1 text-2xs text-muted-foreground">{p.description}</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground/70">
                    {p.skillIds.length} skill{p.skillIds.length === 1 ? "" : "s"},{" "}
                    {p.connectorIds.length} connector{p.connectorIds.length === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>

            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              spellCheck={false}
              rows={8}
              placeholder={TEMPLATE}
              aria-label="Plugin manifest"
              className="w-full resize-none rounded-lg border border-border bg-surface-2/50 px-3 py-2 font-mono text-xs outline-none focus:border-action/40"
            />

            {error && (
              <p className="flex items-start gap-1.5 text-2xs text-danger">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {error}
              </p>
            )}
            {note && <p className="text-2xs text-action">{note}</p>}

            <div className="flex justify-end">
              <Button size="sm" onClick={review} disabled={!raw.trim()}>
                Review manifest
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
