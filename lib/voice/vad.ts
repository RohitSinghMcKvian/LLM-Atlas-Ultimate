/**
 * Voice activity detection.
 *
 * All the voice Atlas had was `lib/hooks/use-speech.ts`: a button that opens
 * `SpeechRecognition` and another button that stops it. That is dictation, and
 * it is why voice never became a conversation - the microphone cannot tell that
 * you have finished speaking, so a person has to.
 *
 * This is the piece that lets it. Pure arithmetic over frames of PCM, with no
 * `AudioContext`, no worklet and no browser at all, so the thresholds and the
 * hysteresis can be tested against recorded audio under `environment: "node"`
 * like everything else in `lib/`. The worklet in `worklet/vad.worklet.ts` is a
 * thin host that feeds this and nothing more.
 *
 * Three decisions carry most of the behaviour:
 *
 *  1. **The noise floor adapts only while nobody is speaking.** Adapting during
 *     speech is the classic bug: the floor climbs to meet the voice, the
 *     threshold follows it, and the detector goes deaf mid-sentence.
 *  2. **Onset and offset use different thresholds.** One threshold chatters -
 *     every pause between words crosses it - and a chattering detector produces
 *     an endpoint on every breath.
 *  3. **Zero-crossing rate vetoes, it does not vote.** Loud broadband noise (a
 *     fan, a door) has energy like speech and a very different ZCR, so it is
 *     worth rejecting; but ZCR alone is far too unstable to detect speech with.
 */

export interface VadConfig {
  /** Frame length in milliseconds. 20-30ms is the usual window for speech. */
  frameMs: number;
  /** How far above the noise floor energy must rise to start. */
  onsetRatio: number;
  /**
   * How far above the floor it must stay to continue.
   *
   * Below `onsetRatio`, always. The gap between them is the hysteresis band,
   * and it is what stops the gap between two words ending the utterance.
   */
  offsetRatio: number;
  /** Absolute floor, so silence in a very quiet room does not trigger on noise. */
  minEnergy: number;
  /** EWMA rate for the noise floor, per frame, while not speaking. */
  noiseAdapt: number;
  /** Frames of sub-threshold audio tolerated before speech is declared over. */
  hangoverFrames: number;
  /** Frames of above-threshold audio required before speech is declared. */
  onsetFrames: number;
  /** ZCR band, as a fraction of samples. Outside it, a loud frame is not voice. */
  minZcr: number;
  maxZcr: number;
}

export const DEFAULT_VAD: VadConfig = {
  frameMs: 20,
  onsetRatio: 3.5,
  offsetRatio: 1.8,
  minEnergy: 0.0015,
  noiseAdapt: 0.05,
  // 6 frames at 20ms = 120ms of quiet. Shorter and a natural pause between
  // clauses ends the turn; longer and the agent feels slow to answer.
  hangoverFrames: 6,
  // 2 frames = 40ms, enough to reject a click or a key press.
  onsetFrames: 2,
  minZcr: 0.02,
  maxZcr: 0.45,
};

export interface VadState {
  speaking: boolean;
  /** Running estimate of the background level. */
  noiseFloor: number;
  /** Consecutive quiet frames while speaking. */
  quietRun: number;
  /** Consecutive loud frames while not speaking. */
  loudRun: number;
  /** Frames processed since the utterance began. 0 when not speaking. */
  speechFrames: number;
  /** Most recent frame energy, for the level meter. */
  energy: number;
}

export type VadEvent = "speech_start" | "speech_end" | null;

export function initVad(): VadState {
  return {
    speaking: false,
    // Seeded at the absolute floor rather than 0: a floor of 0 makes the first
    // frame infinitely above it, so every session would open with a false start.
    noiseFloor: DEFAULT_VAD.minEnergy,
    quietRun: 0,
    loudRun: 0,
    speechFrames: 0,
    energy: 0,
  };
}

