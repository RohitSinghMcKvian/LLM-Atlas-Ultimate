import { clamp } from "@/lib/utils";

/**
 * Sizing math for the resizable frames in Atlas Chat and Atlas Code.
 *
 * Kept pure and free of React/DOM on purpose: the surfaces themselves are
 * untested by design, so this is the only layer where the arithmetic that
 * actually decides whether the layout survives — drag direction, collapse
 * hysteresis, the center-pane floor — can be pinned down by tests.
 *
 * The central invariant: **stored size is intent, displayed size is clamped
 * intent.** A window that shrinks below the sum of the minima (or an iOS URL
 * bar collapsing, which moves `100dvh` mid-session) narrows what we *render*
 * and never touches what we *persist*. Otherwise resizing a window down and
 * back up would silently destroy the user's layout.
 */

export interface PanelConstraints {
  /** Smallest size the panel's own content stays usable at. */
  min: number;
  /** Ceiling in px, independent of the container. */
  max: number;
  defaultSize: number;
  /** Extra ceiling as a fraction of the container, applied alongside `max`. */
  maxFraction?: number;
  /** Drag below this and the panel collapses. Omit to disable drag-collapse. */
  collapseAt?: number;
  /** Size while collapsed — 0 hides it, >0 leaves a header stub reachable. */
  collapsedSize?: number;
}

export interface PanelState {
  /** The user's intent. Persisted. Never written from a clamp. */
  size: number;
  collapsed: boolean;
}

export interface AxisContext {
  /** Measured extent of the axis being divided: root width, or column height. */
  containerPx: number;
  /** The pane between the panels must never be squeezed below this. */
  centerMinPx: number;
  /** Sum of the *displayed* sizes of the other panels sharing this axis. */
  otherPanelsPx: number;
}

/** Arrow-key increment, and the Shift-modified one. */
export const KEY_STEP = 16;
export const KEY_STEP_LARGE = 64;

/** Above this |px/s| a pointer release counts as a flick, not a drop. */
export const FLICK_VELOCITY = 500;

// ── Constraints ───────────────────────────────────────────────────────────────
// Every number here is set by what the panel actually contains; see the plan for
// the per-panel derivation. They live in this module rather than in the surfaces
// so that `sanitize` and the tests share one source of truth.

/** Chat: the 2-up Projects/Memory row needs ~212px before its labels wrap. */
export const CHAT_HISTORY: PanelConstraints = {
  min: 220,
  defaultSize: 256,
  max: 420,
  collapseAt: 160,
  collapsedSize: 0,
};

/** Chat: header (title + 4 icon buttons) over a 3-tab strip + version nav. */
export const CHAT_ARTIFACT: PanelConstraints = {
  min: 320,
  defaultSize: 460,
  max: 880,
  // No `collapseAt`: dragging to zero would be indistinguishable from closing
  // the panel, and would fight the artifact's own open/closed state.
};

/** Code: a depth-3 file is 44px of indent before the name even starts. */
export const CODE_EXPLORER: PanelConstraints = {
  min: 160,
  defaultSize: 208,
  max: 360,
  collapseAt: 120,
  collapsedSize: 0,
};

/** Code: collapses to exactly the terminal's `h-8` header, VS Code style. */
export const CODE_TERMINAL: PanelConstraints = {
  min: 120,
  defaultSize: 176,
  max: 640,
  maxFraction: 0.6,
  collapseAt: 90,
  collapsedSize: 32,
};

/** Code: the composer footer's mode toggle + model picker + run buttons. */
export const CODE_AGENT: PanelConstraints = {
  min: 340,
  defaultSize: 400,
  max: 560,
  collapseAt: 240,
  collapsedSize: 0,
};

/** Reading room the chat thread keeps no matter what the rails do. */
export const CHAT_CENTER_MIN = 520;
/** Width below which Monaco's gutter + content stop being workable. */
export const CODE_CENTER_MIN = 480;
/** Height below which Monaco shows fewer than ~10 lines. */
export const CODE_EDITOR_MIN = 200;

/** Mobile artifact sheet, as fractions of `dvh`. */
export const SHEET_SNAPS = [0.5, 0.75, 0.92];
export const SHEET_MIN = 0.35;
export const SHEET_DEFAULT = 0.92;

