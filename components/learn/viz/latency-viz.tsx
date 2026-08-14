"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { VizFrame, VizSlider, VizStat, VizToggle } from "./frame";
import { cn } from "@/lib/utils";

/**
 * Where the wait actually goes.
 *
 * Latency has two halves that behave completely differently: prefill scales
 * with the prompt and happens before the user sees anything, decode scales with
 * the output and can be streamed. Teams optimise the wrong one constantly —
 * trimming a 400-token system prompt while generating 900 tokens of preamble.
 *
 * The model below is the standard first-order one, with clearly-labelled
 * illustrative rates. Every figure shown is computed from it.
 */

interface Profile {
  value: string;
  label: string;
  /** Network + queue + scheduling, milliseconds. */
  overhead: number;
  /** Prompt tokens processed per second. */
  prefill: number;
  /** Output tokens generated per second. */
  decode: number;
}

const PROFILES: Profile[] = [
  { value: "small", label: "Small model", overhead: 180, prefill: 12000, decode: 180 },
  { value: "mid", label: "Mid model", overhead: 240, prefill: 6000, decode: 90 },
  { value: "frontier", label: "Frontier", overhead: 320, prefill: 2500, decode: 45 },
];

const fmtMs = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

export function LatencyViz() {
  const [profileId, setProfileId] = React.useState("mid");
  const [promptTokens, setPromptTokens] = React.useState(4000);
  const [outputTokens, setOutputTokens] = React.useState(400);
  const [mode, setMode] = React.useState("stream");

  const p = PROFILES.find((x) => x.value === profileId)!;

  const prefillMs = (promptTokens / p.prefill) * 1000;
  const decodeMs = (outputTokens / p.decode) * 1000;
  const ttft = p.overhead + prefillMs;
  const total = ttft + decodeMs;
  /** What the user experiences as "waiting". Streaming ends it at first token. */
  const perceived = mode === "stream" ? ttft : total;

  const segments = [
    { label: "Overhead", ms: p.overhead, color: "var(--muted-foreground)" },
    { label: "Prefill", ms: prefillMs, color: "var(--elev-0)" },
    { label: "Decode", ms: decodeMs, color: "var(--elev-1)" },
  ];

  return (
    <VizFrame
      label="Latency budget"
      hint="Which half of the wait are you actually paying?"
      controls={
        <>
          <VizToggle
            ariaLabel="Model profile"
            value={profileId}
            onChange={setProfileId}
            options={PROFILES.map((x) => ({ value: x.value, label: x.label }))}
          />
          <VizToggle
            ariaLabel="Delivery mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "stream", label: "Streamed" },
              { value: "buffer", label: "Buffered" },
            ]}
          />
        </>
      }
      footer="First-order model: wait = overhead + prompt/prefill_rate + output/decode_rate. The rates are illustrative round numbers, not measurements of any specific provider — but the shape they produce is the real one, and it is why streaming is not a cosmetic choice."
    >
      <div className="mb-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <VizSlider
          label="Prompt tokens"
          value={promptTokens}
          onChange={setPromptTokens}
          min={200}
          max={60000}
          step={200}
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))}
          accent = "shelf"
        />
        <VizSlider
          label="Output tokens"
          value={outputTokens}
          onChange={setOutputTokens}
          min={20}
          max={4000}
          step={20}
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))}
        />
      </div>

      {/* The wait, to scale. */}
      <div
        className="flex h-10 w-full overflow-hidden rounded-lg border border-border"
        role="img"
        aria-label={`Total ${fmtMs(total)}, first token at ${fmtMs(ttft)}`}
      >
        {segments.map((s) => (
          <motion.div
            key={s.label}
            className="grid h-full place-items-center border-r border-black/20 last:border-r-0"
            animate={{ width: `${(s.ms / total) * 100}%` }}
            transition={{ type: "spring", stiffness: 220, damping: 28 }}
            style={{ background: `rgb(${s.color} / 0.5)` }}
            title={`${s.label}: ${fmtMs(s.ms)}`}
          >
            {s.ms / total > 0.14 && (
              <span className="px-1 text-center font-mono text-2xs font-medium tnum">
                {fmtMs(s.ms)}
              </span>
            )}
          </motion.div>
        ))}
      </div>

      <div className="mt-1.5 flex items-center gap-3 text-2xs text-muted-foreground">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span
              className="size-1.5 rounded-full"
              style={{ background: `rgb(${s.color})` }}
            />
            {s.label}
          </span>
        ))}
        <span className="ml-auto font-mono tnum">total {fmtMs(total)}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <VizStat label="Time to first token" value={fmtMs(ttft)} accent = "shelf" />
        <VizStat label="Generation" value={fmtMs(decodeMs)} accent = "ridge" />
        <VizStat
          label="Perceived wait"
          value={fmtMs(perceived)}
          accent={perceived > 2000 ? "danger" : perceived > 800 ? "upland" : "success"}
        />
        <VizStat
          label="Decode share"
          value={`${((decodeMs / total) * 100).toFixed(0)}%`}
        />
      </div>

      <p
        className={cn(
          "mt-2.5 rounded-lg border px-2.5 py-1.5 text-2xs leading-relaxed",
          mode === "buffer"
            ? "border-amber/35 bg-amber/[0.07] text-amber"
            : "border-border bg-surface-2/40 text-muted-foreground",
        )}
      >
        {mode === "buffer" ? (
          <>
            Buffered, the user waits {fmtMs(total)} staring at a spinner. Streaming
            the same request cuts the perceived wait to {fmtMs(ttft)} — a{" "}
            {(total / ttft).toFixed(1)}× improvement for zero change in total work
            done.
          </>
        ) : decodeMs > prefillMs * 2 ? (
          <>
            Decode dominates. Trimming the prompt would barely help; cutting output
            length, or moving to a faster-decoding model, is where the time is.
          </>
        ) : prefillMs > decodeMs * 2 ? (
          <>
            Prefill dominates. This is the case where prompt caching and shorter
            retrieved context pay for themselves — and where a smaller output cap
            changes nothing.
          </>
        ) : (
          <>
            Roughly balanced. Worth measuring both before optimising either.
          </>
        )}
      </p>
    </VizFrame>
  );
}
