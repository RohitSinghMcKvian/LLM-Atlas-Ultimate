"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Constellation } from "@/components/landing/constellation";
import { CursorSpotlight } from "@/components/motion/cursor-spotlight";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * How long the field stays gathered after a successful sign-in.
 *
 * The redirect does not wait on this — it fires on its own timer — so a slow
 * frame or a paused tab can never strand someone on a finished form.
 */
const PLOT_MS = 700;

interface PlotContext {
  /** Gather the constellation toward the panel. Decays on its own. */
  plot: () => void;
  plotting: boolean;
}

const Ctx = React.createContext<PlotContext>({ plot: () => {}, plotting: false });

/** Trigger the "route plotted" gesture from inside a sign-in step. */
export function useAuthPlot(): PlotContext {
  return React.useContext(Ctx);
}

/**
 * The sign-in surface: a map sheet with the panel pinned to it.
 *
 * The panel is not a card floating on a background. It is measured and handed to
 * the constellation as a `focusRef`, so the field parts around it and bunches
 * into a ridge along its edge — the form reads as a coordinate plotted on the
 * map rather than a UI element dropped over one. That is the one deliberately
 * expensive idea on this page; everything else stays quiet so it lands.
 *
 * The panel stays mounted across `/login` ↔ `/register`. Only its contents
 * animate, so moving between the two feels like one surface changing its mind
 * rather than a page reload.
 */
export function AuthShell({
  plate,
  labels,
  children,
}: {
  plate: React.ReactNode;
  labels?: string[];
  children: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [plotting, setPlotting] = React.useState(false);

  const plot = React.useCallback(() => {
    setPlotting(true);
    window.setTimeout(() => setPlotting(false), PLOT_MS);
  }, []);

  const ctx = React.useMemo(() => ({ plot, plotting }), [plot, plotting]);

  return (
    <Ctx.Provider value={ctx}>
      <div className="relative isolate flex min-h-[100svh] w-full overflow-hidden bg-background">
        {/* Backdrop, in the same order the landing hero stacks it. This surface
            is the one that uses `focusRef` and `converge`: the field parts
            around the sign-in panel and draws inward when credentials are
            submitted, which is why the panel is measured rather than just
            drawn over. */}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-graticule opacity-40" aria-hidden />
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <Constellation
            className="size-full"
            variant="hero"
            density={0.85}
            labels={labels}
            focusRef={panelRef}
            converge={plotting}
          />
        </div>
        <CursorSpotlight size={520} intensity={0.14} />

        {plate}

        <motion.div
          ref={panelRef}
          initial={reduce ? false : { opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className={cn(
            "relative flex w-full shrink-0 flex-col justify-center",
            "border-border bg-background/80 backdrop-blur-2xl",
            "px-5 py-12 sm:px-10",
            "lg:w-[26rem] lg:border-l xl:w-[29rem]",
          )}
        >
          {/* Hairline seam. The panel's own border is flat; this is the brand
              edge that makes it read as a cut rather than a box. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 hidden w-px bg-gradient-to-b from-transparent via-action/40 to-transparent lg:block"
          />

          <div className="mx-auto w-full max-w-sm">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={pathname}
                initial={reduce ? false : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16 }}
                transition={{ duration: 0.28, ease: EASE }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </Ctx.Provider>
  );
}

/**
 * The sheet readout above each step.
 *
 * A numbered marker is only worth drawing when the content is genuinely a
 * sequence, and a sign-in flow is: address, then code, then in. Borrowing the
 * map-sheet vernacular rather than plain `01 / 02 / 03` keeps it in the same
 * world as the field behind it.
 */
export function SheetMark({ step, label }: { step: number; label: string }) {
  const total = 3;
  return (
    <p className="flex items-center gap-2.5 font-mono text-2xs uppercase tracking-wider text-muted-foreground">
      <span className="text-foreground/70">
        Sheet {String(step).padStart(2, "0")}
      </span>
      <span aria-hidden className="flex items-center gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-px w-4 rounded-full transition-colors duration-300",
              i < step ? "bg-action" : "bg-border-strong",
            )}
          />
        ))}
      </span>
      <span>{label}</span>
    </p>
  );
}