// ── Math ──────────────────────────────────────────────────────────────────────

/**
 * The largest this panel may *display* at right now.
 *
 * Both surface roots are `overflow-hidden` with `shrink-0` panels, so an
 * oversized panel never produces a scrollbar — it squeezes the `min-w-0 flex-1`
 * center to zero and strands its content with no visual cue. That makes this
 * function load-bearing rather than a nicety.
 */
export function effectiveMax(c: PanelConstraints, ctx: AxisContext): number {
  const floor = c.collapsedSize ?? 0;
  let ceiling = c.max;
  if (!Number.isFinite(ctx.containerPx) || ctx.containerPx <= 0) return ceiling;
  if (c.maxFraction) ceiling = Math.min(ceiling, ctx.containerPx * c.maxFraction);
  const room = ctx.containerPx - ctx.centerMinPx - ctx.otherPanelsPx;
  return clamp(Math.min(ceiling, room), floor, ceiling);
}

/** Intent -> the px we actually render. */
export function resolveSize(state: PanelState, c: PanelConstraints, ctx: AxisContext): number {
  if (state.collapsed) return c.collapsedSize ?? 0;
  // `clamp` returns `max` when min > max, which is what we want when the
  // container is too small to honour the panel's own minimum.
  return clamp(state.size, c.min, effectiveMax(c, ctx));
}

/**
 * Where a drag lands.
 *
 * `anchoredRight` covers panels whose handle is on their *leading* edge — the
 * chat artifact, the code agent, the terminal — where moving the pointer in the
 * positive direction makes the panel smaller. Centralized here so that a sign
 * error is caught by a test rather than by eye.
 *
 * Collapse is hysteretic: crossing `collapseAt` downward collapses, and leaving
 * collapsed lands on `min` rather than on the raw pixel. Without the second half
 * the panel oscillates as you drag back out of a collapsed rail.
 */
export function dragToState(
  start: PanelState,
  deltaPx: number,
  anchoredRight: boolean,
  c: PanelConstraints,
  ctx: AxisContext,
): PanelState {
  const max = effectiveMax(c, ctx);
  const from = resolveSize(start, c, ctx);
  const raw = from + deltaPx * (anchoredRight ? -1 : 1);

  if (c.collapseAt !== undefined && raw < c.collapseAt) {
    // Hold the intent size so the toggle button restores where the user was.
    return { size: clamp(start.size, c.min, max), collapsed: true };
  }
  return { size: clamp(raw, c.min, max), collapsed: false };
}

/**
 * Keyboard resize. Returns `null` for keys the handle doesn't own, so the
 * caller knows whether to `preventDefault`.
 *
 * Home/End go to min/max; collapsing is Enter/Space, not an arrow key, so
 * arrowing left from the minimum is deliberately a no-op.
 */
export function keyboardStep(
  state: PanelState,
  key: string,
  shift: boolean,
  anchoredRight: boolean,
  c: PanelConstraints,
  ctx: AxisContext,
): PanelState | null {
  const step = shift ? KEY_STEP_LARGE : KEY_STEP;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return dragToState(state, step, anchoredRight, c, ctx);
    case "ArrowLeft":
    case "ArrowUp":
      return dragToState(state, -step, anchoredRight, c, ctx);
    case "Home":
      return { size: c.min, collapsed: false };
    case "End":
      return { size: effectiveMax(c, ctx), collapsed: false };
    default:
      return null;
  }
}

export function toggleCollapsed(state: PanelState, c: PanelConstraints): PanelState {
  return { size: clamp(state.size, c.min, c.max), collapsed: !state.collapsed };
}

/**
 * Fit every panel on one axis at once, for display only.
 *
 * `effectiveMax` guards a single panel against its siblings' *current* sizes;
 * this handles the case where the container itself shrinks under an already
 * valid arrangement. Shaves proportionally so the result is monotonic and the
 * original sizes reappear when the container grows back. Never mutates `states`.
 */