/** Root-mean-square amplitude of a frame. */
export function frameEnergy(frame: Float32Array | readonly number[]): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/** Fraction of adjacent sample pairs that cross zero. */
export function zeroCrossingRate(frame: Float32Array | readonly number[]): number {
  if (frame.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < frame.length; i++) {
    if ((frame[i - 1] >= 0) !== (frame[i] >= 0)) crossings++;
  }
  return crossings / (frame.length - 1);
}

export interface VadStep {
  state: VadState;
  event: VadEvent;
}

/**
 * Advance the detector by one frame.
 *
 * Returns a new state rather than mutating, so a caller can keep the previous
 * one - the worklet posts state to the main thread and a mutated object would
 * arrive already changed.
 */
export function processFrame(
  state: VadState,
  frame: Float32Array | readonly number[],
  cfg: VadConfig = DEFAULT_VAD,
): VadStep {
  const energy = frameEnergy(frame);
  const zcr = zeroCrossingRate(frame);
  const voiceLike = zcr >= cfg.minZcr && zcr <= cfg.maxZcr;

  const floor = Math.max(state.noiseFloor, cfg.minEnergy);
  const loud = energy > floor * cfg.onsetRatio && energy > cfg.minEnergy && voiceLike;
  const stillLoud = energy > floor * cfg.offsetRatio && energy > cfg.minEnergy;

  if (!state.speaking) {
    // Adapt only here. Doing it during speech is what makes a detector go deaf
    // mid-sentence: the floor climbs to meet the voice and the threshold follows.
    const noiseFloor = floor + (energy - floor) * cfg.noiseAdapt;
    const loudRun = loud ? state.loudRun + 1 : 0;
    if (loudRun >= cfg.onsetFrames) {
      return {
        state: { ...state, speaking: true, noiseFloor, loudRun: 0, quietRun: 0, speechFrames: loudRun, energy },
        event: "speech_start",
      };
    }
    return { state: { ...state, noiseFloor, loudRun, energy }, event: null };
  }

  const quietRun = stillLoud ? 0 : state.quietRun + 1;
  const speechFrames = state.speechFrames + 1;
  if (quietRun >= cfg.hangoverFrames) {
    return {
      state: { ...state, speaking: false, quietRun: 0, loudRun: 0, speechFrames: 0, energy },
      event: "speech_end",
    };
  }
  return { state: { ...state, quietRun, speechFrames, energy }, event: null };
}

/** Run a whole buffer, for tests and for offline analysis. */
export function processBuffer(
  samples: Float32Array | readonly number[],
  cfg: VadConfig = DEFAULT_VAD,
  sampleRate = 16_000,
): { events: { event: Exclude<VadEvent, null>; atMs: number }[]; state: VadState } {
  const frameLength = Math.max(1, Math.round((cfg.frameMs / 1000) * sampleRate));
  let state = initVad();
  const events: { event: Exclude<VadEvent, null>; atMs: number }[] = [];
  for (let i = 0; i + frameLength <= samples.length; i += frameLength) {
    const frame = Array.prototype.slice.call(samples, i, i + frameLength) as number[];
    const step = processFrame(state, frame, cfg);
    state = step.state;
    if (step.event) events.push({ event: step.event, atMs: Math.round((i / sampleRate) * 1000) });
  }
  return { events, state };
}

/**
 * 0..1 level for the meter, relative to the current noise floor.
 *
 * Logarithmic, because loudness is: a linear meter spends most of its travel in
 * the bottom tenth and reads as dead until someone shouts.
 */
export function levelOf(state: VadState, cfg: VadConfig = DEFAULT_VAD): number {
  const floor = Math.max(state.noiseFloor, cfg.minEnergy);
  if (state.energy <= floor) return 0;
  const ratio = state.energy / floor;
  return Math.max(0, Math.min(1, Math.log10(ratio) / Math.log10(cfg.onsetRatio * 8)));
}
