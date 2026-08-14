"use client";

import * as React from "react";
import { Check, Github, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { maskKey, useKeysStore } from "@/lib/store/keys-store";
import { useSettingsStore } from "@/lib/store/settings-store";

/**
 * GitHub access for the `github` tool.
 *
 * Two separate controls, deliberately: whether Atlas may read repositories at
 * all, and what it may read. Public repositories work with no token — so the
 * token field must not read as a prerequisite — while a token is what makes
 * private repositories and the higher rate limit reachable.
 *
 * The token is BYOK under §1.3: encrypted at rest by the same store as the
 * provider key, forwarded once per call as `x-github-token`, never stored
 * server-side. The dialog states the one thing a user cannot check for
 * themselves — that Atlas cannot write — since a PAT they paste may well carry
 * write scopes the route simply never uses.
 */
export function GithubDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const enabled = useSettingsStore((s) => s.github);
  const toggle = useSettingsStore((s) => s.toggle);
  const githubKey = useKeysStore((s) => s.githubKey);
  const setGithubKey = useKeysStore((s) => s.setGithubKey);
  const [draft, setDraft] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setDraft("");
      setSaved(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-4 text-action" /> GitHub
          </DialogTitle>
          <DialogDescription>
            Let Atlas read repositories to answer questions about code. Reading only —
            it cannot commit, push or open pull requests.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Let Atlas read GitHub</span>
            <span className="block text-2xs text-muted-foreground">
              Adds a read-only <code>github</code> tool. Repository names you mention are
              sent to api.github.com when it runs.
            </span>
          </span>
          <Switch checked={enabled} onCheckedChange={() => toggle("github")} />
        </label>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="gh-token">
            Personal access token (optional)
          </label>
          {githubKey ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
              <Check className="size-3.5 shrink-0 text-action" />
              <span className="flex-1 font-mono text-xs">{maskKey(githubKey)}</span>
              <button
                onClick={() => setGithubKey("")}
                aria-label="Remove GitHub token"
                className="text-muted-foreground hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                id="gh-token"
                type="password"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="ghp_… — only needed for private repositories"
                autoComplete="off"
                spellCheck={false}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface-2/50 px-3 font-mono text-xs outline-none focus:border-action/40"
              />
              <Button
                size="sm"
                disabled={!draft.trim()}
                onClick={() => {
                  setGithubKey(draft);
                  setDraft("");
                  setSaved(true);
                }}
              >
                Save
              </Button>
            </div>
          )}
          {saved && <p className="text-2xs text-action">Token saved in this browser.</p>}
          <p className="text-2xs text-muted-foreground">
            Public repositories need no token. A token is encrypted in this browser and
            sent only to Atlas&rsquo;s own GitHub route, which forwards it to GitHub and
            keeps nothing. A read-only <em>fine-grained</em> token with Contents: Read is
            enough — Atlas never calls a write endpoint, whatever scopes the token has.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
