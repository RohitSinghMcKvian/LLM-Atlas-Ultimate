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
import { describeIntent, parseIntent, type VoiceIntent } from "@/lib/voice/intent";
import {
  initBackchannel,
  pickBackchannel,
  shouldBackchannel,
  type BackchannelState,
} from "@/lib/voice/backchannel";
import { CONFIRM_ABANDONED, confirmQuestion, parseConfirm } from "@/lib/voice/confirm";
import { KEEPALIVE_MS, bestVoice, clampRate } from "@/lib/voice/voices";
import { feedWake, initWake, resetWake, type WakeState } from "@/lib/voice/wake";
import type { AtlasGraph } from "@/lib/graph/types";

/**
 * The voice conversation, driven.
 *
 * Everything that can be decided without a device is decided somewhere else:
 * `vad.ts` hears speech, `endpoint.ts` decides when a turn ended, `session.ts`
 * is the phase machine, `intent.ts` decides whether something was a command,
 * `confirm.ts` decides what a yes is, `wake.ts` decides what a greeting is, and
 * `voices.ts` decides which voice to use. This file owns only the three things
 * that cannot be pure — a microphone, a clock and a synthesiser — and wires
 * them to those decisions.
 *
 * ### Two listeners, one device
 *
 * The microphone is read twice and that split is the design.
 * `SpeechRecognition` supplies *words*; it will not tell you when a turn is
 * over. The VAD supplies *timing*: when someone started, when they stopped, and
 * whether they are talking over the answer. Using recognition for turn-taking
 * is what makes most browser voice assistants feel like a walkie-talkie.
 *
 * There is exactly **one** recogniser instance, with a `mode`. Waking on "Hey
 * Atlas" and holding a conversation are the same object listening for different
 * things, which is the only way the two can never contend for the device or
 * hear the same utterance twice. A second instance would be a second permission
 * prompt on Safari and a race everywhere else.
 *
 * ### Speaking starts before the answer is finished
 *
 * Segments are spoken as they arrive, and if the first one is slow a short
 * acknowledgement fills the gap — the difference between a conversation and a
 * form submission. An `epoch` counter guards every asynchronous callback so a
 * late token cannot resurrect a turn that was interrupted.
 *
 * ### Nothing is recorded
 *
 * No audio is buffered, uploaded or stored. The analyser sees a live window and
 * the energy figure is discarded on the next tick; recognition happens in the
 * browser's own engine.
 */

/** Poll interval. `DEFAULT_VAD.frameMs` is the window the detector expects. */
const FRAME_MS = DEFAULT_VAD.frameMs;

/**
 * Samples per frame at the analyser's rate.
 *
 * `fftSize` must be a power of two, so the buffer is a little wider than a
 * frame rather than exactly one. Harmless — energy and zero-crossing rate are
 * both averages over the window — and it is why this is not derived from
 * `frameMs`.
 */
const FFT_SIZE = 1024;

/**
 * Tools approved without asking, because their effect is a navigation.
 *
 * Everything else that writes is read back and waits for a yes. `atlas_open` is
 * the exception the person chose: moving to another page is undone by the back
 * button, and confirming every navigation out loud makes the fastest thing the
 * assistant does the slowest.
 */
const AUTO_APPROVE = new Set(["atlas_open"]);

export interface VoiceSessionOptions {
  modelId: string;
  openRouterKey?: string;
  atlas?: AtlasToolPorts;
  /** What is on screen, so a spoken question about it can be answered. */
  surface?: string;
  /**
   * The graph, for the vocabulary. Absent means no correction — the honest
   * degradation, not a reason to refuse to listen.
   */
  graph?: AtlasGraph | null;
  /** Correct model names and prices in what was heard. The `voiceLexicon` flag. */
  correctTranscript?: boolean;
  /** Act on spoken commands rather than sending everything to the model. */
  commands?: boolean;
  /** Catalog entries a command may name. */
  models?: { id: string; name: string }[];
  /** Perform a recognised command. Returns what to say back, or null if it could not. */
  onCommand?: (intent: VoiceIntent) => string | null;
  /** Preferred voice URI and rate. */
  voiceUri?: string;
  rate?: number;
  /** Speak a short acknowledgement when an answer is slow to start. */
  backchannel?: boolean;
  /** Listen for "Hey Atlas" while idle. */
  wakeWord?: boolean;
  /** Called when the wake phrase fires, with any command that rode along. */
  onWake?: (rest: string) => void;
  /** Called when the conversation should close itself ("goodbye"). */
  onEnd?: () => void;
}

