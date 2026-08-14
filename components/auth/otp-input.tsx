"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import {
  OTP_LENGTH as LENGTH,
  applyBackspace,
  applyTyped,
  cursorFor,
  isComplete,
  parsePasted,
} from "@/lib/auth/otp";

/**
 * Six-digit code entry.
 *
 * One `<input>` per digit rather than a single field, because a code arrives in
 * chunks — read four digits off a phone, type them, glance back — and separate
 * boxes hold your place. The cost is that every keyboard affordance a single
 * field gives you for free has to be rebuilt: backspace crossing a boundary,
 * arrow keys, overtyping a filled box, and paste.
 *
 * Paste is the one that matters most. Most people copy the whole code from the
 * email, so a paste anywhere in the group fills all six and submits.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  id,
  describedBy,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  /** Renders the error state and, unless motion is reduced, shakes once. */
  invalid?: boolean;
  id?: string;
  describedBy?: string;
}) {
  const reduce = useReducedMotion();
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const digits = React.useMemo(
    () => Array.from({ length: LENGTH }, (_, i) => value[i] ?? ""),
    [value],
  );

  // The box the cursor sits in: the first empty one, or the last if it's full.
  const activeIndex = cursorFor(value);

  const focusBox = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(LENGTH - 1, i))];
    el?.focus();
    el?.select();
  };

  /** Push an edit from `lib/auth/otp` out to the caller and move focus. */
  const commit = ({ value: next, cursor }: { value: string; cursor: number }) => {
    onChange(next);
    focusBox(cursor);
    return next;
  };

  function handleChange(i: number, raw: string) {
    if (disabled) return;
    const next = commit(applyTyped(value, i, raw));
    if (isComplete(next)) onComplete?.(next);
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (e.key === "Backspace") {
      e.preventDefault();
      commit(applyBackspace(value, i));
      return;
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusBox(i + 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    if (disabled) return;
    const pasted = parsePasted(e.clipboardData.getData("text"));
    if (!pasted) return;
    e.preventDefault();

    const settle = () => {
      focusBox(pasted.length);
      if (isComplete(pasted)) onComplete?.(pasted);
    };

    if (reduce) {
      onChange(pasted);
      settle();
      return;
    }

    // Fill one box at a time. It is a 200ms flourish, but it also makes it
    // obvious that a paste landed rather than six digits appearing at once.
    let shown = 0;
    const tick = () => {
      shown++;
      onChange(pasted.slice(0, shown));
      if (shown < pasted.length) window.setTimeout(tick, 40);
      else settle();
    };
    tick();
  }

  return (
    <motion.div
      role="group"
      aria-label="Six-digit sign-in code"
      aria-describedby={describedBy}
      className="flex items-center justify-between gap-2"
      animate={invalid && !reduce ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      {digits.map((digit, i) => {
        const isActive = i === activeIndex;
        return (
          <div key={i} className="relative flex-1">
            <input
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={i === 0 ? id : undefined}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              // Only the first box claims the SMS/email autofill hint. Repeating
              // it makes iOS offer the whole code to every box in turn.
              autoComplete={i === 0 ? "one-time-code" : "off"}
              maxLength={1}
              disabled={disabled}
              aria-invalid={invalid || undefined}
              aria-label={`Digit ${i + 1} of ${LENGTH}`}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={handlePaste}
              onFocus={(e) => e.target.select()}
              className={cn(
                "h-14 w-full rounded-xl border bg-surface-2/60 text-center font-mono text-xl",
                "text-foreground shadow-sm outline-none transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                invalid
                  ? "border-danger/60 bg-danger/5"
                  : "border-border focus:border-action/50",
              )}
            />
            {isActive && !invalid && (
              // Shared layout: one underline that slides between boxes, the same
              // device the sidebar uses for its active-route marker.
              <motion.span
                layoutId="otp-cursor"
                transition={{ type: "spring", stiffness: 500, damping: 36 }}
                className="pointer-events-none absolute inset-x-2 bottom-1.5 h-[2px] rounded-full bg-action"
              />
            )}
          </div>
        );
      })}
    </motion.div>
  );
}
