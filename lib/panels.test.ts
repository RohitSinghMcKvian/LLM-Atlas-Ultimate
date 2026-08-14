import { describe, expect, it } from "vitest";
import {
  CHAT_ARTIFACT,
  CHAT_CENTER_MIN,
  CHAT_HISTORY,
  CODE_AGENT,
  CODE_CENTER_MIN,
  CODE_EXPLORER,
  CODE_TERMINAL,
  KEY_STEP,
  SHEET_SNAPS,
  ariaValue,
  dragToState,
  effectiveMax,
  keyboardStep,
  reflow,
  sanitize,
  snapFraction,
  toggleCollapsed,
  yieldOrder,
  type AxisContext,
  type PanelState,
} from "./panels";

/**
 * These cover the four ways the layout can actually break in the browser:
 * a drag that runs backwards, a collapse that flickers, a center pane that
 * gets squeezed out of existence behind `overflow-hidden`, and a persisted
 * size that survives a constraint change it no longer satisfies.
 */

const open = (size: number): PanelState => ({ size, collapsed: false });

/** /code at 1440px with only the explorer open. */
function codeCtx(over: Partial<AxisContext> = {}): AxisContext {
  return { containerPx: 1440, centerMinPx: CODE_CENTER_MIN, otherPanelsPx: 0, ...over };
}

describe("dragToState — direction", () => {
  it("grows a right-anchored panel when the pointer moves left", () => {
    // The agent panel's handle is on its leading edge: negative delta = wider.
    // Getting this sign backwards is invisible in review and obvious in the UI.
    const next = dragToState(open(400), -60, true, CODE_AGENT, codeCtx());
    expect(next.size).toBe(460);
  });

  it("shrinks a right-anchored panel when the pointer moves right", () => {
    expect(dragToState(open(400), 40, true, CODE_AGENT, codeCtx()).size).toBe(360);
  });

  it("grows a left-anchored panel when the pointer moves right", () => {
    expect(dragToState(open(208), 60, false, CODE_EXPLORER, codeCtx()).size).toBe(268);
  });
});

describe("dragToState — collapse hysteresis", () => {
  const ctx = codeCtx();

  it("collapses below collapseAt and keeps the intent size for restore", () => {
    const next = dragToState(open(300), -200, false, CODE_EXPLORER, ctx);
    expect(next.collapsed).toBe(true);
    // 300 is preserved so the toggle button puts the user back where they were.
    expect(next.size).toBe(300);
  });

  it("leaves a collapsed panel at min, not at the raw pixel", () => {
    const collapsed: PanelState = { size: 300, collapsed: true };
    // collapseAt is 120 and min is 160: crossing at 130 must land on 160.
    const next = dragToState(collapsed, 130, false, CODE_EXPLORER, ctx);
    expect(next.collapsed).toBe(false);
    expect(next.size).toBe(CODE_EXPLORER.min);
  });

  it("never oscillates across the collapse threshold", () => {
    // Sweep the whole approach and assert the collapsed flag only ever flips
    // once, in one direction — the failure mode is a rail that strobes.
    const flips: boolean[] = [];
    for (let delta = 0; delta >= -260; delta -= 2) {
      flips.push(dragToState(open(260), delta, false, CODE_EXPLORER, ctx).collapsed);
    }
    const transitions = flips.filter((v, i) => i > 0 && v !== flips[i - 1]).length;
    expect(transitions).toBe(1);
    expect(flips[0]).toBe(false);
    expect(flips[flips.length - 1]).toBe(true);
  });

  it("snaps a non-collapsible panel back to min instead of collapsing", () => {
    // Right-anchored, so a positive delta shrinks it: 460 - 400 is well under min.
    const next = dragToState(open(460), 400, true, CHAT_ARTIFACT, {
      containerPx: 1600,
      centerMinPx: 520,
      otherPanelsPx: 256,
    });
    expect(next.collapsed).toBe(false);
    expect(next.size).toBe(CHAT_ARTIFACT.min);
  });
});

