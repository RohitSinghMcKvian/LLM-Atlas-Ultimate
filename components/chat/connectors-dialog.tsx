"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  deleteConnector,
  listConnectors,
  saveConnector,
  setConnectorEnabled,
  updateConnector,
  type Connector,
} from "@/lib/mcp/registry";
import { connectAndDiscover } from "@/lib/mcp/client";
import { isFailure, namespacedToolName } from "@/lib/mcp/protocol";
import { setRule, type ApprovalRule } from "@/lib/mcp/approval";
import { cn, timeAgo } from "@/lib/utils";

export function ConnectorsDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const [connectors, setConnectors] = React.useState<Connector[]>([]);
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    void listConnectors()
      .then(setConnectors)
      .catch(() => setConnectors([]));
    onChanged?.();
  }, [onChanged]);

  React.useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  async function add() {
    setError(null);
    setBusy("add");
    try {
      const saved = await saveConnector({ name, url, token: token || undefined });
      if ("error" in saved) {
        setError(saved.error);
        return;
      }
      // Connect immediately: a connector that saved but cannot be reached is a
      // problem the user should learn about now, not on their next message.
      const result = await connectAndDiscover(saved);
      if (isFailure(result)) {
        setError(result.error);
        reload();
        return;
      }
      setAdding(false);
      setName("");
      setUrl("");
      setToken("");
      reload();
    } finally {
      setBusy(null);
    }
  }

  async function reconnect(c: Connector) {
    setBusy(c.id);
    try {
      const result = await connectAndDiscover(c);
      if (isFailure(result)) setError(result.error);
      reload();
    } finally {
      setBusy(null);
    }
  }

  async function changeRule(c: Connector, toolName: string, rule: ApprovalRule) {
    await updateConnector(c.id, {
      approvals: setRule(c.approvals, namespacedToolName(c.id, toolName), rule),
    });
    reload();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="size-4 text-action" /> Connectors
          </DialogTitle>
          <DialogDescription>
            MCP servers Atlas can call tools on. Every call asks for your approval
            before it runs.
          </DialogDescription>
        </DialogHeader>

        {adding ? (
          <div className="space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name — e.g. Company wiki"
              className="h-9 w-full rounded-lg border border-border bg-surface-2/50 px-3 text-sm outline-none focus:border-action/40"
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
              spellCheck={false}
              className="h-9 w-full rounded-lg border border-border bg-surface-2/50 px-3 font-mono text-xs outline-none focus:border-action/40"
            />
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder="Access token (optional)"
              spellCheck={false}
              className="h-9 w-full rounded-lg border border-border bg-surface-2/50 px-3 font-mono text-xs outline-none focus:border-action/40"
            />
            <p className="text-2xs text-muted-foreground/70">
              The token is encrypted in this browser and sent only to this connector.
              It is never stored on an Atlas server.
            </p>
            {error && (
              <p className="flex items-start gap-1.5 text-2xs text-danger">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={add} disabled={!url.trim() || busy === "add"}>
                {busy === "add" && <Loader2 className="size-3.5 animate-spin" />}
                Connect
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <p className="text-2xs text-muted-foreground">
                {connectors.length === 0
                  ? "No connectors yet."
                  : `${connectors.filter((c) => c.enabled).length} of ${connectors.length} enabled.`}
              </p>
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => {
                  setError(null);
                  setAdding(true);
                }}
              >
                <Plus className="size-4" /> Add connector
              </Button>
            </div>

            {error && !adding && (
              <p className="flex items-start gap-1.5 text-2xs text-danger">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {error}
              </p>
            )}

            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {connectors.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "rounded-lg border bg-surface-2/40 px-3 py-2",
                    c.enabled ? "border-border" : "border-border/50 opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onChange={(e) => void setConnectorEnabled(c.id, e.target.checked).then(reload)}
                      aria-label={`Enable ${c.name}`}
                      className="size-3.5 accent-action"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                    <span className="text-2xs text-muted-foreground">
                      {c.tools.length} tool{c.tools.length === 1 ? "" : "s"}
                    </span>
                    {c.sealedToken && (
                      <span className="rounded bg-surface px-1.5 py-0.5 text-2xs text-muted-foreground">
                        authorised
                      </span>
                    )}
                    <span className="text-2xs text-muted-foreground/60">
                      {timeAgo(c.updatedAt)}
                    </span>
                    <button
                      onClick={() => void reconnect(c)}
                      title="Reconnect and refresh tools"
                      className="text-muted-foreground hover:text-action"
                    >
                      {busy === c.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => void deleteConnector(c.id).then(reload)}
                      title="Remove connector"
                    >
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-danger" />
                    </button>
                  </div>

                  <p className="mt-0.5 truncate pl-6 font-mono text-2xs text-muted-foreground/70">
                    {c.url}
                  </p>

                  {c.lastError && (
                    <p className="mt-1 pl-6 text-2xs text-danger">{c.lastError}</p>
                  )}

                  {c.tools.length > 0 && (
                    <details className="mt-1 pl-6">
                      <summary className="cursor-pointer text-2xs text-muted-foreground hover:text-foreground">
                        Tools and approvals
                      </summary>
                      <div className="mt-1 space-y-1">
                        {c.tools.map((t) => {
                          const key = namespacedToolName(c.id, t.name);
                          const rule = c.approvals[key] ?? "ask";
                          return (
                            <div key={t.name} className="flex items-center gap-2">
                              <code className="min-w-0 flex-1 truncate text-2xs">{t.name}</code>
                              <select
                                value={rule}
                                onChange={(e) =>
                                  void changeRule(c, t.name, e.target.value as ApprovalRule)
                                }
                                aria-label={`Approval for ${t.name}`}
                                className="rounded border border-border bg-surface px-1 py-0.5 text-2xs"
                              >
                                <option value="ask">Ask every time</option>
                                <option value="always">Always allow</option>
                                <option value="never">Never allow</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>

            <p className="text-2xs text-muted-foreground/70">
              A connector runs tools against your real accounts. Add only servers you
              trust — a connector can see the arguments Atlas sends it.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
