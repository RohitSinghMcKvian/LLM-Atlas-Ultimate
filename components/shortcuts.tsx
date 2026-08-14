"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { emitAtlas, useAtlasEvent } from "@/lib/atlas-events";

interface Shortcut {
  keys: string[];
  label: string;
}

const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: "Global",
    items: [
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["⌘", "⇧", "O"], label: "New chat / session" },
      { keys: ["⌘", "/"], label: "Keyboard shortcuts" },
    ],
  },
  {
    group: "Chat & Playground",
    items: [
      { keys: ["⌘", "⏎"], label: "Send / Run" },
      { keys: ["⇧", "⏎"], label: "Newline" },
      { keys: ["Esc"], label: "Stop streaming" },
      { keys: ["⌘", "B"], label: "Toggle chat history" },
    ],
  },
  {
    group: "Resizable panels",
    items: [
      { keys: ["Drag"], label: "Resize — grab the divider between panels" },
      { keys: ["2×"], label: "Double-click a divider to reset it" },
      { keys: ["←", "→"], label: "Resize a focused divider (⇧ for larger steps)" },
      { keys: ["Home", "End"], label: "Jump to minimum / maximum" },
      { keys: ["⏎"], label: "Collapse or expand from a focused divider" },
    ],
  },
  {
    group: "Atlas News",
    items: [
      { keys: ["J", "K"], label: "Move between stories" },
      { keys: ["⏎"], label: "Open the deep dive" },
      { keys: ["⇧", "⏎"], label: "Open the source article" },
      { keys: ["S"], label: "Save story" },
      { keys: ["/"], label: "Search" },
      { keys: ["1", "–", "9"], label: "Toggle a topic" },
      { keys: ["V"], label: "Verified only" },
      { keys: ["G"], label: "Cycle layout" },
      { keys: ["R"], label: "Sync now" },
    ],
  },
  {
    group: "Atlas Code",
    items: [
      { keys: ["⌘", "⏎"], label: "Run / approve diff" },
      { keys: ["⌘", "⌫"], label: "Reject diff" },
      { keys: ["Esc"], label: "Stop agent" },
      { keys: ["⌘", "B"], label: "Toggle file explorer" },
      { keys: ["⌘", "J"], label: "Toggle terminal" },
      { keys: ["⌘", "I"], label: "Toggle agent panel" },
    ],
  },
];

/**
 * Global keyboard layer (§3.6): ⌘⇧O to start fresh, ⌘/ for the shortcuts
 * sheet, plus a shared ARIA live region that voices streaming/announcements.
 * ⌘K lives in the command palette. Send/stop are handled per-surface.
 */
export function Shortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [live, setLive] = React.useState("");

  useAtlasEvent("announce", (d) => {
    if (d.message) setLive(d.message);
  });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        // Modules with a composer listen for this to reset; otherwise go to Chat.
        emitAtlas("new");
        router.push("/chat");
      } else if (mod && e.key === "/") {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <>
      {/* Shared ARIA live region for streaming + announcements */}
      <div aria-live="polite" role="status" className="sr-only">
        {live}
      </div>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="size-4 text-action" /> Keyboard shortcuts
            </DialogTitle>
            <DialogDescription>Move through Atlas without the mouse.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {SHORTCUTS.map((g) => (
              <div key={g.group}>
                <p className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                  {g.group}
                </p>
                <div className="space-y-1">
                  {g.items.map((s) => (
                    <div
                      key={s.label}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2/60"
                    >
                      <span className="text-foreground/90">{s.label}</span>
                      <span className="flex items-center gap-1">
                        {s.keys.map((k) => (
                          <kbd
                            key={k}
                            className="min-w-[1.5rem] rounded border border-border bg-surface-2 px-1.5 py-0.5 text-center font-mono text-2xs"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
