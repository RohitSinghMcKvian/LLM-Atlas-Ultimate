"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import {
  buildGrid,
  cursorForce,
  forwardNeighbors,
  linkDistance,
  mixRgb,
  nodeCount,
  rectForce,
  rgba,
  tierFor,
  type FieldPoint,
  type FieldRect,
  type RGB,
} from "@/lib/canvas/field";
import { clamp } from "@/lib/utils";

interface Node {
  /** Home position — drifts steadily and wraps at the edges. */
  x: number;
  y: number;
  /** Base drift — constant for the life of the node. */
  vx: number;
  vy: number;
  /** Displacement from home, and its velocity. A damped spring returns it. */
  ox: number;
  oy: number;
  ix: number;
  iy: number;
  r: number;
  hue: number; // 0 = cyan end, 1 = violet end
  label?: string;
  pulse: number;
}

/** `hero` is the full-strength field; `ambient` is the calmer closing-CTA one. */
export type ConstellationVariant = "hero" | "ambient";

export interface ConstellationProps {
  labels?: string[];
  density?: number;
  className?: string;
  variant?: ConstellationVariant;
  /** Set false to opt out of the cursor lens (the field still drifts). */
  interactive?: boolean;
  /**
   * An element the field should part around — used by the auth surfaces, where
   * the sign-in panel reads as a coordinate plotted on the map rather than a
   * card dropped on top of it. Measured on mount and on resize, never per frame.
   */
  focusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Pull the field toward `focusRef` instead of away from it. A one-shot gesture
   * on successful sign-in; hold it true for under a second.
   */
  converge?: boolean;
}

const TUNING = {
  hero: {
    drift: 0.18,
    edgeAlpha: 0.5,
    nodeAlpha: 0.95,
    glowRadius: 6,
    force: 1.15,
    labels: true,
  },
  ambient: {
    drift: 0.12,
    edgeAlpha: 0.38,
    nodeAlpha: 0.8,
    glowRadius: 5,
    force: 0.7,
    labels: false,
  },
} as const satisfies Record<ConstellationVariant, unknown>;

// The cursor lens: a repelled void inside R_INNER, a packed halo out to R_OUTER.
const R_INNER = 96;
const R_OUTER = 260;
// The panel lens is wider and softer than the cursor's. A panel is a standing
// feature of the layout, not a thing being waved around, so the ridge it raises
// along its edge wants room to read as terrain rather than as a hard rim.
const FOCUS_INNER = 120;
const FOCUS_OUTER = 340;
/** Panels push more gently than the cursor, or the field looks blown apart. */
const FOCUS_GAIN = 0.55;
/** …and pull harder than they push, so the converge gesture actually lands. */
const CONVERGE_GAIN = 2.4;
const INTRO_MS = 1100;
/** Stiffness of the pull back to a node's home point. */
const HOME_SPRING = 0.012;

const FALLBACK: Palette = {
  from: [46, 143, 140],
  to: [217, 117, 47],
  flare: [233, 233, 234],
  label: [233, 233, 234],
  alphaScale: 1,
  glowScale: 1,
  dark: true,
};

interface Palette {
  from: RGB;
  to: RGB;
  /** Colour links flare toward under the cursor. */
  flare: RGB;
  label: RGB;
  /** Light themes need more ink to survive a near-white background. */
  alphaScale: number;
  /** …but the node halos need *less*, or they read as blotches on white. */
  glowScale: number;
  dark: boolean;
}

function parseTriplet(raw: string, fallback: RGB): RGB {
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return [parts[0], parts[1], parts[2]];
}

/**
 * Pull the live theme tokens off `<html>`. The previous implementation baked
 * cyan/violet in as JS constants, which left the mesh washed out against the
 * light `--background`; reading the tokens means the field tracks the theme.
 */
