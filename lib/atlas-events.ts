"use client";

import * as React from "react";

/**
 * Lightweight app-wide event bus for shared keyboard actions and a11y
 * announcements (§3.6). Modules opt in to global shortcuts by listening for the
 * relevant `atlas:*` event, so the keyboard layer stays decoupled from surfaces.
 */
export type AtlasEvent = "new" | "stop" | "announce";

export interface AtlasEventDetail {
  message?: string;
}

export function emitAtlas(name: AtlasEvent, detail: AtlasEventDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(`atlas:${name}`, { detail }));
}

/** Announce a message to assistive tech via the global ARIA live region. */
export function announce(message: string) {
  emitAtlas("announce", { message });
}

/** Subscribe to an `atlas:*` event for the lifetime of the component. */
export function useAtlasEvent(
  name: AtlasEvent,
  handler: (detail: AtlasEventDetail) => void,
) {
  const ref = React.useRef(handler);
  ref.current = handler;
  React.useEffect(() => {
    const fn = (e: Event) => ref.current((e as CustomEvent).detail ?? {});
    window.addEventListener(`atlas:${name}`, fn);
    return () => window.removeEventListener(`atlas:${name}`, fn);
  }, [name]);
}
