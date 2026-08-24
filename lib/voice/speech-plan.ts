/**
 * What to say, versus what to leave on screen.
 *
 * `useTTS` in `lib/hooks/use-speech.ts` stripped `[*_`#>]` and read the rest.
 * That reads a markdown table as a run of pipes and column names, reads a URL
 * character by character, and reads a forty-line code block aloud. None of
 * those are speech; they are the screen's job.
 *
 * The rule is that the spoken answer and the written one are the same answer
 * told two ways, not one of them degraded. Anything that only makes sense
 * visually is *announced* rather than skipped silently - the listener needs to
 * know it exists, or they will not look.
 *
 * Pure, so what gets spoken is testable without an audio device.
 */

export type SkippedKind = "code" | "table" | "link" | "image" | "math";

export interface SpeechPlan {
  /** The text to speak. */
  speak: string;
  /** What was left for the screen, so the UI can say so. */
  skipped: { kind: SkippedKind; count: number }[];
}

function bump(counts: Map<SkippedKind, number>, kind: SkippedKind): void {
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
}

/**
 * Turn one markdown answer into something worth hearing.
 *
 * Order matters: fenced code first (it can contain anything), then tables (they
 * span lines), then inline constructs.
 */
export function planSpeech(markdown: string): SpeechPlan {
  const counts = new Map<SkippedKind, number>();
  let text = markdown;

  // Fenced code. Announced with its language when it has one, because "the
  // Python is on screen" tells a listener more than "there is code".
  text = text.replace(/```([a-zA-Z0-9+#-]*)\n?[\s\S]*?```/g, (_m, lang: string) => {
    bump(counts, "code");
    const named = lang?.trim();
    return named ? ` The ${named} is on screen. ` : " The code is on screen. ";
  });
  // An unterminated fence, which is what streaming produces mid-block.
  text = text.replace(/```[a-zA-Z0-9+#-]*\n[\s\S]*$/g, () => {
    bump(counts, "code");
    return " Code is being written on screen. ";
  });

  // Markdown tables: two or more consecutive lines starting with a pipe.
  text = text.replace(/(?:^\|.*\|\s*$\n?){2,}/gm, () => {
    bump(counts, "table");
    return " There is a table on screen. ";
  });

  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => {
    bump(counts, "image");
    return alt ? ` An image: ${alt}. ` : " There is an image on screen. ";
  });

  // Links: keep the words, drop the address. Reading a URL aloud is unusable
  // and is most of what made read-aloud unpleasant.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, (_m, label: string) => {
    bump(counts, "link");
    return label;
  });
  text = text.replace(/https?:\/\/\S+/g, () => {
    bump(counts, "link");
    return "a link on screen";
  });

  // Display maths.
  text = text.replace(/\$\$[\s\S]*?\$\$/g, () => {
    bump(counts, "math");
    return " There is an equation on screen. ";
  });

  // Citation markers. They are for the eye; spoken, "one" mid-sentence is a
  // number the listener tries to attach to the previous noun.
  text = text.replace(/\[\d{1,3}\]/g, "");

  text = text
    // Headings become sentences, so the structure survives as intonation.
    .replace(/^#{1,6}\s+(.+)$/gm, "$1.")
    // Bullets become clauses rather than being read as punctuation.
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    // Inline code: keep the content, it is usually a name worth saying.
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, "")
    // Collapse the whitespace all of the above leaves behind.
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    speak: text,
    skipped: [...counts.entries()].map(([kind, count]) => ({ kind, count })),
  };
}

/**
 * The system-prompt block for a spoken turn.
 *
 * Voice is a different mode, not a wrapper around the text one. An answer built
 * for the eye - a table, a numbered list of nine options, a code block -
 * becomes unusable when it is read out, and no amount of post-processing fixes
 * an answer that was shaped wrong to begin with.
 */
export const VOICE_PROMPT = [
  "This turn will be spoken aloud, so shape the answer for listening.",
  "Lead with the answer, then the reason. A listener cannot skim back to find it.",
  "Keep it short - a few sentences unless more was explicitly asked for.",
  "No tables, no bullet lists, no headings, no markdown formatting in the prose.",
  "Say numbers the way a person would: '$1.25 per million tokens', not '$1.25/M'.",
  "If code, a table or a long comparison is genuinely the right answer, write it out normally -",
  "it will be shown on screen and announced rather than read aloud - and say in one sentence what it contains.",
  "Do not read citation markers or URLs aloud; refer to sources by name.",
].join(" ");

/** Whether an answer is shaped for the eye rather than the ear. */
export function isVisualAnswer(markdown: string): boolean {
  const plan = planSpeech(markdown);
  return plan.skipped.some((s) => s.kind === "code" || s.kind === "table");
}
