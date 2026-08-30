"use client";

import * as React from "react";
import { runSessionTurn, type SessionTurn } from "@/lib/orchestra/session";
import type { AtlasToolPorts } from "@/lib/tools/atlas";
import { DEFAULT_VAD, initVad, levelOf, processFrame, type VadState } from "@/lib/voice/vad";
import {
  DEFAULT_VOICE,
  initVoice,
  micOpen,
  reduce,
  type VoiceEvent,
  type VoicePhase,
  type VoiceState,
} from "@/lib/voice/session";
import { finishNarration, initNarration, narrate, type NarrationState } from "@/lib/voice/narrate";
import { VOICE_PROMPT } from "@/lib/voice/speech-plan";
import { lexiconFor, refineTranscript } from "@/lib/voice/transcript";
import type { AtlasGraph } from "@/lib/graph/types";

/**
 * The voice conversation, driven.
 *
 * Everything decided here was already written and had no caller:
 * `lib/voice/vad.ts` hears speech, `lib/voice/endpoint.ts` decides when a turn
 * ended, `lib/voice/session.ts` is the five-phase machine with barge-in, and
 * `lib/voice/narrate.ts` turns a streaming answer into things to say. This is
 * the part that could not be pure — a microphone, a clock and a synthesiser —
 * and it is deliberately thin: every decision is delegated to a reducer that is
 * tested without any of them.
 *
 * ### Two listeners, two jobs
 *
 * The microphone is read twice, and the split is the design rather than an
 * accident. `SpeechRecognition` supplies *words*; it will not tell you when a
 * turn is over — `continuous` recognisers emit finals on their own schedule,
 * and a non-continuous one ends the turn whenever it feels like it. The VAD
 * supplies *timing*: it knows when someone started, when they stopped, and
 * whether they are talking over the answer. Using recognition for turn-taking
 * is what makes most browser voice assistants feel like a walkie-talkie.
 *
 * Frames come from an `AnalyserNode` polled on a timer rather than from an
 * `AudioWorklet` or a `ScriptProcessorNode`. A worklet needs a separately
 * served module — and this app's CSP does not admit a blob: worklet — while
 * `ScriptProcessorNode` is deprecated and drops frames under load. Twenty
 * milliseconds of time-domain data from an analyser is the same Float32Array
 * `processFrame` wants, with no new asset and nothing deprecated.
 *
 * ### Nothing is recorded
 *
 * No audio is buffered, uploaded or stored anywhere. The analyser sees a live
 * window and the energy figure is discarded on the next tick; recognition
 * happens in the browser's own engine. This is the same posture the rest of
 * Atlas takes with keys and history, and it is why the default transcriber is
 * the browser's rather than a hosted one.
 */

/** Poll interval. `DEFAULT_VAD.frameMs` is the window the detector expects. */
const FRAME_MS = DEFAULT_VAD.frameMs;

/**
 * Samples per frame at the analyser's rate.
 *
 * `fftSize` must be a power of two, so the buffer is a little wider than a
 * frame rather than exactly one. That is harmless — energy and zero-crossing
 * rate are both averages over the window — and it is why this is not derived
 * from `frameMs` directly.
 */
const FFT_SIZE = 1024;

export interface VoiceSessionOptions {
  modelId: string;
  openRouterKey?: string;
  atlas?: AtlasToolPorts;
  /** What is on screen, so a spoken question about it can be answered. */
  surface?: string;
  /**
   * The graph, for the vocabulary. Absent means no correction — which is the
   * honest degradation, not a reason to refuse to listen.
   */
  graph?: AtlasGraph | null;
  /** Correct model names and prices in what was heard. The `voiceLexicon` flag. */
  correctTranscript?: boolean;
  /** Approve a write or spend tool. Absent refuses them, as the dock's does. */
  onApproval?: (info: { name: string; title: string }) => Promise<boolean> | boolean;
}

export interface VoiceSessionApi {
  /** False where there is no microphone or no speech engine. */
  supported: boolean;
  phase: VoicePhase;
  /** 0..1, for a level meter. */
  level: number;
  /** What is being heard right now, before it is committed. */
  partial: string;
  /** The conversation so far. */
  turns: SessionTurn[];
  /** Set when the session stopped for a reason worth showing. */
  note?: string;
  listening: boolean;
  start: () => void;
  stop: () => void;
  /** Stop the answer and take the floor, without waiting to be heard. */
  interrupt: () => void;
}

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
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