export function reflow(
  states: PanelState[],
  constraints: PanelConstraints[],
  ctx: { containerPx: number; centerMinPx: number },
): number[] {
  const raw = states.map((s, i) =>
    s.collapsed
      ? (constraints[i].collapsedSize ?? 0)
      : clamp(s.size, constraints[i].min, constraints[i].max),
  );

  const available = ctx.containerPx - ctx.centerMinPx;
  if (!Number.isFinite(available)) return raw;
  if (available <= 0) return raw.map(() => 0);

  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= available) return raw;

  const k = available / total;
  return raw.map((n) => Math.max(0, Math.round(n * k)));
}

/**
 * Fit an axis by collapsing the least important panel first.
 *
 * `reflow` shaves everything proportionally, which is right when the shortfall
 * is small: every panel gives a little and the arrangement is recognisably the
 * same one. It is wrong when the shortfall is large, because two rails at 60% of
 * their minimum are two rails that show nothing — and the chat gained a second
 * rail, so that case is now the common one on a laptop.
 *
 * `priority` is lowest-yields-first: history goes before the run rail, which goes
 * before the artifact. A panel is only sacrificed when shaving alone cannot fit
 * the axis, and the sacrifice is total — a collapsed panel reads as a deliberate
 * layout, a 40%-wide one reads as broken.
 */
export function yieldOrder(
  states: PanelState[],
  constraints: PanelConstraints[],
  priority: number[],
  ctx: { containerPx: number; centerMinPx: number },
): number[] {
  const available = ctx.containerPx - ctx.centerMinPx;
  if (!Number.isFinite(available)) {
    return reflow(states, constraints, ctx);
  }

  const live = states.map((s, i) => !s.collapsed && (constraints[i].collapsedSize ?? 0) < s.size);
  // Minimums, because that is the smallest arrangement in which every open panel
  // still shows what it is for.
  const minsOf = (open: boolean[]) =>
    open.reduce((sum, isOpen, i) => sum + (isOpen ? constraints[i].min : (constraints[i].collapsedSize ?? 0)), 0);

  const open = [...live];
  // Give up panels in priority order until the minimums fit, or none are left.
  const order = states.map((_, i) => i).sort((a, b) => (priority[a] ?? 0) - (priority[b] ?? 0));
  for (const i of order) {
    if (minsOf(open) <= available) break;
    if (open[i]) open[i] = false;
  }

  const forced = states.map((s, i) =>
    open[i] || !live[i] ? s : { size: s.size, collapsed: true },
  );
  return reflow(forced, constraints, ctx);
}

/**
 * Harden a value coming back out of localStorage.
 *
 * Constraints get retuned between deploys, so a previously valid persisted size
 * can be out of range on the next load; this is what stops that from shipping a
 * broken layout.
 */
export function sanitize(raw: unknown, c: PanelConstraints): PanelState {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<PanelState>;
  const n = typeof o.size === "number" && Number.isFinite(o.size) ? o.size : c.defaultSize;
  return { size: clamp(n, c.min, c.max), collapsed: o.collapsed === true };
}

/**
 * Snap a released mobile sheet. A flick beats proximity: throwing the sheet
 * downward should send it to the next stop down even when a higher one is
 * nearer. `velocity` is px/s, positive downward (i.e. shrinking the sheet).
 */
export function snapFraction(raw: number, snaps: number[], velocity = 0): number {
  if (snaps.length === 0) return raw;
  const sorted = [...snaps].sort((a, b) => a - b);

  if (velocity > FLICK_VELOCITY) {
    const below = sorted.filter((s) => s < raw);
    if (below.length) return below[below.length - 1];
  } else if (velocity < -FLICK_VELOCITY) {
    const above = sorted.find((s) => s > raw);
    if (above !== undefined) return above;
  }

  return sorted.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), sorted[0]);
}

/**
 * What the separator reports to assistive tech. Pixels mean nothing to a screen
 * reader, so `now` is a percentage and the prose goes in `aria-valuetext` —
 * which SRs announce on change, so keyboard resize needs no live-region echo.
 */
export function ariaValue(
  size: number,
  containerPx: number,
  label: string,
): { now: number; text: string } {
  const now = containerPx > 0 ? clamp(Math.round((size / containerPx) * 100), 0, 100) : 0;
  return { now, text: `${label}, ${now} percent` };
}
