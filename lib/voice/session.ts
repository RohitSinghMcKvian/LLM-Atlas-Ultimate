import { DEFAULT_ENDPOINT, initEndpoint, open, step, type EndpointConfig, type EndpointState } from "./endpoint";

/**
 * The voice conversation, as a state machine.
 *
 * Dictation is one state; a conversation is five, and the transitions between
 * them are where every irritating voice interface goes wrong. Written as a pure
 * reducer plus a driver, in the shape of `lib/engine/task-loop.ts`, so the
 * transitions can be tested against event traces without a microphone, a model
 * or an audio device.
 *
 * `barge-in` is the transition that matters most. While the agent is speaking,
 * the detector keeps listening; sustained speech cancels playback and reopens
 * capture. Without it the only way to interrupt is to wait, and a voice
 * assistant you cannot interrupt is one you stop using.
 */

export type VoicePhase =
  /** Microphone closed, nothing playing. */
  | "idle"
  /** Microphone open, waiting for or capturing speech. */
  | "listening"
  /** Utterance captured, being turned into text. */
  | "transcribing"
  /** The agent is working. */
  | "thinking"
  /** The agent is speaking. */
  | "speaking";

export interface VoiceState {
  phase: VoicePhase;
  endpoint: EndpointState;
  /** What the user said, as it is being heard. */
  partial: string;
  /** The last committed utterance. */
  utterance: string;
  /** Consecutive frames of speech heard while the agent is talking. */
  bargeFrames: number;
  /** Set when the session stopped for a reason worth showing. */
  note?: string;
}

export type VoiceEvent =
  | { kind: "start"; now: number }
  | { kind: "stop" }
  | { kind: "frame"; speaking: boolean; now: number; partial?: string }
  | { kind: "transcribed"; text: string }
  | { kind: "thinking" }
  | { kind: "speaking" }
  | { kind: "spoken" }
  | { kind: "error"; message: string };

export type VoiceAction =
  | { kind: "none" }
  /** Send this utterance to be transcribed. */
  | { kind: "transcribe"; audio: "captured" }
  /** Nothing usable was captured; reopen without troubling the model. */
  | { kind: "reopen"; reason: string }
  /** Stop playback immediately - the user is talking. */
  | { kind: "barge_in" }
  /** Hand the text to the agent. */
  | { kind: "ask"; text: string }
  | { kind: "close"; reason: string };

export interface VoiceConfig extends EndpointConfig {
  /**
   * Frames of speech during playback before the agent yields the floor.
   *
   * Not one frame: echo cancellation is imperfect and a cough is not an
   * interruption. Not many either - every frame of delay is the user talking
   * over an agent that has not noticed.
   */
  bargeFrames: number;
}

export const DEFAULT_VOICE: VoiceConfig = { ...DEFAULT_ENDPOINT, bargeFrames: 3 };

export function initVoice(): VoiceState {
  return { phase: "idle", endpoint: initEndpoint(), partial: "", utterance: "", bargeFrames: 0 };
}

export function reduce(
  state: VoiceState,
  event: VoiceEvent,
  cfg: VoiceConfig = DEFAULT_VOICE,
): { state: VoiceState; action: VoiceAction } {
  switch (event.kind) {
    case "start":
      return {
        state: { ...initVoice(), phase: "listening", endpoint: open(event.now) },
        action: { kind: "none" },
      };

    case "stop":
      return {
        state: { ...state, phase: "idle", endpoint: initEndpoint(), partial: "", bargeFrames: 0 },
        action: { kind: "close", reason: "stopped" },
      };

    case "frame":
      return onFrame(state, event, cfg);

    case "transcribed": {
      const text = event.text.trim();
      if (!text) {
        // The transcriber heard nothing usable. Reopening is right; asking the
        // model to answer an empty question is not.
        return {
          state: { ...state, phase: "listening", endpoint: open(Date.now()), partial: "" },
          action: { kind: "reopen", reason: "nothing was heard" },
        };
      }
      return {
        state: { ...state, phase: "thinking", utterance: text, partial: "" },
        action: { kind: "ask", text },
      };
    }

    case "thinking":
      return { state: { ...state, phase: "thinking" }, action: { kind: "none" } };

    case "speaking":
      return { state: { ...state, phase: "speaking", bargeFrames: 0 }, action: { kind: "none" } };

    case "spoken":
      // The turn is over: hand the floor straight back rather than making the
      // user press anything. This is what makes it a conversation.
      return {
        state: { ...state, phase: "listening", endpoint: open(Date.now()), bargeFrames: 0 },
        action: { kind: "none" },
      };

    case "error":
      return {
        state: { ...state, phase: "idle", endpoint: initEndpoint(), note: event.message },
        action: { kind: "close", reason: event.message },
      };
  }
}

function onFrame(
  state: VoiceState,
  event: Extract<VoiceEvent, { kind: "frame" }>,
  cfg: VoiceConfig,
): { state: VoiceState; action: VoiceAction } {
  // Barge-in. Checked before anything else: the whole point is that it beats
  // whatever else the session was doing.
  if (state.phase === "speaking" || state.phase === "thinking") {
    if (!event.speaking) return { state: { ...state, bargeFrames: 0 }, action: { kind: "none" } };
    const frames = state.bargeFrames + 1;
    if (frames < cfg.bargeFrames) {
      return { state: { ...state, bargeFrames: frames }, action: { kind: "none" } };
    }
    return {
      state: {
        ...state,
        phase: "listening",
        endpoint: open(event.now),
        bargeFrames: 0,
        partial: "",
      },
      action: { kind: "barge_in" },
    };
  }

  if (state.phase !== "listening") return { state, action: { kind: "none" } };

  const r = step(state.endpoint, { speaking: event.speaking, now: event.now, partial: event.partial }, cfg);
  const next: VoiceState = {
    ...state,
    endpoint: r.state,
    partial: event.partial ?? state.partial,
  };

  switch (r.action.kind) {
    case "commit":
      return {
        state: { ...next, phase: "transcribing" },
        action: { kind: "transcribe", audio: "captured" },
      };
    case "cancel":
      return {
        state: { ...next, phase: "listening", endpoint: open(event.now), partial: "" },
        action: {
          kind: "reopen",
          reason: r.action.reason === "timeout" ? "no one spoke" : "that was too short",
        },
      };
    default:
      return { state: next, action: { kind: "none" } };
  }
}

/** What the UI says about the current phase. Plain, active, end-user-side. */
export const PHASE_LABELS: Record<VoicePhase, string> = {
  idle: "Voice off",
  listening: "Listening",
  transcribing: "Getting that down",
  thinking: "Working on it",
  speaking: "Speaking",
};

/** True while the microphone should be open. */
export function micOpen(state: VoiceState): boolean {
  // Open during playback too, which is what makes barge-in possible at all.
  return state.phase !== "idle";
}
