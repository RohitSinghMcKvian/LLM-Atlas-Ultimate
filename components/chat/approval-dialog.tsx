"use client";

import * as React from "react";
import { Plug, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ApprovalRule, PendingApproval } from "@/lib/mcp/approval";

/**
 * The approval prompt for a connector tool call.
 *
 * This is the security surface of P6, so it is built to be *read*, not dismissed:
 * the connector and tool are named, the arguments are shown in full, and the
 * default action is the conservative one. There is no "approve everything from
 * this connector" — remembering is per tool, because approving one tool must not
 * authorise the ones the server adds next month.
 *
 * Closing the dialog by any other means counts as a refusal. A tool call that ran
 * because a prompt was dismissed with Escape would make the whole gate advisory.
 */
export function ApprovalDialog({
  pending,
  onDecide,
}: {
  pending: PendingApproval | null;
  /** `remember` records the choice for this tool; otherwise it applies once. */
  onDecide: (approved: boolean, remember: ApprovalRule | null) => void;
}) {
  return (
    <Dialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open && pending) onDecide(false, null);
      }}
    >
      <DialogContent className="max-w-lg">
        {pending && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-amber" />
                Allow this connector action?
              </DialogTitle>
              <DialogDescription>
                Atlas wants to run a tool on your {pending.connectorName} account. This
                affects the real service, not a copy.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 p-3">
              <div className="flex items-center gap-2 text-sm">
                <Plug className="size-3.5 shrink-0 text-action" />
                <span className="font-medium">{pending.connectorName}</span>
                <span className="text-muted-foreground">·</span>
                <code className="text-xs">{pending.tool}</code>
                {/* Shown as the server's claim, never as a reason to skip the
                    prompt — the party being authorised does not get to certify
                    itself. */}
                {pending.readOnlyHint && (
                  <span className="ml-auto rounded bg-surface px-1.5 py-0.5 text-2xs text-muted-foreground">
                    server says read-only
                  </span>
                )}
              </div>
              <p className="text-2xs text-muted-foreground">{pending.description}</p>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-surface px-2 py-1.5 font-mono text-2xs">
                {pending.args}
              </pre>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" onClick={() => onDecide(true, null)}>
                Allow once
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDecide(true, "always")}>
                Always allow this tool
              </Button>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => onDecide(false, null)}>
                  Deny
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDecide(false, "never")}>
                  Never allow
                </Button>
              </div>
            </div>

            <p className="text-2xs text-muted-foreground/70">
              &ldquo;Always&rdquo; and &ldquo;never&rdquo; apply to this one tool only. Change
              them any time in Connectors.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
