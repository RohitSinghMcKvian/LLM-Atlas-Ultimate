/**
 * Editing rules for the six-digit code input.
 *
 * Pure and framework-free, living in `lib/` for the same reason
 * `lib/canvas/field.ts` does: the component is a thin shell of inputs and
 * refs, but the rules about where the cursor lands after a backspace at a
 * boundary are exactly the kind of thing that breaks quietly. This runs under
 * the node vitest config; the shell is exercised through the app.
 *
 * The one invariant everything else rests on: **the code is always compact.**
 * No holes, so `value.length` doubles as the cursor position. Every operation
 * below is a slice — writing `""` into a fixed-length array and re-joining
 * would silently pull later digits one slot to the left.
 */

export const OTP_LENGTH = 6;

export interface OtpEdit {
  value: string;
  /** Where focus belongs afterwards. Callers clamp to a real box. */
  cursor: number;
}

/** Digits only, capped at `length`. The single place a value is shaped. */
export function sanitizeCode(raw: string, length = OTP_LENGTH): string {
  return raw.replace(/\D/g, "").slice(0, length);
}

/** The box the cursor belongs in: the first empty one, or the last if full. */
export function cursorFor(value: string, length = OTP_LENGTH): number {
  return Math.min(value.length, length - 1);
}

export function isComplete(value: string, length = OTP_LENGTH): boolean {
  return value.length === length;
}

/**
 * Type `typed` into the box at `index`.
 *
 * Clicking a box past the end of a partial code and typing appends rather than
 * leaving a gap the compact value cannot represent — so tapping box 5 with two
 * digits entered writes the third, not the fifth.
 */
export function applyTyped(
  value: string,
  index: number,
  typed: string,
  length = OTP_LENGTH,
): OtpEdit {
  const digits = typed.replace(/\D/g, "");
  if (!digits) return { value, cursor: cursorFor(value, length) };

  const at = Math.max(0, Math.min(index, value.length));
  const next = sanitizeCode(
    value.slice(0, at) + digits + value.slice(at + digits.length),
    length,
  );
  return { value: next, cursor: Math.min(at + digits.length, length) };
}

/**
 * Backspace at `index`.
 *
 * On a filled box, the same thing a single text field would do: remove that
 * digit and close the gap. Sitting past the end — which is where the cursor
 * usually is — it drops the last digit and follows it back, so holding
 * backspace clears the code one box at a time rather than stalling.
 */
export function applyBackspace(
  value: string,
  index: number,
  length = OTP_LENGTH,
): OtpEdit {
  if (index < value.length) {
    return { value: value.slice(0, index) + value.slice(index + 1), cursor: index };
  }
  if (value.length === 0) return { value, cursor: 0 };
  return { value: value.slice(0, -1), cursor: value.length - 1 };
}

/** A pasted code, trimmed to digits. Empty when the clipboard held nothing usable. */
export function parsePasted(raw: string, length = OTP_LENGTH): string {
  return sanitizeCode(raw, length);
}