describe("effectiveMax — the center pane floor", () => {
  it("shrinks the agent's ceiling as the explorer takes room", () => {
    const roomy = effectiveMax(CODE_AGENT, codeCtx({ otherPanelsPx: 0 }));
    const tight = effectiveMax(CODE_AGENT, codeCtx({ containerPx: 1280, otherPanelsPx: 360 }));
    expect(roomy).toBe(CODE_AGENT.max); // 1440 - 480 - 0 = 960, so `max` binds
    expect(tight).toBe(440); // 1280 - 480 - 360
    expect(tight).toBeLessThan(roomy);
  });

  it("keeps the center at or above its floor for every pair of sizes", () => {
    // The guarantee that stops content becoming unreachable behind
    // `overflow-hidden`, which shows no scrollbar to hint at the problem.
    for (const containerPx of [1024, 1280, 1440, 1920]) {
      for (let explorer = CODE_EXPLORER.min; explorer <= CODE_EXPLORER.max; explorer += 20) {
        const ctx = codeCtx({ containerPx, otherPanelsPx: explorer });
        const agent = dragToState(open(9999), 0, true, CODE_AGENT, ctx).size;
        expect(containerPx - explorer - agent).toBeGreaterThanOrEqual(0);
        if (containerPx - explorer >= CODE_CENTER_MIN) {
          expect(containerPx - explorer - agent).toBeGreaterThanOrEqual(CODE_CENTER_MIN);
        }
      }
    }
  });

  it("applies maxFraction alongside max for the terminal", () => {
    // 60% of an 800px column is 480, well under the 640px `max`.
    expect(effectiveMax(CODE_TERMINAL, { containerPx: 800, centerMinPx: 200, otherPanelsPx: 0 })).toBe(480);
    // At 400px the editor floor binds first: 400 - 200 = 200.
    expect(effectiveMax(CODE_TERMINAL, { containerPx: 400, centerMinPx: 200, otherPanelsPx: 0 })).toBe(200);
  });

  it("falls back to the static max before the container is measured", () => {
    expect(effectiveMax(CODE_AGENT, codeCtx({ containerPx: 0 }))).toBe(CODE_AGENT.max);
  });
});

describe("reflow", () => {
  const states = [open(360), open(560)];
  const constraints = [CODE_EXPLORER, CODE_AGENT];

  it("returns the intended sizes when they fit", () => {
    expect(reflow(states, constraints, { containerPx: 1920, centerMinPx: CODE_CENTER_MIN })).toEqual([
      360, 560,
    ]);
  });

  it("shaves proportionally when the container shrinks", () => {
    const tight = reflow(states, constraints, { containerPx: 1024, centerMinPx: CODE_CENTER_MIN });
    expect(tight[0] + tight[1]).toBeLessThanOrEqual(1024 - CODE_CENTER_MIN);
    expect(tight[0]).toBeLessThan(360);
  });

  it("restores the original sizes when the container grows back", () => {
    // The whole point of keeping intent separate from display: a window resize
    // round-trip must be lossless.
    reflow(states, constraints, { containerPx: 900, centerMinPx: CODE_CENTER_MIN });
    expect(reflow(states, constraints, { containerPx: 1920, centerMinPx: CODE_CENTER_MIN })).toEqual([
      360, 560,
    ]);
    expect(states).toEqual([open(360), open(560)]);
  });

  it("reports collapsed panels at their collapsed size", () => {
    const [explorer] = reflow(
      [{ size: 300, collapsed: true }],
      [CODE_EXPLORER],
      { containerPx: 1440, centerMinPx: CODE_CENTER_MIN },
    );
    expect(explorer).toBe(0);
  });
});

/**
 * Shaving proportionally is right for a small shortfall and wrong for a large
 * one: two rails at 60% of their minimum are two rails that show nothing. The
 * chat gained a second rail, so that case is now the common one on a laptop.
 */
describe("yieldOrder", () => {
  const constraints = [CHAT_HISTORY, CHAT_ARTIFACT];
  // History yields before the artifact rail.
  const priority = [0, 1];
  const states = [open(CHAT_HISTORY.defaultSize), open(CHAT_ARTIFACT.defaultSize)];

  it("leaves a roomy axis exactly as reflow would", () => {
    const ctx = { containerPx: 1920, centerMinPx: CHAT_CENTER_MIN };
    expect(yieldOrder(states, constraints, priority, ctx)).toEqual(
      reflow(states, constraints, ctx),
    );
  });

  it("collapses the lowest-priority panel before squeezing the rest", () => {
    // Room for the centre and one rail, but not both at their minimums.
    const ctx = {
      containerPx: CHAT_CENTER_MIN + CHAT_ARTIFACT.min + 60,
      centerMinPx: CHAT_CENTER_MIN,
    };
    const [history, artifact] = yieldOrder(states, constraints, priority, ctx);
    expect(history).toBe(0);
    expect(artifact).toBeGreaterThanOrEqual(CHAT_ARTIFACT.min);
  });

  it("keeps both when both minimums fit", () => {
    const ctx = {
      containerPx: CHAT_CENTER_MIN + CHAT_HISTORY.min + CHAT_ARTIFACT.min + 40,
      centerMinPx: CHAT_CENTER_MIN,
    };
    const [history, artifact] = yieldOrder(states, constraints, priority, ctx);
    expect(history).toBeGreaterThan(0);
    expect(artifact).toBeGreaterThan(0);
  });

  it("respects the priority order it is given", () => {
    const ctx = {
      containerPx: CHAT_CENTER_MIN + CHAT_HISTORY.min + 60,
      centerMinPx: CHAT_CENTER_MIN,
    };
    // Reversed: the artifact rail is now the one that yields.
    const [history, artifact] = yieldOrder(states, constraints, [1, 0], ctx);
    expect(artifact).toBe(0);
    expect(history).toBeGreaterThan(0);
  });

  it("never resurrects a panel the user collapsed", () => {
    const closed = [{ size: 256, collapsed: true }, open(CHAT_ARTIFACT.defaultSize)];
    const [history] = yieldOrder(closed, constraints, priority, {
      containerPx: 1920,
      centerMinPx: CHAT_CENTER_MIN,
    });
    expect(history).toBe(0);
  });

  // Intent is never mutated, so a window resize round trip stays lossless.
  it("does not mutate the states it is given", () => {
    const before = JSON.parse(JSON.stringify(states));
    yieldOrder(states, constraints, priority, {
      containerPx: 600,
      centerMinPx: CHAT_CENTER_MIN,
    });
    expect(states).toEqual(before);
  });

  it("degrades to reflow when the container has not been measured", () => {
    const ctx = { containerPx: Number.NaN, centerMinPx: CHAT_CENTER_MIN };
    expect(yieldOrder(states, constraints, priority, ctx)).toEqual(
      reflow(states, constraints, ctx),
    );
  });
});

