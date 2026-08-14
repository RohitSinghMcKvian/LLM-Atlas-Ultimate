"use client";

import { create } from "zustand";
import { isIncognito, setIncognito } from "@/lib/chat/incognito";
import { useChatStore } from "./chat-store";

/**
 * React-facing view of the incognito gate.
 *
 * The flag itself lives in `lib/chat/incognito.ts` so the storage layer can read
 * it without importing React. This store exists only to make it renderable, and
 * mirrors rather than owns the value — `setIncognito` is the single writer.
 *
 * Not wrapped in `persist`, matching the module it fronts: incognito lasts one
 * session by design.
 */
interface IncognitoState {
  active: boolean;
  toggle: () => void;
  set: (v: boolean) => void;
}

export const useIncognitoStore = create<IncognitoState>()((set) => ({
  active: isIncognito(),
  set: (v) => {
    if (isIncognito() === v) return;
    setIncognito(v);
    set({ active: v });
    // Crossing the boundary starts a fresh thread in either direction. Going in,
    // appending to a saved conversation would leave half of it on disk and half
    // in memory; coming out, the temporary turns would suddenly start persisting
    // mid-thread. A new chat makes the boundary match what the user sees.
    // Temporary conversations were never written anywhere, so leaving the mode
    // has to drop them from the in-memory list too — otherwise a chat the UI
    // promised would disappear lingers in the rail and opens empty.
    useChatStore.getState().dropTemporary();
    useChatStore.getState().newChat();
  },
  toggle: () => {
    const next = !isIncognito();
    setIncognito(next);
    set({ active: next });
    // Temporary conversations were never written anywhere, so leaving the mode
    // has to drop them from the in-memory list too — otherwise a chat the UI
    // promised would disappear lingers in the rail and opens empty.
    useChatStore.getState().dropTemporary();
    useChatStore.getState().newChat();
  },
}));
