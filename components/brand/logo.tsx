"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Atlas mark — a constellation tracing an "A" / star-compass.
 *
 * Designed to read cleanly on both light and dark surfaces:
 *   • A rounded-square backing plate carries a soft brand tint that's
 *     brighter in light mode (so the mark doesn't disappear on white)
 *     and deeper in dark mode (so the glow feels luminous).
 *   • Strokes and nodes always ride the brand gradient, so the shape
 *     is unmistakable regardless of theme.
 */
export function AtlasMark({
  className,
  size = 28,
  /** Drop the backing plate when the caller wants a bare mark
   *  (e.g. inside a coloured pill / avatar bubble). */
  bare = false,
}: {
  className?: string;
  size?: number;
  bare?: boolean;
}) {
  const uid = React.useId().replace(/:/g, "");
  const gStroke = `mark-stroke-${uid}`;
  const gPlate = `mark-plate-${uid}`;
  const gGlow = `mark-glow-${uid}`;
  const gApex = `mark-apex-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        {/* Brand gradient — cyan → violet, used for lines & nodes */}
        <linearGradient id={gStroke} x1="4" y1="4" x2="28" y2="28">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="55%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>

        {/* Backing plate — subtle, theme-adaptive tint */}
        <linearGradient id={gPlate} x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0.14" />
        </linearGradient>

        {/* Inner luminance behind the apex star */}
        <radialGradient id={gGlow} cx="50%" cy="42%" r="55%">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>

        {/* Apex node — extra bright */}
        <radialGradient id={gApex} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="45%" stopColor="#67E8F9" />
          <stop offset="100%" stopColor="#22D3EE" />
        </radialGradient>
      </defs>

      {!bare && (
        <>
          {/* Backing plate — rounded square, sits behind everything */}
          <rect
            x="1"
            y="1"
            width="30"
            height="30"
            rx="8"
            fill={`url(#${gPlate})`}
            stroke="currentColor"
            strokeOpacity="0.14"
            strokeWidth="1"
          />
          {/* Inner glow */}
          <circle cx="16" cy="14" r="11" fill={`url(#${gGlow})`} />
        </>
      )}

      {/* Constellation edges — the "A" */}
      <g
        stroke={`url(#${gStroke})`}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* Left leg */}
        <path d="M16 5 L6.5 26.5" />
        {/* Right leg */}
        <path d="M16 5 L25.5 26.5" />
        {/* Crossbar */}
        <path d="M10.5 18.5 L21.5 18.5" />
        {/* Thin plumb line from apex to crossbar (subtle) */}
        <path d="M16 5 L16 18.5" strokeOpacity="0.35" strokeWidth="1.1" />
      </g>

      {/* Nodes */}
      <g fill={`url(#${gStroke})`}>
        <circle cx="6.5" cy="26.5" r="2.1" />
        <circle cx="25.5" cy="26.5" r="2.1" />
        <circle cx="10.5" cy="18.5" r="1.5" />
        <circle cx="21.5" cy="18.5" r="1.5" />
      </g>

      {/* Apex node — the North Star */}
      <circle cx="16" cy="5" r="3.1" fill={`url(#${gApex})`} />
      <circle
        cx="16"
        cy="5"
        r="3.1"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.55"
        strokeWidth="0.7"
      />

      {/* Midpoint star on the crossbar */}
      <circle cx="16" cy="18.5" r="1.3" fill="#FFFFFF" fillOpacity="0.9" />
    </svg>
  );
}

/**
 * Loading variant of the Atlas mark.
 *
 * Layers on top of the same constellation:
 *   • A rotating conic sweep behind the plate.
 *   • A dashed orbit ring that spins around the mark.
 *   • Staggered pulses on the outer nodes.
 * All animation is suppressed under `prefers-reduced-motion`.
 */
export function AtlasMarkLoading({
  className,
  size = 28,
  /** Speed multiplier — 1 is default; higher = faster. */
  speed = 1,
}: {
  className?: string;
  size?: number;
  speed?: number;
}) {
  const uid = React.useId().replace(/:/g, "");
  const spin = `${1.8 / speed}s`;
  const pulse = `${1.4 / speed}s`;
  const sweep = `${2.6 / speed}s`;

  return (
    <span
      className={cn("relative inline-flex", className)}
      style={{ width: size, height: size }}
      aria-label="Loading"
      role="status"
    >
      {/* Rotating conic backing — soft, sits behind the mark */}
      <span
        className="atlas-loading-conic absolute inset-0 rounded-[26%] opacity-70 motion-reduce:hidden"
        style={{ animationDuration: sweep }}
        aria-hidden
      />

      {/* Static mark on top */}
      <AtlasMark size={size} className="relative z-10" />

      {/* Orbit ring — dashed, spins */}
      <svg
        className="absolute inset-0 z-20 motion-reduce:hidden"
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
      >
        <circle
          cx="16"
          cy="16"
          r="14"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="1"
          strokeDasharray="2 4"
          strokeLinecap="round"
          className="atlas-loading-orbit"
          style={{
            animationDuration: spin,
            transformOrigin: "16px 16px",
          }}
        />
      </svg>

      {/* Pulsing outer nodes — draw on top so they read on the plate */}
      <svg
        className="absolute inset-0 z-30 motion-reduce:hidden"
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
      >
        <g fill="#22D3EE">
          <circle
            cx="6.5"
            cy="26.5"
            r="2.1"
            className="atlas-loading-pulse"
            style={{ animationDuration: pulse, animationDelay: "0s" }}
          />
          <circle
            cx="25.5"
            cy="26.5"
            r="2.1"
            className="atlas-loading-pulse"
            style={{ animationDuration: pulse, animationDelay: `${0.35 / speed}s` }}
          />
          <circle
            cx="16"
            cy="5"
            r="3.1"
            className="atlas-loading-pulse"
            style={{ animationDuration: pulse, animationDelay: `${0.7 / speed}s` }}
          />
        </g>
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display text-[1.05rem] font-semibold leading-none tracking-tight",
        className,
      )}
    >
      LLM&nbsp;<span className="text-gradient">Atlas</span>
    </span>
  );
}

export function BrandLockup({
  className,
  size = 28,
  showWordmark = true,
}: {
  className?: string;
  size?: number;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <AtlasMark size={size} />
      {showWordmark && <Wordmark />}
    </span>
  );
}
