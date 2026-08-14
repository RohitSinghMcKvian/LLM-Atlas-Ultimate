import { ImageResponse } from "next/og";

/**
 * The social card. `twitter.card` has claimed `summary_large_image` since the
 * first commit with nothing behind it, so every share rendered blank.
 *
 * Drawn rather than photographed, in the same vocabulary as the product: a
 * contour field with the mark sitting on it. Colours are literal because this
 * renders in an isolated Satori pass with no stylesheet — keep them in step
 * with the dark theme in `app/globals.css`.
 */
export const runtime = "nodejs";
export const alt = "LLM Atlas — every model, on one map";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GROUND = "#101112";
const INK = "#E9E9EA";
const MUTED = "#90929A";
const RIDGE = "#D9752F";

/** Mirrors `contour()` in components/brand/logo.tsx, at card scale. */
function contour(
  level: number,
  left: number,
  right: number,
  apexX: number,
  apexY: number,
) {
  const h = level - apexY;
  const toe = level - 0.1 * h;
  const crest = apexY + 0.32 * h;
  return `M ${left} ${level} C ${left + 0.3 * (apexX - left)} ${toe}, ${
    apexX - 0.34 * (apexX - left)
  } ${crest}, ${apexX} ${apexY} C ${apexX + 0.34 * (right - apexX)} ${crest}, ${
    right - 0.3 * (right - apexX)
  } ${toe}, ${right} ${level}`;
}

/**
 * Six bands rather than the mark's three — a card has room for the full ramp.
 * Every band shares one apex column so they read as a single landform; drift
 * them apart and it comes out as two overlapping mountains.
 */
const BANDS = Array.from({ length: 6 }, (_, i) => {
  const t = i / 5;
  return {
    d: contour(
      660 - t * 320,
      -40 + t * 520,
      1500 - t * 400,
      800 - t * 12,
      430 - t * 260,
    ),
    opacity: 0.12 + t * 0.12,
    summit: i === 5,
  };
});

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          background: GROUND,
          padding: 72,
          position: "relative",
        }}
      >
        <svg
          width={1200}
          height={630}
          viewBox="0 0 1200 630"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          {BANDS.map((b) => (
            <path
              key={b.d}
              d={b.d}
              fill="none"
              stroke={b.summit ? RIDGE : INK}
              strokeOpacity={b.summit ? 1 : b.opacity}
              strokeWidth={b.summit ? 3 : 2}
            />
          ))}
          <circle cx={788} cy={170} r={9} fill={RIDGE} />
        </svg>

        <div style={{ display: "flex", flexDirection: "column", zIndex: 1 }}>
          <div
            style={{
              fontSize: 22,
              letterSpacing: 6,
              color: RIDGE,
              textTransform: "uppercase",
            }}
          >
            LLM Atlas
          </div>
          <div
            style={{
              fontSize: 82,
              color: INK,
              marginTop: 18,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            Every model, on one map.
          </div>
          <div style={{ fontSize: 28, color: MUTED, marginTop: 22 }}>
            Learn, compare, cost, route and build — open source, self-hostable.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
