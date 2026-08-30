import { describe, it, expect } from "vitest";
import {
  BANDS,
  BAND_BG,
  BAND_BORDER,
  BAND_LABEL,
  BAND_RGB,
  BAND_TEXT,
  BAND_VAR,
  blindLabel,
  toBand,
} from "./bands";
import { MAX_LANES } from "./types";

describe("the ramp", () => {
  it("has exactly as many bands as a run has lanes", () => {
    // Not a coincidence: the lane cap exists because the ramp ends.
    expect(BANDS).toHaveLength(MAX_LANES);
  });

  it("covers every band in every table", () => {
    for (const band of BANDS) {
      expect(BAND_LABEL[band]).toBeTruthy();
      expect(BAND_VAR[band]).toBe(`--elev-${band}`);
      expect(BAND_RGB[band]).toBe(`rgb(var(--elev-${band}))`);
      expect(BAND_TEXT[band]).toBe(`text-elev-${band}`);
      expect(BAND_BG[band]).toBe(`bg-elev-${band}`);
      expect(BAND_BORDER[band]).toBe(`border-elev-${band}`);
    }
  });

  it("names the bands as the survey does, low to high", () => {
    expect(BANDS.map((b) => BAND_LABEL[b])).toEqual([
      "Deep",
      "Shelf",
      "Lowland",
      "Upland",
      "Ridge",
      "Summit",
    ]);
  });

  it("writes class names out in full so Tailwind can see them", () => {
    // An interpolated `text-elev-${n}` would appear in the markup and never in
    // the stylesheet, and every lane would render in the inherited colour.
    for (const value of Object.values(BAND_TEXT)) {
      expect(value).not.toContain("$");
    }
  });
});

describe("blindLabel", () => {
  it("names lanes A through F, in band order", () => {
    expect(BANDS.map(blindLabel)).toEqual([
      "Lane A",
      "Lane B",
      "Lane C",
      "Lane D",
      "Lane E",
      "Lane F",
    ]);
  });
});

describe("toBand", () => {
  it("passes real bands through", () => {
    for (const b of BANDS) expect(toBand(b)).toBe(b);
  });

  it("wraps rather than producing a band the ramp does not have", () => {
    expect(toBand(6)).toBe(0);
    expect(toBand(7)).toBe(1);
  });

  it("survives a corrupt record rather than rendering colourless", () => {
    expect(toBand(Number.NaN)).toBe(0);
    expect(toBand(-3)).toBe(3);
  });
});
