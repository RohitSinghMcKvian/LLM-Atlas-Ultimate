"use client";

import * as React from "react";
import { CloudUpload, Check, LogOut, Loader2, ShieldCheck } from "lucide-react";
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
import { useAuth, sendMagicLink, signOut } from "@/lib/hooks/use-auth";

/**
 * Sign-in for cross-device sync.
 *
 * Framed as opt-in sync rather than "log in to use Atlas", because that is what
 * it is: every surface works signed-out against browser storage (§1.5). Signing
 * in switches the persistence driver to Supabase, where row level security
 * scopes data to the account (migration 0005).
 *
 * Magic link only — Atlas never handles a password.
 */
export function SyncDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { configured, email, loading } = useAuth();
  const [draft, setDraft] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setStatus("idle");
      setError(null);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || status === "sending") return;
    setStatus("sending");
    setError(null);
    const err = await sendMagicLink(draft);
    if (err) {
      setError(err);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-action/15 text-action">
              <CloudUpload className="size-4" />
            </span>
            <DialogTitle>Sync across devices</DialogTitle>
          </div>
          <DialogDescription>
            Atlas works fully offline — your chats already live in this browser.
            Signing in keeps them in sync across devices, scoped to your account.
          </DialogDescription>
        </DialogHeader>

        {!configured ? (
          <p className="rounded-xl border border-border bg-surface-2 p-3 text-sm text-muted-foreground">
            Sync isn&apos;t configured for this deployment. Everything still saves
            locally in this browser.
          </p>
        ) : loading ? (
          <p className="flex items-center gap-2 p-1 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Checking your session…
          </p>
        ) : email ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-3">
              <Badge variant="success" className="shrink-0">
                <Check className="mr-1 size-3" /> Synced
              </Badge>
              <span className="truncate text-sm text-muted-foreground">{email}</span>
            </div>
            <Button
              variant="outline"
              onClick={async () => {
                await signOut();
                onOpenChange(false);
              }}
              className="w-full"
            >
              <LogOut className="mr-2 size-4" />
              Sign out
            </Button>
            <p className="text-2xs text-muted-foreground">
              Signing out returns Atlas to this browser&apos;s local storage. Nothing
              already synced is deleted.
            </p>
          </div>
        ) : status === "sent" ? (
          <div className="space-y-2 rounded-xl border border-success/30 bg-success/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <Check className="size-4" /> Check your inbox
            </p>
            <p className="text-sm text-muted-foreground">
              We sent a sign-in link to <span className="text-foreground">{draft}</span>.
              Open it on this device to finish.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Input
              type="email"
              required
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
            />
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" disabled={status === "sending"} className="w-full">
              {status === "sending" ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Sending…
                </>
              ) : (
                "Email me a sign-in link"
              )}
            </Button>
            <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3 shrink-0" />
              No password. Your API keys stay encrypted in this browser either way
              and are never uploaded.
            </p>
          </form>
        )}

        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Topbar sync status.
 *
 * Signed in, this reports that the workspace is syncing and offers the way out.
 * Signed out it renders nothing — that used to be this button's second job, but
 * `/login` now owns getting people in, and the account menu already shows a
 * "Sign in" control right beside this one. Two doors to the same room, one of
 * them a magic-link-only dialog, is worse than one.
 */
export function SyncButton({ className }: { className?: string }) {
  const { configured, email } = useAuth();
  const [open, setOpen] = React.useState(false);
  if (!configured || !email) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={className}
        title={`Synced as ${email}`}
      >
        <CloudUpload className="size-4" />
        <Badge variant="success" className="hidden md:inline-flex">
          Synced
        </Badge>
      </button>
      <SyncDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
