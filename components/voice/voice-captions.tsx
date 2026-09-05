"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * What is being said, as it is said.
 *
 * `SpeechSynthesisUtterance.onboundary` reports the character offset of each
 * word as the engine reaches it, so the caption can track the voice exactly
 * rather than approximating it with a timer that drifts against every rate
 * change and every engine.
 *
 * Worth having for more than polish: it is the only way to follow an answer in
 * a room too loud to hear it, the only way to catch a model name that was
 * mispronounced, and the thing that makes a long answer feel like it is
 * progressing rather than droning.
 */
export function VoiceCaption({
  text,
  charIndex,
  className,
}: {
  text: string;
  /** Character offset the synthesiser has reached. */
  charIndex: number;
  className?: string;
}) {
  // Split on the word containing the boundary rather than at the raw index, so
  // a word is never half-highlighted mid-render.
  const cut = React.useMemo(() => {
    if (charIndex <= 0) return 0;
    const at = text.indexOf(" ", charIndex);
    return at === -1 ? text.length : at;
  }, [text, charIndex]);

  return (
    <p className={cn("text-balance text-center text-lg leading-relaxed", className)}>
      <span className="text-foreground">{text.slice(0, cut)}</span>
      <span className="text-muted-foreground">{text.slice(cut)}</span>
    </p>
  );
}

/**
 * What was heard, before it is committed.
 *
 * Kept from the previous surface because the reason for it has not changed: a
 * mis-heard model name is the single most common way a spoken question goes
 * wrong, and seeing it lets someone say it again rather than wait for an answer
 * to a question they did not ask.
 */
export function HeardLine({ text }: { text: string }) {
  const heard = text.trim();
  return (
    <p
      className={cn(
        "min-h-6 max-w-xl text-center text-sm transition-opacity",
        heard ? "text-muted-foreground opacity-100" : "opacity-0",
      )}
    >
      {heard || " "}
    </p>
  );
}