function readPalette(): Palette {
  if (typeof window === "undefined") return FALLBACK;
  const el = document.documentElement;
  const dark = el.classList.contains("dark");
  const cs = getComputedStyle(el);
  const read = (name: string, fallback: RGB) =>
    parseTriplet(cs.getPropertyValue(name), fallback);

  const foreground = read("--foreground", dark ? [233, 233, 234] : [23, 24, 26]);

  return {
    // The mesh runs across two bands of the elevation ramp rather than a brand
    // gradient — shelf to ridge, the same span the hero contours use.
    from: read("--elev-1", dark ? [46, 143, 140] : [31, 115, 112]),
    to: read("--elev-4", dark ? [217, 117, 47] : [176, 82, 26]),
    flare: foreground,
    label: foreground,
    alphaScale: dark ? 1 : 1.7,
    glowScale: dark ? 1 : 0.4,
    dark,
  };
}

function easeOutExpo(t: number) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Interactive constellation of "model" nodes drifting in deep space.
 *
 * Edges pulse along a cyan→violet gradient and flare toward the foreground
 * colour under the cursor, which also carves a void in the field and packs a
 * brighter halo around its rim. Colours are read from the live theme tokens,
 * the loop parks itself when the section scrolls away or the tab is hidden, and
 * it degrades to a single calm frame under `prefers-reduced-motion`.
 */
