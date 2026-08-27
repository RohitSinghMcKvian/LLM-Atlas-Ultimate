"use client";

import * as React from "react";

// Voice I/O via the browser's Web Speech API — no key, no network round-trip to
// us. Dictation uses SpeechRecognition (Chrome/Edge/Safari); read-aloud uses
// speechSynthesis (broadly supported). Both degrade to `supported: false` where
// unavailable so the UI can hide the controls.

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  return (
    (window as any).SpeechRecognition ??
    (window as any).webkitSpeechRecognition ??
    null
  );
}

export function useDictation(onText: (finalText: string) => void) {
  const [listening, setListening] = React.useState(false);
  const [interim, setInterim] = React.useState("");
  const recRef = React.useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = React.useRef(onText);
  onTextRef.current = onText;

  // `useState(false)` + an effect, not a `useMemo` computed during render:
  // `getRecognitionCtor` reads `window`, which is absent during SSR and present
  // on the client, so a render-time computation renders "unsupported" on the
  // server and "supported" on the client's first pass - a guaranteed hydration
  // mismatch in every Chromium browser, since every one of them has
  // `webkitSpeechRecognition`. Found live: React discarding and re-rendering
  // the whole composer toggle row on every `/chat` load. Settling this in an
  // effect matches the server's render exactly, then updates after hydration,
  // which is the same pattern `useMediaQuery` already uses in this repo.
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => setSupported(getRecognitionCtor() !== null), []);

  const stop = React.useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const start = React.useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interimChunk += r[0].transcript;
      }
      if (finalChunk) onTextRef.current(finalChunk);
      setInterim(interimChunk);
    };
    rec.onerror = () => {
      setListening(false);
      setInterim("");
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      /* already started */
    }
  }, []);

  React.useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, start, stop, toggle: () => (listening ? stop() : start()) };
}

let speaking: SpeechSynthesisUtterance | null = null;

export function useTTS() {
  const [speakingId, setSpeakingId] = React.useState<string | null>(null);
  // Same reasoning as `useDictation` above: settled in an effect so the
  // server's "unsupported" render and the client's first render agree.
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => setSupported("speechSynthesis" in window), []);

  const cancel = React.useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    speaking = null;
    setSpeakingId(null);
  }, [supported]);

  const speak = React.useCallback(
    (id: string, text: string) => {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      // Strip code fences / markdown noise for a cleaner read.
      const clean = text
        .replace(/```[\s\S]*?```/g, " (code block) ")
        .replace(/[*_`#>]/g, "")
        .slice(0, 4000);
      const u = new SpeechSynthesisUtterance(clean);
      u.onend = () => {
        speaking = null;
        setSpeakingId(null);
      };
      speaking = u;
      setSpeakingId(id);
      window.speechSynthesis.speak(u);
    },
    [supported],
  );

  React.useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  const toggle = React.useCallback(
    (id: string, text: string) => (speakingId === id ? cancel() : speak(id, text)),
    [speakingId, cancel, speak],
  );

  // Memoized because this object is passed down to every message bubble; a
  // fresh literal on each render would defeat their React.memo.
  return React.useMemo(
    () => ({ supported, speakingId, speak, cancel, toggle }),
    [supported, speakingId, speak, cancel, toggle],
  );
}