/** What is currently being said, for word-by-word captions. */
export interface SpokenNow {
  text: string;
  /** Character offset of the word being spoken, from the synthesiser. */
  charIndex: number;
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
  /** The last recognised command, for the chip. Cleared when it is done. */
  chip: string | null;
  /** What is waiting to be approved. */
  pending: { name: string; question: string } | null;
  /** Answer a pending confirmation from a button rather than out loud. */
  approve: (ok: boolean) => void;
  /** The sentence being spoken and how far through it the synthesiser is. */
  speaking: SpokenNow | null;
  /** Live audio, for the visualiser. Null until the microphone is open. */
  getAnalyser: () => AnalyserNode | null;
  start: () => void;
  stop: () => void;
  /** Stop the answer and take the floor, without waiting to be heard. */
  interrupt: () => void;
  /** Push-to-talk. */
  holdStart: () => void;
  holdEnd: () => void;
  /** True while push-to-talk is held. */
  held: boolean;
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
  const [chip, setChip] = React.useState<string | null>(null);
  const [spokenNow, setSpokenNow] = React.useState<SpokenNow | null>(null);

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
  // Typed with its buffer: `getFloatTimeDomainData` will not accept a view that
  // might sit on a SharedArrayBuffer.
  const bufRef = React.useRef<Float32Array<ArrayBuffer> | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const recRef = React.useRef<Recognition | null>(null);
  /** What the one recogniser is currently listening *for*. */
  const modeRef = React.useRef<"off" | "wake" | "session">("off");

  /** Finalised words since the last commit. Cleared when the turn is sent. */
  const heardRef = React.useRef("");
  const interimRef = React.useRef("");
  /** Whether the engine has committed a final result for this utterance. */
  const finalizedRef = React.useRef(false);
  const wakeRef = React.useRef<WakeState>(initWake());

  const abortRef = React.useRef<AbortController | null>(null);
  const narrationRef = React.useRef<NarrationState>(initNarration());
  const queueRef = React.useRef<string[]>([]);
  const speakingRef = React.useRef(false);
  /** True once the answer is complete, so a drained queue ends the turn. */
  const answerDoneRef = React.useRef(false);
  /** Bumped on every stop and barge-in, so a late callback cannot resurrect a turn. */
  const epochRef = React.useRef(0);
  const backchannelRef = React.useRef<BackchannelState>(initBackchannel());
  const keepaliveRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const voicesRef = React.useRef<SpeechSynthesisVoice[]>([]);
  /** Resolves the promise `onApproval` handed to the tool loop. */
  const confirmRef = React.useRef<((ok: boolean) => void) | null>(null);
  const turnsRef = React.useRef<SessionTurn[]>([]);
  turnsRef.current = turns;

  // --- speaking ------------------------------------------------------------