export function Constellation({
  labels = [],
  density = 1,
  className,
  variant = "hero",
  interactive = true,
  focusRef,
  converge = false,
}: ConstellationProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  // Labels arrive from a server component and may be a fresh array each render;
  // key the effect on the contents so the field never re-seeds on identity.
  const labelKey = labels.join("|");
  const labelsRef = React.useRef(labels);
  labelsRef.current = labels;

  // Read through refs rather than the dependency array. Toggling `converge` is a
  // per-interaction thing, and re-running the effect would re-seed every node
  // from `Math.random()` — the whole field would jump at the exact moment it is
  // meant to gather.
  const focusElRef = React.useRef(focusRef);
  focusElRef.current = focusRef;
  const convergeRef = React.useRef(converge);
  convergeRef.current = converge;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Non-null typed aliases so nested animation closures keep the narrowing.
    const cv = canvas as HTMLCanvasElement;
    const c2d = ctx as CanvasRenderingContext2D;
    const parent = canvas.parentElement as HTMLElement;
    const tune = TUNING[variant];
    const names = labelsRef.current;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let nodes: Node[] = [];
    let display: FieldPoint[] = [];
    let minNodes = 22;
    let raf = 0;
    let clock = 0;
    let lastFrameAt = 0;

    // Quality ratchet — one-way, so it can never oscillate.
    let slowFrames = 0;
    let qualityStep = 0;

    // Run gates.
    let onScreen = true;
    let tabVisible = true;
    let pointerAttached = false;

    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const useCursor = interactive && !reduce;

    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
    let palette = readPalette();
    let focusRect: FieldRect | null = null;

    /**
     * Locate the focus element in canvas space.
     *
     * Called on mount and on resize only. Doing it per frame would mean a
     * `getBoundingClientRect` inside the RAF loop, which forces layout on every
     * tick — the one thing this component's whole perf design avoids.
     */
    function measureFocus() {
      const el = focusElRef.current?.current;
      if (!el) {
        focusRect = null;
        return;
      }
      const box = el.getBoundingClientRect();
      const own = cv.getBoundingClientRect();
      if (!own.width || !own.height || !box.width || !box.height) {
        focusRect = null;
        return;
      }
      // Undo any ancestor scale, matching what `onMove` does for the pointer.
      const kx = width / own.width;
      const ky = height / own.height;
      focusRect = {
        x: (box.left - own.left) * kx,
        y: (box.top - own.top) * ky,
        w: box.width * kx,
        h: box.height * ky,
      };
    }

    function build() {
      // `clientWidth/Height` rather than `getBoundingClientRect`: the hero wraps
      // this layer in a scroll-linked scale, and layout size must ignore that.
      width = Math.max(1, parent.clientWidth);
      height = Math.max(1, parent.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(height * dpr);
      cv.style.width = `${width}px`;
      cv.style.height = `${height}px`;
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);

      const tier = tierFor(width);
      const count = nodeCount(width, height, density, tier);
      minNodes = nodeCount(width, height, density * 0.6, "compact");

      nodes = [];
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * tune.drift,
          vy: (Math.random() - 0.5) * tune.drift,
          ox: 0,
          oy: 0,
          ix: 0,
          iy: 0,
          r: 1 + Math.random() * 1.8,
          hue: Math.random(),
          pulse: Math.random() * Math.PI * 2,
        });
      }
      display = nodes.map((n) => ({ x: n.x, y: n.y }));

      // Labels crowd a phone-width canvas, so they are a `full`-tier flourish.
      if (tune.labels && tier === "full") {
        const wanted = names.slice(0, Math.min(10, nodes.length));
        const cx = width / 2;
        const cy = height / 2;

        // Keep model names clear of the centre column, where the headline and
        // CTAs live — a label crossing the h1 reads as a rendering bug.
        const outside: number[] = [];
        for (let i = 0; i < nodes.length; i++) {
          const nx = nodes[i].x / width;
          const ny = nodes[i].y / height;
          // Clear of the fixed nav at the top and the fade-out at the bottom.
          if (ny < 0.1 || ny > 0.94) continue;
          if (nx > 0.2 && nx < 0.8 && ny > 0.16 && ny < 0.84) continue;
          outside.push(i);
        }
        const pool = outside.length >= wanted.length ? outside : nodes.map((_, i) => i);

        // Ordering by angle then walking at a fixed stride rings the labels
        // around the copy instead of clumping them in one corner.
        pool.sort(
          (a, b) =>
            Math.atan2(nodes[a].y - cy, nodes[a].x - cx) -
            Math.atan2(nodes[b].y - cy, nodes[b].x - cx),
        );
        const stride = pool.length / wanted.length;
        wanted.forEach((label, i) => {
          const n = nodes[pool[Math.floor((i + 0.5) * stride)]];
          if (n && !n.label) {
            n.label = label;
            n.r = 2.6;
          }
        });
      }
      if (coarse) {
        // Touch devices drive the lens themselves; start it centred.
        pointer.x = pointer.tx = width / 2;
        pointer.y = pointer.ty = height / 2;
        pointer.active = true;
      }
      measureFocus();
    }

    const neighborBuf: number[] = [];

    function draw(step: number) {
      c2d.clearRect(0, 0, width, height);
      const link = linkDistance(width);
      const introT = easeOutExpo(clamp(clock / INTRO_MS, 0, 1));
      const spread = 0.82 + 0.18 * introT;
      const cx = width / 2;
      const cy = height / 2;

      if (coarse && useCursor) {
        // No hover on touch — walk the lens along a slow Lissajous path so the
        // field still breathes on a phone.
        pointer.tx = cx + width * 0.34 * Math.sin(clock * 0.00021);
        pointer.ty = cy + height * 0.26 * Math.sin(clock * 0.00033 + 1.1);
      }

      // Smoothed pointer + a whisper of parallax on the whole field.
      pointer.x += (pointer.tx - pointer.x) * clamp(0.06 * step, 0, 1);
      pointer.y += (pointer.ty - pointer.y) * clamp(0.06 * step, 0, 1);
      const live = useCursor && pointer.active;
      const parX = live ? (pointer.x - cx) * 0.02 : 0;
      const parY = live ? (pointer.y - cy) * 0.02 : 0;

      const decay = Math.pow(0.93, step);
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];

        // Home drifts on regardless of the cursor, so the field always flows.
        n.x += n.vx * step;
        n.y += n.vy * step;
        if (n.x < -20) n.x = width + 20;
        if (n.x > width + 20) n.x = -20;
        if (n.y < -20) n.y = height + 20;
        if (n.y > height + 20) n.y = -20;

        if (live) {
          const { fx, fy } = cursorForce(
            pointer.x - (n.x + n.ox),
            pointer.y - (n.y + n.oy),
            R_INNER,
            R_OUTER,
          );
          // An impulse rather than a position offset, so the lens settles
          // instead of snapping.
          n.ix += fx * tune.force * step;
          n.iy += fy * tune.force * step;
        }

        if (focusRect) {
          const pulling = convergeRef.current;
          const { fx, fy } = rectForce(
            n.x + n.ox,
            n.y + n.oy,
            focusRect,
            FOCUS_INNER,
            FOCUS_OUTER,
            pulling,
          );
          const gain = pulling ? CONVERGE_GAIN : FOCUS_GAIN;
          n.ix += fx * tune.force * gain * step;
          n.iy += fy * tune.force * gain * step;
        }

        // Damped spring back to home. Without it the cursor would hollow out
        // whatever region it lingered in and the field would never refill.
        n.ix = (n.ix - n.ox * HOME_SPRING * step) * decay;
        n.iy = (n.iy - n.oy * HOME_SPRING * step) * decay;
        n.ox += n.ix * step;
        n.oy += n.iy * step;

        const d = display[i];
        d.x = cx + (n.x + n.ox - cx) * spread + parX;
        d.y = cy + (n.y + n.oy - cy) * spread + parY;
      }

      c2d.globalAlpha = introT;

      // Edges — spatial hash keeps this linear as the field gets denser.
      const grid = buildGrid(display, link);
      for (let i = 0; i < nodes.length; i++) {
        const a = display[i];
        for (const j of forwardNeighbors(grid, display, i, neighborBuf)) {
          const b = display[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= link) continue;

          const hueT = (nodes[i].hue + nodes[j].hue) / 2;
          const pulse = 0.5 + 0.5 * Math.sin(clock * 0.0015 + (a.x + b.y) * 0.01);
          let alpha = (1 - dist / link) * tune.edgeAlpha * (0.5 + pulse * 0.5);
          let color = mixRgb(palette.from, palette.to, hueT);
          let lineWidth = 0.7;

          if (live) {
            // Links near the cursor burn toward the foreground colour — white
            // on dark, ink on light — and thicken as they do.
            const md = Math.hypot((a.x + b.x) / 2 - pointer.x, (a.y + b.y) / 2 - pointer.y);
            if (md < R_OUTER) {
              const flare = 1 - md / R_OUTER;
              color = mixRgb(color, palette.flare, flare * 0.9);
              alpha += flare * 0.5;
              lineWidth += flare * 0.7;
            }
          }

          c2d.strokeStyle = rgba(color, alpha * palette.alphaScale);
          c2d.lineWidth = lineWidth;
          c2d.beginPath();
          c2d.moveTo(a.x, a.y);
          c2d.lineTo(b.x, b.y);
          c2d.stroke();
        }
      }

      // Nodes
      const glowOn = qualityStep < 1;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const { x, y } = display[i];
        const color = mixRgb(palette.from, palette.to, n.hue);
        const glow = 0.6 + 0.4 * Math.sin(clock * 0.002 + n.pulse);

        if (glowOn) {
          const radius = n.r * tune.glowRadius * (palette.dark ? 1 : 0.75);
          const g = c2d.createRadialGradient(x, y, 0, x, y, radius);
          g.addColorStop(0, rgba(color, 0.9 * glow * palette.glowScale));
          g.addColorStop(1, rgba(color, 0));
          c2d.fillStyle = g;
          c2d.beginPath();
          c2d.arc(x, y, radius, 0, Math.PI * 2);
          c2d.fill();
        }

        c2d.fillStyle = rgba(color, tune.nodeAlpha);
        c2d.beginPath();
        c2d.arc(x, y, n.r, 0, Math.PI * 2);
        c2d.fill();

        if (n.label) {
          c2d.font = "500 11px ui-monospace, 'JetBrains Mono', monospace";
          c2d.fillStyle = rgba(palette.label, 0.55);
          const w = c2d.measureText(n.label).width;
          // Flip to the left rather than let a model name run off the edge,
          // then clamp so a wide name never clips on either side.
          const tx = x + w + 12 > width ? x - w - 8 : x + 8;
          c2d.fillText(n.label, clamp(tx, 6, Math.max(6, width - w - 6)), y + 3);
        }
      }

      c2d.globalAlpha = 1;
    }

    function loop(now: number) {
      raf = requestAnimationFrame(loop);
      const dt = lastFrameAt ? Math.min(now - lastFrameAt, 50) : 16.7;
      lastFrameAt = now;
      clock += dt;

      // Frame-rate independent motion: `step` is "how many 60fps ticks".
      draw(dt / 16.7);

      if (dt > 22) slowFrames++;
      else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 45 && qualityStep < 2) {
        qualityStep++;
        slowFrames = 0;
        if (qualityStep === 2 && nodes.length > minNodes) {
          const next = Math.max(minNodes, Math.round(nodes.length * 0.8));
          nodes.length = next;
          display.length = next;
        }
      }
    }

    function drawStatic() {
      // One calm frame, fully settled — no intro, no cursor.
      clock = INTRO_MS;
      draw(0);
    }

    function running() {
      return onScreen && tabVisible && !reduce;
    }

    function start() {
      if (raf || !running()) return;
      lastFrameAt = 0;
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    }

    const HOVER_MARGIN = 48;

    function onMove(e: PointerEvent) {
      const rect = cv.getBoundingClientRect();
      // Hit-test against the canvas box rather than listening for `pointerleave`
      // on the wrapper: the hero copy is stacked above this layer, so a leave
      // event fires the moment the cursor crosses the headline.
      const inside =
        e.clientX >= rect.left - HOVER_MARGIN &&
        e.clientX <= rect.right + HOVER_MARGIN &&
        e.clientY >= rect.top - HOVER_MARGIN &&
        e.clientY <= rect.bottom + HOVER_MARGIN;
      if (!inside) {
        pointer.active = false;
        return;
      }

      // Undo any ancestor scale so client coords land in canvas space.
      const kx = rect.width ? width / rect.width : 1;
      const ky = rect.height ? height / rect.height : 1;
      pointer.tx = (e.clientX - rect.left) * kx;
      pointer.ty = (e.clientY - rect.top) * ky;
      if (!pointer.active) {
        // First sighting — snap, so the lens doesn't sweep in from off-canvas.
        pointer.x = pointer.tx;
        pointer.y = pointer.ty;
        pointer.active = true;
      }
    }

    function onWindowOut(e: PointerEvent) {
      if (!e.relatedTarget) pointer.active = false;
    }

    function attachPointer() {
      if (pointerAttached || !useCursor || coarse) return;
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerout", onWindowOut);
      pointerAttached = true;
    }

    function detachPointer() {
      if (!pointerAttached) return;
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onWindowOut);
      pointerAttached = false;
    }

    const ro = new ResizeObserver(() => {
      build();
      if (!running()) drawStatic();
    });
    ro.observe(parent);

    // The focus element gets its own observer rather than joining `ro`: `build()`
    // re-seeds every node from scratch, and a panel that grows by one line of
    // error text must not shuffle the entire field. Re-measuring is enough.
    const focusEl = focusElRef.current?.current ?? null;
    const focusRo = focusEl
      ? new ResizeObserver(() => {
          measureFocus();
          if (!running()) drawStatic();
        })
      : null;
    focusRo?.observe(focusEl as HTMLElement);

    // Park the loop while the section is off screen — the hero used to animate
    // the whole time the user was reading the footer.
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        if (onScreen) {
          attachPointer();
          start();
        } else {
          detachPointer();
          stop();
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(parent);

    function onVisibility() {
      tabVisible = document.visibilityState !== "hidden";
      if (tabVisible) start();
      else stop();
    }
    document.addEventListener("visibilitychange", onVisibility);

    // Re-read tokens when next-themes swaps the class on <html>.
    const themeObserver = new MutationObserver(() => {
      palette = readPalette();
      if (!running()) drawStatic();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    build();
    if (reduce) {
      drawStatic();
    } else {
      attachPointer();
      start();
    }

    return () => {
      stop();
      detachPointer();
      ro.disconnect();
      focusRo?.disconnect();
      io.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `labelKey` stands in for `labels` so a fresh-but-equal array is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelKey, density, variant, interactive, reduce]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
