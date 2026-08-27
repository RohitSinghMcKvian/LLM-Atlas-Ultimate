"use client";

import * as React from "react";
import { AtlasMark } from "@/components/brand/logo";
import { usePrefersReducedMotion } from "@/lib/hooks/use-media-query";
import {
  NUDGE_DELAY_MS,
  NUDGE_HOLD_MS,
  RAIL_PEEK_PX,
  markRailSeen,
  railSeen,
  shouldNudge,
} from "@/lib/agent/rail";
import { cn } from "@/lib/utils";

/**
 * Ask Atlas, staked at the edge of the map.
 *
 * A survey marker driven into the right margin: at rest only its summit shows,
 * and pointing at it draws the whole station in. That shape is the reason it
 * can live on every screen — a control that is always fully present on sixteen
 * modules is a control competing with sixteen pages of content, and the marker
 * that is mostly off-sheet is the one you can leave up permanently.
 *
 * ### Why the right edge, vertically centred
 *
 * Left is the sidebar. Bottom-right on mobile is already a floating action
 * button for the command palette (`components/shell/mobile-nav.tsx`), and two
 * circles in one corner is clutter rather than choice — that collision is what
 * pushed the previous bottom-right pill off this spot. Mid-right is empty on
 * every module, is the edge the panel itself arrives from, and is the one place
 * a right-handed thumb and a mouse both reach without crossing content.
 *
 * ### Why no framer-motion here
 *
 * This mounts on every route. A spring library driving one `translateX` is a
 * render loop and a bundle where a compositor-only CSS transition does the same
 * job for free — and the panel it opens is the thing that legitimately needs
 * framer, which is why that half stays behind `next/dynamic`. Hover and focus
 * are pure CSS for the same reason, and because CSS gets the edge cases right
 * that four hand-written pointer handlers get wrong.
 *
 * ### Reduced motion
 *
 * Handled at both tiers this repo requires. The blanket rule in `globals.css`
 * neutralises the drift and the transition; this component additionally parks
 * the rail *open* rather than collapsed, because a control that only reveals
 * itself through movement is invisible to someone who has asked for none.
 */
export function AgentRail({
  open,
  onOpen,
  panelId,
}: {
  /** Whether the panel is showing. The rail yields to it rather than overlap. */
  open: boolean;
  onOpen: () => void;
  panelId: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [nudging, setNudging] = React.useState(false);

  // The one-time reveal. Deliberately fire-and-forget: if the person navigates
  // or opens the panel mid-nudge, the timers are cleared and the flag is still
  // set on the way out, because they have plainly found it.
  React.useEffect(() => {
    if (!shouldNudge(railSeen(), reduced)) return;
    const out = setTimeout(() => setNudging(true), NUDGE_DELAY_MS);
    const back = setTimeout(() => {
      setNudging(false);
      markRailSeen();
    }, NUDGE_DELAY_MS + NUDGE_HOLD_MS);
    return () => {
      clearTimeout(out);
      clearTimeout(back);
      markRailSeen();
    };
  }, [reduced]);

  return (
    <div
      className={cn(
        "atlas-rail fixed right-0 top-1/2 z-30 -translate-y-1/2",
        // While the panel is out it covers this edge completely, so the rail
        // is hidden rather than stacked underneath — a ghost showing through
        // a translucent panel is worse than either state.
        open && "pointer-events-none opacity-0",
        "transition-opacity duration-300 [transition-timing-function:var(--ease-atlas)]",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-controls={panelId}
        title="Ask Atlas (⌘J)"
        data-open={nudging || reduced || undefined}
        style={{ ["--rail-peek" as string]: `${RAIL_PEEK_PX}px` }}
        className={cn(
          "group/rail relative flex items-center gap-2.5 py-4 pl-3.5 pr-4",
          "rounded-l-2xl border border-r-0 border-border-strong bg-surface/95 shadow-lift backdrop-blur-xl",
          // The resting position: everything but `--rail-peek` pushed off the
          // right edge. One transform, composited, no layout involved — which
          // is also why the label below can stay in the DOM at zero opacity
          // instead of being conditionally rendered.
          "translate-x-[calc(100%-var(--rail-peek))]",
          "transition-[transform,border-color,box-shadow] duration-500 [transition-timing-function:var(--ease-atlas)]",
          "hover:translate-x-0 focus-visible:translate-x-0 data-[open]:translate-x-0",
          "hover:border-action/45 hover:shadow-float focus-visible:border-action/45",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
        )}
      >
        {/*
          A held breath of `--action` behind the mark. The resting sliver is only
          44px of a mostly-achromatic surface, and against a dense table or the
          landing page's constellation that reads as a rendering artifact rather
          than as something to press. This is the one hue the system allows in
          the chrome, used for the one thing it is reserved for: the primary
          action. Blurred and at 9%, so it registers as a warm spot rather than
          as a coloured button.
        */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-1 top-1/2 size-11 -translate-y-1/2 rounded-full",
            "bg-[rgb(var(--action))] opacity-[0.09] blur-lg",
            "transition-opacity duration-500 group-hover/rail:opacity-[0.16]",
          )}
        />

        {/*
          The ridge line, flush with the screen edge and full height. Always
          visible in the peek, so the resting state carries the elevation ramp
          rather than a grey nub — the ramp, not a second chrome hue, which is
          the one colour rule this system actually has.
        */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-2.5 left-0 w-1 rounded-full opacity-90",
            "bg-gradient-to-b from-[rgb(var(--elev-1))] via-[rgb(var(--elev-4))] to-[rgb(var(--elev-2))]",
            "transition-opacity duration-500 group-hover/rail:opacity-100",
          )}
        />

        {/* The mark drifts; the tab does not. A marker that is planted but
            alive, rather than a whole panel bobbing at the edge of the screen. */}
        <span className="atlas-rail-drift relative grid size-7 shrink-0 place-items-center">
          <AtlasMark size={28} bare />
        </span>

        <span
          className={cn(
            "flex items-center gap-2 whitespace-nowrap opacity-0",
            "transition-opacity duration-300 [transition-delay:90ms]",
            "group-hover/rail:opacity-100 group-focus-visible/rail:opacity-100",
            "group-data-[open]/rail:opacity-100",
          )}
        >
          {/* Present at all times, never conditionally rendered: this text is
              the button's accessible name, and a name that appears and
              disappears with a pointer is a name a screen reader never hears. */}
          <span className="font-display text-sm font-semibold leading-none text-foreground">
            Ask Atlas
          </span>
          <kbd
            aria-hidden
            className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-2xs leading-none text-muted-foreground"
          >
            ⌘J
          </kbd>
        </span>
      </button>
    </div>
  );
}
