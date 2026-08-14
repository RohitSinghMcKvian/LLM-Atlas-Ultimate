"use client";

import * as React from "react";
import { announce } from "@/lib/atlas-events";
import {
  ariaValue,
  dragToState,
  effectiveMax,
  keyboardStep,
  resolveSize,
  type AxisContext,
  type PanelConstraints,
  type PanelState,
} from "@/lib/panels";
import { useLayoutStore, type PanelKey } from "@/lib/store/layout-store";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/use-media-query";
import { clamp } from "@/lib/utils";

export interface PanelSpec {
  key: PanelKey;
  /** Custom property written on the surface root, e.g. `--atlas-code-explorer`. */
  cssVar: string;
  constraints: PanelConstraints;
  /** `x` resizes width, `y` resizes height. */
  axis: "x" | "y";
  /** Handle is on the panel's leading edge, so a positive delta shrinks it. */
  anchoredRight: boolean;
  /** Floor for the pane this panel shares its axis with. */
  centerMin: number;
  /** Announced to assistive tech, e.g. "History sidebar". */
  label: string;
  /** Element whose extent divides this axis. Defaults to the surface root. */
  containerRef?: React.RefObject<HTMLElement | null>;
  /**
   * False when the panel is not on screen — below its breakpoint, or closed.
   * Such a panel contributes nothing to the axis budget and cannot be dragged.
   */
  active?: boolean;
  /** Focused when a collapse would otherwise strand focus inside the panel. */
  toggleRef?: React.RefObject<HTMLElement | null>;
}

export interface PanelController {
  id: string;
  state: PanelState;
  /** Displayed px as of the last render. The live drag value is in the CSS var. */
  size: number;
  /**
   * False until `ready`, whatever the store says. The store rehydrates from
   * localStorage synchronously at module init, so rendering the persisted value
   * on the first client pass would not match the server's markup. The *size*
   * has no such problem — it is a CSS var written imperatively.
   */
  collapsed: boolean;
  /** True from the first layout effect, i.e. before the first paint. */
  ready: boolean;
  toggle: () => void;
  reset: () => void;
  handleProps: React.HTMLAttributes<HTMLDivElement> & { tabIndex: number };
}

const panelId = (key: PanelKey) => `atlas-panel-${key}`;

/** Static ceiling only — used to budget *siblings*, so it must not recurse. */
function rawSize(spec: PanelSpec, state: PanelState): number {
  if (spec.active === false) return 0;
  if (state.collapsed) return spec.constraints.collapsedSize ?? 0;
  return clamp(state.size, spec.constraints.min, spec.constraints.max);
}

/**
 * Wires a set of panels on one surface to drag, keyboard and persistence.
 *
 * The load-bearing detail: **a drag never goes through React**. `ChatClient`
 * and `CodeClient` are the heaviest client roots in the app (a full markdown
 * message list; Monaco plus the agent trace timeline), so a `setState` per
 * `pointermove` would drop frames on any real session. Instead the pointer
 * handler writes the size straight into a CSS custom property on the surface
 * root — which the panels consume via `w-[var(--…)]` — and the store is
 * written exactly once, on `pointerup`.
 *
 * That also removes the SSR hydration problem for free: the panel classNames
 * are static strings, identical on server and client, and the var's fallback is
 * the size the panel used to be hardcoded to.
 */