export function useVoiceSession(opts: VoiceSessionOptions): VoiceSessionApi {
  // Settled in an effect, never during render: `window` is absent on the server
  // and present on the client, so a render-time answer is a guaranteed
  // hydration mismatch. Same pattern as `useDictation` and `useMediaQuery`.
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => {
    setSupported(
      recognitionCtor() !== null &&
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        "speechSynthesis" in window,
    );
  }, []);

  const [state, setState] = React.useState<VoiceState>(initVoice);
  const [level, setLevel] = React.useState(0);
  const [turns, setTurns] = React.useState<SessionTurn[]>([]);

  // Mirrored into refs because the audio timer, the recogniser and the
  // synthesiser all fire outside React's world and must see the current value,
  // not the one captured when they were installed.
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const vadRef = React.useRef<VadState>(initVad());
  const streamRef = React.useRef<MediaStream | null>(null);
  const ctxRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  // Typed with its buffer: `getFloatTimeDomainData` will not accept a view
  // that might sit on a SharedArrayBuffer.
  const bufRef = React.useRef<Float32Array<ArrayBuffer> | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const recRef = React.useRef<Recognition | null>(null);

  /** Finalised words since the last commit. Cleared when the turn is sent. */
  const heardRef = React.useRef("");
  const interimRef = React.useRef("");

  const abortRef = React.useRef<AbortController | null>(null);
  const narrationRef = React.useRef<NarrationState>(initNarration());
  const queueRef = React.useRef<string[]>([]);
  const speakingRef = React.useRef(false);
  /** True once the answer is complete, so a drained queue ends the turn. */
  const answerDoneRef = React.useRef(false);
  /** Bumped on every stop and barge-in, so a late callback cannot resurrect a turn. */
  const epochRef = React.useRef(0);

  // --- speaking ------------------------------------------------------------

  const silence = React.useCallback(() => {
    queueRef.current = [];
    speakingRef.current = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const dispatchRef = React.useRef<(e: VoiceEvent) => void>(() => {});

  const pump = React.useCallback(() => {
    if (speakingRef.current) return;
    const next = queueRef.current.shift();
    if (next === undefined) {
      // Only when the answer is finished. A drained queue mid-stream means the
      // model is still writing, and handing the floor back there would cut the
      // agent off in the middle of its own sentence.
      if (answerDoneRef.current) dispatchRef.current({ kind: "spoken" });
      return;
    }
    const epoch = epochRef.current;
    const utterance = new SpeechSynthesisUtterance(next);
    utterance.onend = () => {
      if (epoch !== epochRef.current) return;
      speakingRef.current = false;
      pump();
    };
    // A synthesiser that errors must not strand the phase in `speaking`
    // forever; the queue moves on exactly as it would on a normal end.
    utterance.onerror = utterance.onend;
    speakingRef.current = true;
    window.speechSynthesis.speak(utterance);
  }, []);

  const enqueue = React.useCallback(
    (utterances: string[]) => {
      if (utterances.length === 0) return;
      queueRef.current.push(...utterances);
      if (stateRef.current.phase !== "speaking") dispatchRef.current({ kind: "speaking" });
      pump();
    },
    [pump],
  );

  // --- the turn ------------------------------------------------------------

  const ask = React.useCallback(
    async (text: string) => {
      const epoch = epochRef.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      narrationRef.current = initNarration();
      answerDoneRef.current = false;

      const history = [...turnsRef.current];
      setTurns((t) => [...t, { role: "user", content: text }, { role: "assistant", content: "" }]);

      // `onDelta` hands back the whole answer so far, not the increment, so the
      // narrator is fed the difference. Feeding the accumulation would re-speak
      // every sentence on every token.
      let spoken = 0;
      try {
        await runSessionTurn(
          {
            modelId: optsRef.current.modelId,
            question: text,
            history,
            surface: optsRef.current.surface,
            // Voice is a different mode, not a wrapper around the text one: an
            // answer built for the eye is unusable read aloud, and no amount of
            // post-processing fixes an answer shaped wrong to begin with.
            systemExtra: VOICE_PROMPT,
            atlas: optsRef.current.atlas,
            openRouterKey: optsRef.current.openRouterKey,
            signal: ctrl.signal,
          },
          {
            onDelta: (whole) => {
              if (epoch !== epochRef.current) return;
              setTurns((t) => {
                const next = [...t];
                next[next.length - 1] = { role: "assistant", content: whole };
                return next;
              });
              const chunk = whole.slice(spoken);
              spoken = whole.length;
              const r = narrate(narrationRef.current, chunk);
              narrationRef.current = r.state;
              enqueue(r.utterances);
            },
            onApproval: optsRef.current.onApproval,
            onError: (message) => {
              if (epoch !== epochRef.current) return;
              dispatchRef.current({ kind: "error", message });
            },
          },
        );
      } catch {
        if (epoch === epochRef.current) {
          dispatchRef.current({ kind: "error", message: "That did not go through." });
        }
        return;
      }
      if (epoch !== epochRef.current) return;

      const rest = finishNarration(narrationRef.current);
      narrationRef.current = rest.state;
      answerDoneRef.current = true;
      enqueue(rest.utterances);
      // An answer that produced nothing sayable — an empty reply, or one that
      // was entirely a code block — still has to hand the floor back, or the
      // session sits in `thinking` with the microphone open and nothing coming.
      if (queueRef.current.length === 0 && !speakingRef.current) {
        dispatchRef.current({ kind: "spoken" });
      }
    },
    [enqueue],
  );

  const turnsRef = React.useRef<SessionTurn[]>([]);
  turnsRef.current = turns;

  // --- the machine ---------------------------------------------------------

  const dispatch = React.useCallback(
    (event: VoiceEvent) => {
      const { state: next, action } = reduce(stateRef.current, event, DEFAULT_VOICE);
      stateRef.current = next;
      setState(next);

      switch (action.kind) {
        case "transcribe": {
          // The words are already here — recognition has been running the whole
          // time. What the endpoint decided is that the person has *stopped*.
          const raw = (heardRef.current || interimRef.current).trim();
          heardRef.current = "";
          interimRef.current = "";
          const o = optsRef.current;
          const text =
            o.correctTranscript && raw
              ? refineTranscript(raw, lexiconFor(o.graph ?? null)).text
              : raw;
          dispatch({ kind: "transcribed", text });
          break;
        }
        case "ask":
          void ask(action.text);
          break;
        case "barge_in":
          // Ordered: raise the epoch first so nothing already in flight can
          // enqueue another sentence behind the silence.
          epochRef.current++;
          abortRef.current?.abort();
          silence();
          heardRef.current = "";
          interimRef.current = "";
          break;
        case "reopen":
          heardRef.current = "";
          interimRef.current = "";
          break;
        case "close":
          epochRef.current++;
          abortRef.current?.abort();
          silence();
          break;
        default:
          break;
      }
    },
    [ask, silence],
  );
  dispatchRef.current = dispatch;

  // --- capture -------------------------------------------------------------

  const teardown = React.useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    recRef.current?.abort();
    recRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
    bufRef.current = null;
    vadRef.current = initVad();
    setLevel(0);
  }, []);

  const start = React.useCallback(() => {
    if (!supported || stateRef.current.phase !== "idle") return;
    void (async () => {
      let stream: MediaStream;
      try {
        // Echo cancellation is what makes barge-in usable at all: without it
        // the detector hears the synthesiser through the speakers and the agent
        // interrupts itself on its own voice.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        dispatch({
          kind: "error",
          message: "Atlas could not open the microphone. Check the site's permissions.",
        });
        return;
      }
      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      bufRef.current = new Float32Array(analyser.fftSize);

      const Ctor = recognitionCtor();
      if (Ctor) {
        const rec = new Ctor();
        rec.lang = navigator.language || "en-US";
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
          if (final) heardRef.current = `${heardRef.current} ${final}`.trim();
          interimRef.current = interim;
        };
        // Recognisers stop themselves on silence even with `continuous`. While
        // the session is live that is a restart, not an end — the VAD owns
        // turn-taking, and a recogniser that quietly gave up would leave the
        // microphone open and every later utterance unheard.
        rec.onend = () => {
          if (!micOpen(stateRef.current) || recRef.current !== rec) return;
          try {
            rec.start();
          } catch {
            /* already starting */
          }
        };
        rec.onerror = () => {};
        recRef.current = rec;
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }

      dispatch({ kind: "start", now: Date.now() });

      timerRef.current = setInterval(() => {
        const a = analyserRef.current;
        const buf = bufRef.current;
        if (!a || !buf) return;
        a.getFloatTimeDomainData(buf);
        const step = processFrame(vadRef.current, buf);
        vadRef.current = step.state;
        setLevel(levelOf(step.state));
        dispatch({
          kind: "frame",
          speaking: step.state.speaking,
          now: Date.now(),
          partial: interimRef.current,
        });
      }, FRAME_MS);
    })();
  }, [supported, dispatch]);

  const stop = React.useCallback(() => {
    dispatch({ kind: "stop" });
    teardown();
  }, [dispatch, teardown]);

  // The manual half of barge-in, for a room too loud to be heard over or a
  // person who would rather press something than talk over an answer.
  const interrupt = React.useCallback(() => {
    if (stateRef.current.phase !== "speaking" && stateRef.current.phase !== "thinking") return;
    epochRef.current++;
    abortRef.current?.abort();
    silence();
    dispatch({ kind: "spoken" });
  }, [dispatch, silence]);

  // Teardown on unmount is not optional: a live microphone and a running
  // synthesiser both outlive the component that opened them.
  React.useEffect(
    () => () => {
      epochRef.current++;
      abortRef.current?.abort();
      silence();
      teardown();
    },
    [silence, teardown],
  );

  return {
    supported,
    phase: state.phase,
    level,
    partial: state.partial,
    turns,
    note: state.note,
    listening: micOpen(state),
    start,
    stop,
    interrupt,
  };
}
