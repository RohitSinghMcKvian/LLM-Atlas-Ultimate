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

  const supported = React.useMemo(() => getRecognitionCtor() !== null, []);

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
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

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

  return { supported, speakingId, speak, cancel, toggle: (id: string, text: string) => (speakingId === id ? cancel() : speak(id, text)) };
}
