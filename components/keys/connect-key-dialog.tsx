"use client";

import * as React from "react";
import { KeyRound, Eye, EyeOff, ExternalLink, ShieldCheck, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useKeysStore, maskKey } from "@/lib/store/keys-store";

/**
 * Global "Connect your OpenRouter key" dialog. Mounted once (in the topbar) and
 * driven by the keys store so a `key_required` error anywhere can open it.
 * The key is stored only in this browser and sent per-request to Atlas, which
 * forwards it to OpenRouter and never stores it.
 */
export function ConnectKeyDialog() {
  const open = useKeysStore((s) => s.keyModalOpen);
  const setOpen = useKeysStore((s) => s.setKeyModalOpen);
  const savedKey = useKeysStore((s) => s.openrouterKey);
  const setKey = useKeysStore((s) => s.setOpenrouterKey);
  const clearKey = useKeysStore((s) => s.clearOpenrouterKey);

  const [draft, setDraft] = React.useState("");
  const [reveal, setReveal] = React.useState(false);

  // Seed the field with the saved key each time the dialog opens.
  React.useEffect(() => {
    if (open) setDraft(savedKey);
  }, [open, savedKey]);

  const connected = savedKey.length > 0;

  function save() {
    setKey(draft);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-accent/15 text-accent">
              <KeyRound className="size-4" />
            </span>
            <DialogTitle>Connect your OpenRouter key</DialogTitle>
          </div>
          <DialogDescription>
            Open-source models are <span className="text-success">free</span>. To run
            closed/paid models (GPT, Claude, Gemini, Grok…) bring your own{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-action hover:underline"
            >
              OpenRouter key <ExternalLink className="size-3" />
            </a>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            OpenRouter API key
          </label>
          <div className="relative">
            <Input
              type={reveal ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-or-v1-…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
              className="pr-10 font-mono"
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={reveal ? "Hide key" : "Show key"}
            >
              {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {connected && (
            <p className="flex items-center gap-1.5 text-2xs text-success">
              <Check className="size-3" /> Connected · {maskKey(savedKey)}
            </p>
          )}
        </div>

        <p className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/50 p-2.5 text-2xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
          <span>
            Stored only in this browser. Sent per-request to call paid models through
            your own OpenRouter account — never saved on Atlas servers.
          </span>
        </p>

        <DialogFooter>
          {connected && (
            <Button
              variant="ghost"
              onClick={() => {
                clearKey();
                setDraft("");
              }}
            >
              Remove key
            </Button>
          )}
          <Button variant="primary" onClick={save} disabled={!draft.trim()}>
            Save key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small badge/button that opens the dialog and reflects connection state. */
export function ConnectKeyButton({ className }: { className?: string }) {
  const setOpen = useKeysStore((s) => s.setKeyModalOpen);
  // `keyPresent`, not `openrouterKey`: the key itself is decrypted async, and
  // this badge only needs to know whether one exists.
  const connected = useKeysStore((s) => s.keyPresent);
  return (
    <button
      onClick={() => setOpen(true)}
      className={className}
      title={connected ? "OpenRouter key connected" : "Connect your OpenRouter key for paid models"}
    >
      <KeyRound className="size-4" />
      <Badge
        variant={connected ? "success" : "outline"}
        className="hidden md:inline-flex"
      >
        {connected ? "BYOK on" : "Connect key"}
      </Badge>
    </button>
  );
}
