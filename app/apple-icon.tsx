import { ImageResponse } from "next/og";

/**
 * iOS home-screen icon. Rasterised rather than served as SVG because Safari
 * ignores `apple-touch-icon` in SVG form, and drawn without the rounded plate
 * that `icon.svg` carries — iOS applies its own mask and would clip it.
 */
export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#101112",
        }}
      >
        <svg width={180} height={180} viewBox="0 0 32 32">
          <path
            d="M 5 25 H 27"
            stroke="#E9E9EA"
            strokeOpacity={0.22}
            strokeWidth={1}
            strokeLinecap="round"
          />
          <path
            d="M 4.5 25 C 7.59 23.88, 11.298 17.384, 14.8 13.8 C 19.118 17.384, 23.69 23.88, 27.5 25"
            fill="none"
            stroke="#E9E9EA"
            strokeOpacity={0.28}
            strokeWidth={1.7}
            strokeLinecap="round"
          />
          <path
            d="M 8.5 19 C 10.45 18.15, 12.79 13.22, 15 10.5 C 17.89 13.22, 20.95 18.15, 23.5 19"
            fill="none"
            stroke="#E9E9EA"
            strokeOpacity={0.5}
            strokeWidth={1.7}
            strokeLinecap="round"
          />
          <path
            d="M 11.5 13.5 C 12.61 12.9, 13.942 9.42, 15.2 7.5 C 17.07 9.42, 19.05 12.9, 20.7 13.5"
            fill="none"
            stroke="#D9752F"
            strokeWidth={1.9}
            strokeLinecap="round"
          />
          <circle cx={15.2} cy={7.5} r={1.6} fill="#D9752F" />
        </svg>
      </div>
    ),
    size,
  );
}
