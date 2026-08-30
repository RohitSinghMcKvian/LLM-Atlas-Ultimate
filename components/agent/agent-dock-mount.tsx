"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { AgentRail } from "./agent-rail";
import { AGENT_PANEL_ID } from "@/lib/agent/rail";
import { useFlag } from "@/lib/store/flags-store";

/**
 * The agent's mount point, on every route in the app.
 *
 * Split in two on purpose, and the split is the reason this can be everywhere.
 *
 * The **rail** is imported statically and rendered immediately: it is markup, a
 * CSS transition and one keyframe, so it costs almost nothing to have on all
 * sixteen workspace modules and the marketing pages besides. The **panel** pulls
 * in the knowledge graph, the retrieval index, the markdown renderer and
 * framer-motion, so it stays behind `next/dynamic` and is fetched the first time
 * someone actually opens it — the same reasoning `model-switcher-body.tsx` gives
 * for splitting the catalog out of the always-mounted topbar.
 *
 * Before this split the trigger lived *inside* the dynamic chunk, which meant
 * the button could not appear until the whole agent bundle had downloaded. A
 * permanently-visible affordance cannot be gated on a lazy import.
 */
const AgentDock = dynamic(() => import("./agent-dock").then((m) => m.AgentDock), {
  ssr: false,
});

/**
 * A third chunk, for the same reason there is a second one.
 *
 * Voice pulls in the detector, the endpointer, the lexicon and the synthesiser
 * driver, and most sessions never speak. It is fetched the first time someone
 * asks for it and, unlike the dock, unmounted when it closes - the dock holds a
 * transcript worth keeping and this holds a live microphone, which is the one
 * thing that must not survive being dismissed.
 */
const VoiceMode = dynamic(() => import("@/components/voice/voice-mode").then((m) => m.VoiceMode), {
  ssr: false,
});

export function AgentDockMount() {
  // Dark until the flag is turned on, like every other depth item in
  // `lib/flags.ts`.
  const enabled = useFlag("atlasDock");
  const voiceEnabled = useFlag("voiceMode");
  const [open, setOpen] = React.useState(false);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  /**
   * Mounted from the first open onward and never unmounted again.
   *
   * Not `open &&`: the panel holds the transcript, and unmounting it on close
   * would silently discard the conversation every time someone glanced away.
   * Keeping it mounted but animated out costs one hidden subtree and is what
   * makes "close, read the page, come back" work.
   */
  const [everOpened, setEverOpened] = React.useState(false);

  const openPanel = React.useCallback(() => {
    setEverOpened(true);
    setOpen(true);
  }, []);

  // The one global gesture, checked against the shortcuts already in use:
  // `components/shortcuts.tsx` owns ⌘⇧O and ⌘/, and the palette owns ⌘K.
  // Bound here rather than in the panel so it works on a cold page, before the
  // agent bundle has ever been fetched.
  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setEverOpened(true);
        setOpen((v) => !v);
      }
      // Escape closes the panel, but never out from under the voice surface -
      // that owns its own Escape, and closing both at once would end a spoken
      // conversation someone was only trying to step back from.
      if (e.key === "Escape" && !voiceOpen) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, voiceOpen]);

  if (!enabled) return null;

  return (
    <>
      <AgentRail open={open} onOpen={openPanel} panelId={AGENT_PANEL_ID} />
      {everOpened && (
        <AgentDock
          open={open}
          onClose={() => setOpen(false)}
          panelId={AGENT_PANEL_ID}
          onStartVoice={
            voiceEnabled
              ? () => {
                  // The panel goes away rather than sitting behind the overlay:
                  // two Atlas conversations on screen at once, one of them
                  // listening, is ambiguous about which one is being talked to.
                  setOpen(false);
                  setVoiceOpen(true);
                }
              : undefined
          }
        />
      )}
      {voiceOpen && <VoiceMode open onClose={() => setVoiceOpen(false)} />}
    </>
  );
}
