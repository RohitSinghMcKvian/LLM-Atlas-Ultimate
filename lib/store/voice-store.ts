"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_RATE, clampRate } from "@/lib/voice/voices";

/**
 * How this person likes to be spoken to.
 *
 * Separate from `settings-store` on purpose: these are device-shaped rather
 * than account-shaped. The best available voice differs between a Mac and a
 * Windows machine, and a rate that suits headphones does not suit a kitchen
 * speaker — syncing them would make one device worse every time the other was
 * used.
 *
 * `voiceUri` holds `SpeechSynthesisVoice.voiceURI` (falling back to its name),
 * which is stable across launches on every engine tested. A voice that has been
 * uninstalled simply falls back to the ranking in `lib/voice/voices.ts` rather
 * than failing.
 */
export interface VoiceState {
  /** Chosen voice, or empty to let the ranking decide. */
  voiceUri: string;
  rate: number;
  /** Show what is being said, word by word. */
  captions: boolean;
  /** Listen for "Hey Atlas" while the app is open. Off unless asked for. */
  wakeWord: boolean;
  /** Speak a short acknowledgement when an answer is slow to start. */
  backchannel: boolean;
  set: (patch: Partial<Omit<VoiceState, "set" | "nudge">>) => void;
  /** One step faster or slower, clamped. Bound to the spoken command. */
  nudge: (direction: "faster" | "slower") => void;
}

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set) => ({
      voiceUri: "",
      rate: DEFAULT_RATE,
      captions: true,
      // The one default-off preference here, and the only one that changes what
      // the microphone does rather than what the speaker does.
      wakeWord: false,
      backchannel: true,
      set: (patch) =>
        set((state) => ({
          ...state,
          ...patch,
          ...(patch.rate !== undefined ? { rate: clampRate(patch.rate) } : {}),
        })),
      nudge: (direction) =>
        set((state) => ({
          rate: clampRate(state.rate + (direction === "faster" ? 0.15 : -0.15)),
        })),
    }),
    { name: "atlas-voice" },
  ),
);