describe("sanitize", () => {
  it("falls back to the default for junk", () => {
    for (const junk of [undefined, null, {}, 42, "200", { size: NaN }, { size: "x" }]) {
      expect(sanitize(junk, CODE_AGENT).size).toBe(CODE_AGENT.defaultSize);
    }
  });

  it("clamps out-of-range persisted values", () => {
    expect(sanitize({ size: -5 }, CODE_AGENT).size).toBe(CODE_AGENT.min);
    expect(sanitize({ size: 99999 }, CODE_AGENT).size).toBe(CODE_AGENT.max);
  });

  it("re-clamps when a constraint is lowered between deploys", () => {
    const persisted = { size: 560, collapsed: false };
    expect(sanitize(persisted, { ...CODE_AGENT, max: 400 }).size).toBe(400);
  });

  it("only trusts a literal boolean for collapsed", () => {
    expect(sanitize({ size: 400, collapsed: "yes" }, CODE_AGENT).collapsed).toBe(false);
    expect(sanitize({ size: 400, collapsed: true }, CODE_AGENT).collapsed).toBe(true);
  });
});

describe("keyboardStep", () => {
  const ctx = codeCtx();

  it("steps by KEY_STEP and respects the anchor", () => {
    expect(keyboardStep(open(208), "ArrowRight", false, false, CODE_EXPLORER, ctx)?.size).toBe(
      208 + KEY_STEP,
    );
    // Right-anchored: ArrowRight moves the separator right, so the panel shrinks.
    expect(keyboardStep(open(400), "ArrowRight", false, true, CODE_AGENT, ctx)?.size).toBe(
      400 - KEY_STEP,
    );
  });

  it("is a no-op past the boundaries", () => {
    const atEnd = keyboardStep(open(208), "End", false, false, CODE_EXPLORER, ctx)!;
    expect(keyboardStep(atEnd, "ArrowRight", false, false, CODE_EXPLORER, ctx)?.size).toBe(atEnd.size);

    // Arrowing off the minimum does not collapse — that is Enter/Space's job.
    const atHome = keyboardStep(open(208), "Home", false, false, CODE_EXPLORER, ctx)!;
    const past = keyboardStep(atHome, "ArrowLeft", false, false, CODE_EXPLORER, ctx)!;
    expect(past).toEqual({ size: CODE_EXPLORER.min, collapsed: false });
  });

  it("returns null for keys it does not own", () => {
    expect(keyboardStep(open(208), "Tab", false, false, CODE_EXPLORER, ctx)).toBeNull();
  });
});

describe("toggleCollapsed", () => {
  it("round-trips without losing the size", () => {
    const a = open(320);
    const b = toggleCollapsed(a, CODE_EXPLORER);
    expect(b.collapsed).toBe(true);
    expect(toggleCollapsed(b, CODE_EXPLORER)).toEqual(a);
  });
});

describe("snapFraction", () => {
  it("takes the nearest stop on a slow release", () => {
    expect(snapFraction(0.7, SHEET_SNAPS, 0)).toBe(0.75);
  });

  it("lets a downward flick beat proximity", () => {
    // Nearest is 0.75, but the sheet was thrown downward — go to 0.5.
    expect(snapFraction(0.7, SHEET_SNAPS, 900)).toBe(0.5);
  });

  it("lets an upward flick beat proximity", () => {
    expect(snapFraction(0.55, SHEET_SNAPS, -900)).toBe(0.75);
  });

  it("falls back to nearest when a flick has nowhere to go", () => {
    expect(snapFraction(0.5, SHEET_SNAPS, 900)).toBe(0.5);
    expect(snapFraction(0.92, SHEET_SNAPS, -900)).toBe(0.92);
  });
});

describe("ariaValue", () => {
  it("reports percent of container, not pixels", () => {
    expect(ariaValue(256, 1280, "History sidebar")).toEqual({
      now: 20,
      text: "History sidebar, 20 percent",
    });
  });

  it("survives an unmeasured container", () => {
    expect(ariaValue(256, 0, "History sidebar").now).toBe(0);
  });
});