  const silence = React.useCallback(() => {
    queueRef.current = [];
    speakingRef.current = false;
    setSpokenNow(null);
    if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    keepaliveRef.current = null;
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
      if (answerDoneRef.current) {
        setSpokenNow(null);
        dispatchRef.current({ kind: "spoken" });
      }
      return;
    }
    const epoch = epochRef.current;
    const utterance = new SpeechSynthesisUtterance(next);

    const chosen = bestVoice(voicesRef.current, navigator.language, optsRef.current.voiceUri);
    if (chosen) utterance.voice = chosen as SpeechSynthesisVoice;
    utterance.rate = clampRate(optsRef.current.rate ?? 1);

    setSpokenNow({ text: next, charIndex: 0 });
    // Word boundaries are what make the caption track the voice rather than
    // approximate it with a timer.
    utterance.onboundary = (e) => {
      if (epoch !== epochRef.current) return;
      setSpokenNow({ text: next, charIndex: e.charIndex ?? 0 });
    };
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

    // Chrome stops speaking after roughly fifteen seconds unless the queue is
    // poked. A pause immediately followed by a resume resets its timer with no
    // audible seam.
    if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    keepaliveRef.current = setInterval(() => {
      if (!speakingRef.current) return;
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }, KEEPALIVE_MS);
  }, []);

  const enqueue = React.useCallback(
    (utterances: string[]) => {
      if (utterances.length === 0) return;
      queueRef.current.push(...utterances);
      const phase = stateRef.current.phase;
      // Never during a confirmation: the question has been asked and the answer
      // is what the microphone is open for.
      if (phase !== "speaking" && phase !== "confirming") {
        dispatchRef.current({ kind: "speaking" });
      }
      pump();
    },
    [pump],
  );

  /** Say one line immediately, outside the answer queue. */
  const say = React.useCallback(
    (text: string) => {
      if (!text) return;
      answerDoneRef.current = true;
      enqueue([text]);
    },
    [enqueue],
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
      let started = false;
      const askedAt = Date.now();

      // The acknowledgement, if the answer is slow. Dropped the moment a real
      // segment is ready — one that lands *after* the answer has started is
      // worse than none at all.
      const filler = setTimeout(() => {
        if (epoch !== epochRef.current || started) return;
        if (!optsRef.current.backchannel) return;
        if (!shouldBackchannel(Date.now() - askedAt, started)) return;
        const r = pickBackchannel(backchannelRef.current);
        backchannelRef.current = r.state;
        if (r.phrase) {
          queueRef.current.push(r.phrase);
          if (stateRef.current.phase !== "speaking") dispatchRef.current({ kind: "speaking" });
          pump();
        }
      }, 350);

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
              started = true;
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
            onApproval: async ({ name, title }) => {
              if (epoch !== epochRef.current) return false;
              if (AUTO_APPROVE.has(name)) return true;
              return requestConfirmRef.current(name, title);
            },
            onError: (message) => {
              if (epoch !== epochRef.current) return;
              dispatchRef.current({ kind: "error", message });
            },
          },
        );
      } catch {
        clearTimeout(filler);
        if (epoch === epochRef.current) {
          dispatchRef.current({ kind: "error", message: "That did not go through." });
        }
        return;
      }
      clearTimeout(filler);
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
    [enqueue, pump],
  );

  /**
   * Ask out loud, and resolve when the answer arrives.
   *
   * Held in a ref because the tool loop captures this callback for the whole
   * turn while the phase machine underneath it keeps moving.
   */
  const requestConfirmRef = React.useRef<(name: string, title: string) => Promise<boolean>>(
    async () => false,
  );
  requestConfirmRef.current = (name, title) =>
    new Promise<boolean>((resolve) => {
      const question = confirmQuestion(title);
      confirmRef.current = resolve;
      dispatchRef.current({ kind: "confirm_needed", name, question, now: Date.now() });
      // Spoken directly rather than through the answer queue: the person is
      // being asked something, and it must not sit behind the sentence that
      // prompted it.
      answerDoneRef.current = false;
      queueRef.current.push(question);
      pump();
    });

  const settleConfirm = React.useCallback(
    (approved: boolean) => {
      const resolve = confirmRef.current;
      confirmRef.current = null;
      dispatchRef.current({ kind: "confirmed", approved });
      resolve?.(approved);
      if (!approved) say(CONFIRM_ABANDONED);
    },
    [say],
  );

  // --- commands ------------------------------------------------------------

  /**
   * Act on an utterance without a model, when it was a command.
   *
   * Returns true when it was handled. This is where "ultra fast" comes from: a
   * navigation is a `router.push`, which is single-digit milliseconds against
   * the several seconds a model round-trip costs to reach the same place.
   */
  const runCommand = React.useCallback(
    (intent: VoiceIntent): boolean => {
      const o = optsRef.current;
      if (intent.kind === "ask") return false;

      switch (intent.kind) {
        case "playback": {
          if (intent.op === "stop") {
            epochRef.current++;
            abortRef.current?.abort();
            silence();
            dispatchRef.current({ kind: "spoken" });
            return true;
          }
          if (intent.op === "repeat") {
            const last = [...turnsRef.current].reverse().find((t) => t.role === "assistant");
            silence();
            if (last?.content) {
              narrationRef.current = initNarration();
              answerDoneRef.current = true;
              const r = narrate(initNarration(), last.content);
              const tail = finishNarration(r.state);
              enqueue([...r.utterances, ...tail.utterances]);
            } else {
              say("There is nothing to repeat yet.");
            }
            return true;
          }
          // Rate changes are applied by the caller, which owns the store.
          const said = o.onCommand?.(intent) ?? describeIntent(intent);
          say(said);
          return true;
        }
        case "session":
          if (intent.op === "reset") {
            setTurns([]);
            say("Starting fresh.");
            return true;
          }
          if (intent.op === "end") {
            say("Goodbye.");
            o.onEnd?.();
            return true;
          }
          o.onCommand?.(intent);
          return true;
        default: {
          // Navigation and surface commands are performed by the caller, which
          // owns the router and the page's own state.
          const said = o.onCommand?.(intent);
          if (said === null || said === undefined) return false;
          say(said);
          return true;
        }
      }
    },
    [enqueue, say, silence],
  );

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
          finalizedRef.current = false;
          const o = optsRef.current;
          const text =
            o.correctTranscript && raw
              ? refineTranscript(raw, lexiconFor(o.graph ?? null)).text
              : raw;
          dispatch({ kind: "transcribed", text });
          break;
        }
        case "confirm_reply": {
          const verdict = parseConfirm(action.text);
          if (verdict === "unclear") {
            // Re-ask once rather than guessing. Anything that is not a clear
            // yes must never be treated as one.
            say("Sorry — was that a yes?");
            break;
          }
          settleConfirm(verdict === "yes");
          break;
        }
        case "drop_pending": {
          const resolve = confirmRef.current;
          confirmRef.current = null;
          resolve?.(false);
          say(CONFIRM_ABANDONED);
          break;
        }
        case "run_pending":
          // Nothing to do here: resolving the promise in `settleConfirm` is
          // what lets the tool loop proceed.
          break;
        case "ask": {
          const o = optsRef.current;
          const intent = o.commands
            ? parseIntent(action.text, { models: o.models })
            : ({ kind: "ask", text: action.text } as VoiceIntent);

          if (intent.kind !== "ask") {
            setChip(describeIntent(intent));
            setTurns((t) => [...t, { role: "user", content: action.text }]);
            const handled = runCommand(intent);
            if (handled) break;
            // A command that could not be carried out falls through to the
            // model rather than dead-ending: it may still be answerable.
            setChip(null);
            setTurns((t) => t.slice(0, -1));
          }
          void ask(action.text);
          break;
        }
        case "barge_in":
          // Ordered: raise the epoch first so nothing already in flight can
          // enqueue another sentence behind the silence.
          epochRef.current++;
          abortRef.current?.abort();
          silence();
          heardRef.current = "";
          interimRef.current = "";
          finalizedRef.current = false;
          break;
        case "reopen":
          heardRef.current = "";
          interimRef.current = "";
          finalizedRef.current = false;
          break;
        case "close":
          epochRef.current++;
          abortRef.current?.abort();
          silence();
          confirmRef.current?.(false);
          confirmRef.current = null;
          break;
        default:
          break;
      }
    },
    [ask, runCommand, say, settleConfirm, silence],
  );
  dispatchRef.current = dispatch;

  // --- capture -------------------------------------------------------------

  const teardown = React.useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    keepaliveRef.current = null;
    modeRef.current = "off";
    recRef.current?.abort();
    recRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
    bufRef.current = null;
    vadRef.current = initVad();
    wakeRef.current = initWake();
    setLevel(0);
    setSpokenNow(null);
  }, []);

  /**
   * Load the voice list.
   *
   * Chrome populates it asynchronously and returns an empty array on the first
   * call, which is why a naive `getVoices()[0]` picks nothing and the platform
   * default is used instead — the exact bug this whole module exists to fix.
   */
  const loadVoices = React.useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const read = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length) voicesRef.current = list;
    };
    read();
    window.speechSynthesis.onvoiceschanged = read;
  }, []);

  const start = React.useCallback(() => {
    if (!supported || stateRef.current.phase !== "idle") return;
    loadVoices();
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
      // Smoothing is for the visualiser, which reads frequency data from this
      // same node; the detector reads the time domain and is unaffected.
      analyser.smoothingTimeConstant = 0.75;
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
          if (final) {
            heardRef.current = `${heardRef.current} ${final}`.trim();
            finalizedRef.current = true;
          }
          interimRef.current = interim;

          // Wake listening is the same recogniser in a different mode. In
          // session mode the words are the conversation; in wake mode they are
          // only ever checked against the phrase.
          if (modeRef.current === "wake") {
            const heard = `${heardRef.current} ${interim}`.trim();
            const r = feedWake(wakeRef.current, heard, Date.now());
            wakeRef.current = r.state;
            if (r.fired) {
              heardRef.current = "";
              interimRef.current = "";
              optsRef.current.onWake?.(r.rest);
            }
          }
        };
        // Recognisers stop themselves on silence even with `continuous`. While
        // the session is live that is a restart, not an end — the VAD owns
        // turn-taking, and a recogniser that quietly gave up would leave the
        // microphone open and every later utterance unheard.
        rec.onend = () => {
          if (recRef.current !== rec) return;
          if (modeRef.current === "off") return;
          if (modeRef.current === "session" && !micOpen(stateRef.current)) return;
          try {
            rec.start();
          } catch {
            /* already starting */
          }
        };
        rec.onerror = () => {};
        recRef.current = rec;
        modeRef.current = "session";
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
          partial: interimRef.current || heardRef.current,
          finalized: finalizedRef.current,
        });
      }, FRAME_MS);
    })();
  }, [supported, dispatch, loadVoices]);

  const stop = React.useCallback(() => {
    dispatch({ kind: "stop" });
    teardown();
  }, [dispatch, teardown]);

  // The manual half of barge-in, for a room too loud to be heard over or a
  // person who would rather press something than talk over an answer.
  const interrupt = React.useCallback(() => {
    const phase = stateRef.current.phase;
    if (phase !== "speaking" && phase !== "thinking") return;
    epochRef.current++;
    abortRef.current?.abort();
    silence();
    dispatch({ kind: "spoken" });
  }, [dispatch, silence]);

  const holdStart = React.useCallback(() => {
    if (stateRef.current.phase === "idle") return;
    dispatch({ kind: "ptt_down", now: Date.now() });
  }, [dispatch]);

  const holdEnd = React.useCallback(() => {
    dispatch({ kind: "ptt_up", now: Date.now() });
  }, [dispatch]);

  // The chip is a flash, not a state: it names what was just recognised and
  // then gets out of the way.
  React.useEffect(() => {
    if (!chip) return;
    const t = setTimeout(() => setChip(null), 2_600);
    return () => clearTimeout(t);
  }, [chip]);

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

  const getAnalyser = React.useCallback(() => analyserRef.current, []);

  return {
    supported,
    phase: state.phase,
    level,
    partial: state.partial,
    turns,
    note: state.note,
    listening: micOpen(state),
    chip,
    pending: state.pending ?? null,
    approve: settleConfirm,
    speaking: spokenNow,
    getAnalyser,
    start,
    stop,
    interrupt,
    holdStart,
    holdEnd,
    held: state.held ?? false,
  };
}
