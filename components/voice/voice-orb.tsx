"use client";

import * as React from "react";
import type { VoicePhase } from "@/lib/voice/session";

/**
 * Whose turn it is, as one moving shape.
 *
 * The old indicator was a ring that scaled with input level. It was honest and
 * it was inert: at a glance you could not tell "listening" from "thinking", and
 * nothing about it suggested a thing you could talk to. This draws the actual
 * spectrum instead — the analyser is already open for the detector, and its
 * frequency data is the difference between an animation *about* a voice and one
 * *of* it.
 *
 * ### Terrain, kept
 *
 * One hue. `--action` is the colour Terrain reserves for primary action and
 * live state, which is exactly what this is, and it is the only colour drawn.
 * Everything else is opacity and geometry.
 *
 * ### The rules a canvas has to keep on its own
 *
 * The canvas is `aria-hidden` and carries no information that is not also
 * spelled out in the phase label beside it — a voice interface whose only
 * feedback is motion is unusable for the people most likely to want one. With
 * `prefers-reduced-motion` the loop never starts and a static ring is drawn
 * once, which is the whole animation budget spent on nothing.
 */

/** Bars around the circle. Enough to read as a waveform, few enough to stay smooth. */
const BARS = 72;

export function VoiceOrb({
  phase,
  level,
  getAnalyser,
  reduced,
  size = 200,
}: {
  phase: VoicePhase;
  /** 0..1 from the detector, used when there is no analyser to read. */
  level: number;
  getAnalyser: () => AnalyserNode | null;
  reduced: boolean;
  size?: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const phaseRef = React.useRef(phase);
  phaseRef.current = phase;
  const levelRef = React.useRef(level);
  levelRef.current = level;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Backing store at device resolution; the element stays at CSS size.
    const dpr = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const mid = size / 2;
    const base = size * 0.26;
    // Read once: the value is a CSS variable, and reading it per frame would
    // force style resolution sixty times a second.
    const action =
      getComputedStyle(canvas).getPropertyValue("--action").trim().split(/\s+/).join(", ") ||
      "176, 82, 26";

    const bins = new Uint8Array(1024);
    let spin = 0;
    let smoothed = new Array<number>(BARS).fill(0);

    const drawStatic = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = `rgba(${action}, 0.45)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mid, mid, base, 0, Math.PI * 2);
      ctx.stroke();
    };

    if (reduced) {
      drawStatic();
      return;
    }

    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);
      const analyser = getAnalyser();
      const current = phaseRef.current;
      ctx.clearRect(0, 0, size, size);

      let magnitudes: number[];
      if (analyser && (current === "listening" || current === "confirming")) {
        // The real spectrum, while the person is the one talking.
        const count = Math.min(analyser.frequencyBinCount, bins.length);
        analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);
        magnitudes = Array.from({ length: BARS }, (_, i) => {
          // Low bins carry speech; the top of the range is mostly empty, so the
          // sample is compressed into the lower half where the voice actually is.
          const at = Math.floor((i / BARS) ** 1.6 * (count * 0.55));
          return bins[at] / 255;
        });
      } else if (current === "speaking") {
        // The synthesiser's output is not on this analyser — showing the
        // microphone back while the agent talks would be feedback dressed as
        // information — so this is an honest stand-in: a travelling wave.
        spin += 0.09;
        magnitudes = Array.from({ length: BARS }, (_, i) => {
          const a = (i / BARS) * Math.PI * 2;
          return 0.35 + 0.3 * Math.abs(Math.sin(a * 3 + spin)) + 0.12 * Math.sin(a * 7 - spin * 1.4);
        });
      } else if (current === "thinking" || current === "transcribing") {
        // One arc travelling the ring: unmistakably "working", and nothing like
        // the spectrum, so the two phases can never be confused at a glance.
        spin += 0.055;
        magnitudes = Array.from({ length: BARS }, (_, i) => {
          const d = Math.abs(((i / BARS) * Math.PI * 2 - (spin % (Math.PI * 2)) + Math.PI) % (Math.PI * 2) - Math.PI);
          return 0.12 + 0.75 * Math.exp(-(d * d) / 0.15);
        });
      } else {
        magnitudes = new Array(BARS).fill(0.08);
      }

      // Smoothing in the renderer, not the analyser: the detector reads the
      // same node and must not be given a lagged signal.
      smoothed = smoothed.map((prev, i) => prev + (magnitudes[i] - prev) * 0.35);

      const breathe = current === "listening" ? 1 + levelRef.current * 0.12 : 1;

      ctx.lineWidth = Math.max(2, size * 0.014);
      ctx.lineCap = "round";
      for (let i = 0; i < BARS; i++) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const magnitude = smoothed[i];
        const inner = base * breathe;
        const outer = inner + magnitude * size * 0.16;
        ctx.strokeStyle = `rgba(${action}, ${0.25 + magnitude * 0.6})`;
        ctx.beginPath();
        ctx.moveTo(mid + Math.cos(angle) * inner, mid + Math.sin(angle) * inner);
        ctx.lineTo(mid + Math.cos(angle) * outer, mid + Math.sin(angle) * outer);
        ctx.stroke();
      }

      // The core, which reads as "there is something here" even at a glance
      // from across a room — the distance this surface is designed for.
      const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, base);
      glow.addColorStop(0, `rgba(${action}, ${current === "idle" ? 0.1 : 0.22})`);
      glow.addColorStop(1, `rgba(${action}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mid, mid, base, 0, Math.PI * 2);
      ctx.fill();
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [getAnalyser, reduced, size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ width: size, height: size }}
      className="shrink-0"
    />
  );
}
