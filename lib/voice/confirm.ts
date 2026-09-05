/**
 * Asking before doing something that writes, out loud.
 *
 * P20 gave the voice surface no `onApproval` at all and refused every write,
 * on the grounds that "a spoken turn has no approval prompt anyone can read".
 * That reasoning is sound about *reading* and wrong about approving: the answer
 * is to make the approval audible rather than to remove the capability. Atlas
 * says what it is about to do, and waits.
 *
 * Three rules, all of them load-bearing:
 *
 *  1. **Silence is never consent.** A confirmation that times out is a refusal,
 *     never an approval. Someone who walked away must not come back to a
 *     changed workspace.
 *  2. **Ambiguity is never consent either.** Anything that is not clearly
 *     affirmative is `unclear`, which re-asks once and then gives up.
 *  3. **The spoken question and the on-screen card say the same sentence**, so
 *     a person who heard one and read the other cannot be approving two
 *     different things.
 *
 * Pure, so the grammar is testable without a microphone.
 */

export type ConfirmVerdict = "yes" | "no" | "unclear";

/**
 * Affirmatives.
 *
 * Kept tight on purpose. "Sure", "okay" and "go ahead" are unambiguous; "well
 * alright then" is not worth the risk of matching on a stray "alright".
 */
const YES = [
  "yes",
  "yeah",
  "yep",
  "yup",
  "sure",
  "ok",
  "okay",
  "go ahead",
  "do it",
  "please do",
  "confirm",
  "confirmed",
  "affirmative",
  "sounds good",
  "yes please",
  "go for it",
];

const NO = [
  "no",
  "nope",
  "nah",
  "cancel",
  "stop",
  "don't",
  "dont",
  "do not",
  "never mind",
  "nevermind",
  "forget it",
  "no thanks",
  "no thank you",
  "leave it",
  "abort",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What a reply to a confirmation meant.
 *
 * Only called while something is pending, which is what lets "stop" mean *no*
 * here and *stop talking* everywhere else — see `parseIntent`, which never sees
 * this utterance.
 */
export function parseConfirm(raw: string): ConfirmVerdict {
  const t = normalize(raw);
  if (!t) return "unclear";

  // Exact first: a bare "no" must not match "no thanks I meant yes".
  if (YES.includes(t)) return "yes";
  if (NO.includes(t)) return "no";

  // Leading form: "yes, open it" / "no, don't".
  const first = t.split(" ")[0];
  const twoWords = t.split(" ").slice(0, 2).join(" ");
  if (NO.includes(first) || NO.includes(twoWords)) return "no";
  if (YES.includes(first) || YES.includes(twoWords)) return "yes";

  return "unclear";
}

/** How long to wait for an answer before treating it as a refusal. */
export const CONFIRM_TIMEOUT_MS = 15_000;

/** How many times to re-ask after an unclear reply. */
export const CONFIRM_RETRIES = 1;

export interface PendingConfirm {
  /** Tool or command name, for the record. */
  name: string;
  /** The one sentence said aloud and shown on the card. */
  question: string;
  /** How many times it has been asked. */
  asked: number;
}

/**
 * Phrase the question.
 *
 * Ends in a question mark and names the action in the same words the chip uses,
 * because the listener has to hold it in their head with no way to scroll back.
 */
export function confirmQuestion(description: string): string {
  const clean = description.trim().replace(/[.?!]+$/, "");
  if (!clean) return "Should I go ahead?";
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}. Should I go ahead?`;
}

/** What to say when a reply did not land. */
export const CONFIRM_RETRY_PROMPT = "Sorry — was that a yes?";

/** What to say when nothing usable came back and the action is dropped. */
export const CONFIRM_ABANDONED = "I will leave it for now.";
