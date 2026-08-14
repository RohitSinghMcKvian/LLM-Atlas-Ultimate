"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ResizeHandleProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The orientation of the *separator*, not of the drag. A divider between two
   * side-by-side panes is `vertical` even though dragging it changes width —
   * getting this backwards makes screen readers announce the wrong axis.
   */
  orientation: "vertical" | "horizontal";
  /**
   * Occupy layout instead of overlaying the neighbours' edges. Needed wherever
   * an overhanging hit area would land on a scrollbar — Monaco's horizontal
   * scrollbar is 8px and sits exactly where the terminal's handle would.
   */
  inline?: boolean;
}

/**
 * The drag separator between two panels.
 *
 * Presentational by design: pointer capture, keyboard, clamping and persistence
 * all arrive through `...props` from `useResizableSurface`, keeping this file
 * store-free like the rest of `components/ui`.
 *
 * The visible line is a 1px child so the parent can be a wider grab target
 * without looking like one.
 */
const ResizeHandle = React.forwardRef<HTMLDivElement, ResizeHandleProps>(
  ({ className, orientation, inline = false, ...props }, ref) => {
    const vertical = orientation === "vertical";
    return (
      <div
        ref={ref}
        className={cn(
          "atlas-handle group relative z-10 shrink-0 touch-none select-none",
          vertical ? "w-px cursor-col-resize self-stretch" : "h-1.5 w-full cursor-row-resize",
          // ~9px of grab area straddling a 1px line, for the rails only.
          !inline &&
            vertical &&
            "after:absolute after:-inset-x-1 after:inset-y-0 after:content-['']",
          !inline && !vertical && "after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
          className,
        )}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute bg-border transition-colors duration-150",
            // The delay keeps a line from strobing as the pointer brushes past.
            "group-hover:bg-border-strong group-hover:delay-150",
            "group-data-[dragging=true]:bg-action/70 group-data-[dragging=true]:delay-0",
            vertical ? "inset-y-0 left-0 w-px" : "inset-x-0 top-0 h-px",
          )}
        />
      </div>
    );
  },
);
ResizeHandle.displayName = "ResizeHandle";

export { ResizeHandle };