export function useResizableSurface(
  rootRef: React.RefObject<HTMLElement | null>,
  specs: PanelSpec[],
): Record<string, PanelController> {
  const panels = useLayoutStore((s) => s.panels);
  const setPanel = useLayoutStore((s) => s.setPanel);
  const resetPanel = useLayoutStore((s) => s.resetPanel);
  const togglePanel = useLayoutStore((s) => s.togglePanel);

  const [ready, setReady] = React.useState(false);

  // Measurements and drag bookkeeping live in refs: a window resize must not
  // re-render mid-gesture, and the pointer handlers need values that are fresh
  // without waiting for a render to commit.
  const measured = React.useRef(new Map<HTMLElement, { w: number; h: number }>());
  const dragging = React.useRef(false);
  const drag = React.useRef<{
    key: PanelKey;
    start: PanelState;
    origin: number;
    ctx: AxisContext;
    next: PanelState | null;
  } | null>(null);
  const lastDown = React.useRef(new Map<PanelKey, { t: number; x: number; y: number }>());

  const specsRef = React.useRef(specs);
  specsRef.current = specs;
  const panelsRef = React.useRef(panels);
  panelsRef.current = panels;

  const [, bump] = React.useReducer((n: number) => n + 1, 0);

  const extentOf = React.useCallback(
    (spec: PanelSpec): number => {
      const el = spec.containerRef?.current ?? rootRef.current;
      if (!el) return 0;
      const m = measured.current.get(el) ?? { w: el.clientWidth, h: el.clientHeight };
      return spec.axis === "x" ? m.w : m.h;
    },
    [rootRef],
  );

  const ctxFor = React.useCallback(
    (spec: PanelSpec): AxisContext => {
      let other = 0;
      for (const s of specsRef.current) {
        if (s.key === spec.key || s.axis !== spec.axis) continue;
        other += rawSize(s, panelsRef.current[s.key]);
      }
      return { containerPx: extentOf(spec), centerMinPx: spec.centerMin, otherPanelsPx: other };
    },
    [extentOf],
  );

  const displayed = React.useCallback(
    (spec: PanelSpec): number => {
      if (spec.active === false) return 0;
      return resolveSize(panelsRef.current[spec.key], spec.constraints, ctxFor(spec));
    },
    [ctxFor],
  );

  const writeAll = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const spec of specsRef.current) {
      root.style.setProperty(spec.cssVar, `${Math.round(displayed(spec))}px`);
    }
  }, [displayed, rootRef]);

  // Re-measure on window/container resize. Skipped while a drag is live: the
  // refs are already current, and re-rendering the surface at pointer rate is
  // exactly what this whole design exists to avoid.
  useIsomorphicLayoutEffect(() => {
    const els = new Set<HTMLElement>();
    if (rootRef.current) els.add(rootRef.current);
    for (const s of specsRef.current) {
      if (s.containerRef?.current) els.add(s.containerRef.current);
    }
    if (els.size === 0) return;

    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const prev = measured.current.get(el);
        const next = { w: el.clientWidth, h: el.clientHeight };
        if (!prev || Math.abs(prev.w - next.w) > 0.5 || Math.abs(prev.h - next.h) > 0.5) {
          measured.current.set(el, next);
          changed = true;
        }
      }
      if (!changed || dragging.current) return;
      // Clamp for display on every tick — `100dvh` moves under us when iOS
      // Safari's URL bar collapses, with no user action involved.
      writeAll();
      bump();
    });

    for (const el of els) {
      measured.current.set(el, { w: el.clientWidth, h: el.clientHeight });
      ro.observe(el);
    }
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef, specs.length, writeAll]);

  useIsomorphicLayoutEffect(() => {
    writeAll();
    // Flipped here, not in the rAF below: `ready` gates the collapsed panel's
    // `data-collapsed`, which must be absent on the first client render so it
    // matches the server's, then land before paint. rAF does not fire at all in
    // a background tab, which would leave a persisted-collapsed panel readable
    // by the tab order until the user looked at it.
    if (!ready) setReady(true);

    const root = rootRef.current;
    if (!root || root.hasAttribute("data-panels-ready")) return;
    // A frame later, so the rehydrated sizes above land without animating. If
    // the tab is hidden this simply never runs and panels don't animate until
    // it is shown — which is the right answer anyway.
    const id = requestAnimationFrame(() => root.setAttribute("data-panels-ready", ""));
    return () => cancelAnimationFrame(id);
  });

  const endDrag = React.useCallback(
    (el: HTMLElement) => {
      const d = drag.current;
      drag.current = null;
      dragging.current = false;
      el.removeAttribute("data-dragging");
      document.body.classList.remove("atlas-resizing", "atlas-resizing-y");
      document.body.removeAttribute("data-atlas-resizing");
      if (d?.next) setPanel(d.key, d.next);
    },
    [setPanel],
  );

  const toggle = React.useCallback(
    (spec: PanelSpec) => {
      const willCollapse = !panelsRef.current[spec.key].collapsed;
      const panelEl = document.getElementById(panelId(spec.key));
      togglePanel(spec.key);
      // Collapsing with focus inside the panel would drop focus to <body> and
      // reset keyboard navigation to the top of the document.
      if (willCollapse && panelEl?.contains(document.activeElement)) {
        spec.toggleRef?.current?.focus();
      }
      announce(`${spec.label} ${willCollapse ? "collapsed" : "expanded"}`);
    },
    [togglePanel],
  );

  const controllers: Record<string, PanelController> = {};

  for (const spec of specs) {
    const state = panels[spec.key];
    const ctx = ctxFor(spec);
    const size = spec.active === false ? 0 : resolveSize(state, spec.constraints, ctx);
    const aria = ariaValue(size, ctx.containerPx, spec.label);
    const max = effectiveMax(spec.constraints, ctx);

    controllers[spec.key] = {
      id: panelId(spec.key),
      state,
      size,
      collapsed: ready && state.collapsed,
      ready,
      toggle: () => toggle(spec),
      reset: () => resetPanel(spec.key),
      handleProps: {
        role: "separator",
        tabIndex: 0,
        "aria-orientation": spec.axis === "x" ? "vertical" : "horizontal",
        "aria-controls": panelId(spec.key),
        "aria-label": spec.label,
        "aria-valuemin": ariaValue(spec.constraints.min, ctx.containerPx, spec.label).now,
        "aria-valuemax": ariaValue(max, ctx.containerPx, spec.label).now,
        "aria-valuenow": aria.now,
        "aria-valuetext": aria.text,

        onPointerDown: (e) => {
          if (e.button !== 0 || spec.active === false) return;
          const el = e.currentTarget;
          // Firefox starts a text-selection drag without this.
          e.preventDefault();

          // Double-click detected by hand: pointer capture can swallow the
          // second click's target, which makes `onDoubleClick` unreliable here.
          const prev = lastDown.current.get(spec.key);
          const now = performance.now();
          if (prev && now - prev.t < 400 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 6) {
            lastDown.current.delete(spec.key);
            resetPanel(spec.key);
            announce(`${spec.label} reset`);
            return;
          }
          lastDown.current.set(spec.key, { t: now, x: e.clientX, y: e.clientY });

          el.setPointerCapture(e.pointerId);
          dragging.current = true;
          drag.current = {
            key: spec.key,
            start: panelsRef.current[spec.key],
            origin: spec.axis === "x" ? e.clientX : e.clientY,
            // The container cannot change size mid-drag, so measure once.
            ctx: ctxFor(spec),
            next: null,
          };
          el.setAttribute("data-dragging", "true");
          document.body.classList.add(spec.axis === "x" ? "atlas-resizing" : "atlas-resizing-y");
          document.body.setAttribute("data-atlas-resizing", "");
        },

        onPointerMove: (e) => {
          const d = drag.current;
          if (!d || d.key !== spec.key) return;
          const pos = spec.axis === "x" ? e.clientX : e.clientY;
          const next = dragToState(
            d.start,
            pos - d.origin,
            spec.anchoredRight,
            spec.constraints,
            d.ctx,
          );
          d.next = next;

          const px = resolveSize(next, spec.constraints, d.ctx);
          rootRef.current?.style.setProperty(spec.cssVar, `${Math.round(px)}px`);

          // Keep assistive tech current without a render. Screen readers
          // announce `aria-valuetext` changes on their own, so the live region
          // stays out of it.
          const live = ariaValue(px, d.ctx.containerPx, spec.label);
          e.currentTarget.setAttribute("aria-valuenow", String(live.now));
          e.currentTarget.setAttribute("aria-valuetext", live.text);
        },

        onPointerUp: (e) => endDrag(e.currentTarget),
        onLostPointerCapture: (e) => endDrag(e.currentTarget),

        onKeyDown: (e) => {
          if (spec.active === false) return;
          if (e.key === "Enter" || e.key === " ") {
            if (spec.constraints.collapseAt === undefined) return;
            e.preventDefault();
            toggle(spec);
            return;
          }
          const next = keyboardStep(
            panelsRef.current[spec.key],
            e.key,
            e.shiftKey,
            spec.anchoredRight,
            spec.constraints,
            ctxFor(spec),
          );
          if (!next) return;
          // Otherwise the arrow scrolls whatever container is behind the handle.
          e.preventDefault();
          setPanel(spec.key, next);
        },
      },
    };
  }

  return controllers;
}
