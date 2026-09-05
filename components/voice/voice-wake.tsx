"use client";

import * as React from "react";
import { feedWake, initWake, type WakeState } from "@/lib/voice/wake";

/**
 * Listening for "Hey Atlas" while the conversation surface is closed.
 *
 * Headless, and deliberately *not* part of `use-voice-session.ts`: the session
 * owns an `AudioContext`, an analyser, a detector and a synthesiser, none of
 * which are wanted here. This is one recogniser and a string match.
 *
 * ### The handover is the whole point
 *
 * There is never more than one recogniser alive in the app. This one runs only
 * while `armed` is true, and the mount passes `armed={false}` the instant the
 * voice surface opens — so the session's recogniser starts as this one is
 * already stopping. Two live recognisers means a second permission prompt on
 * Safari, an utterance heard twice, and on some builds a device the first
 * instance never gives back.
 *
 * ### What it costs when it is on
 *
 * A live microphone on every page. That is a real posture change for a
 * local-first app, which is why it is behind a flag that is off by default and
 * a preference that is off by default, and why the settings sheet says so in
 * plain words rather than in a tooltip.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  abort: () => void;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

interface SpeechEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => Recognition)
    | null;
}

export function VoiceWakeListener({
  armed,
  onWake,
}: {
  armed: boolean;
  /** Fired once per greeting, with any command that rode along after it. */
  onWake: (rest: string) => void;
}) {
  const onWakeRef = React.useRef(onWake);
  onWakeRef.current = onWake;

  React.useEffect(() => {
    if (!armed) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;

    let stopped = false;
    let state: WakeState = initWake();
    let heard = "";
    const rec = new Ctor();
    rec.lang = typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let final = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) heard = `${heard} ${final}`.trim();
      const transcript = `${heard} ${interim}`.trim();

      const result = feedWake(state, transcript, Date.now());
      state = result.state;
      if (result.fired) {
        heard = "";
        onWakeRef.current(result.rest);
      }
      // Nothing is kept: this holds at most one utterance, and only long enough
      // to test it against six fixed phrases.
      if (heard.length > 400) heard = heard.slice(-200);
    };

    // A recogniser stops itself on silence even with `continuous`. While armed
    // that is a restart, not an end.
    rec.onend = () => {
      if (stopped) return;
      try {
        rec.start();
      } catch {
        /* already starting */
      }
    };
    rec.onerror = () => {};

    try {
      rec.start();
    } catch {
      /* already started */
    }

    return () => {
      stopped = true;
      rec.onend = null;
      rec.abort();
    };
  }, [armed]);

  return null;
}
