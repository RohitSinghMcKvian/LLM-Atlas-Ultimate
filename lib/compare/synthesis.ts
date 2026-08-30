// Merging the answers into one.
//
// The contract this replaces was markdown headings the client re-parsed with
// `new RegExp('##\\s*' + name)`. A model that wrote `## Synthesis:` — with a
// colon — silently produced an empty synthesis and a raw-text fallback, and
// nothing anywhere reported that it had happened. Structured output makes the
// shape a schema rather than a hope.
//
// Two substantive changes beyond the format:
//
//   * The synthesizer reads the *analysis* alongside the answers — which lanes
//     converged, which one dissented, what nobody cited. Merging blind treats a
//     lone dissenting answer and a unanimous one identically, which is exactly
//     backwards.
//   * It is asked for caveats. A merge that cannot say where it was unsure is
//     asserting more confidence than the answers it was built from.

import type { EvidencePack, LaneState, Synthesis } from "./types";
import { anonLabel } from "./judge";

export const SYNTHESIS_SYSTEM =
  "You merge several answers to one question into a single best answer. You did not write any of " +
  "them and you are not choosing a winner. Keep what they agree on, state disagreements as " +
  "disagreements rather than picking a side silently, and never assert anything none of them said. " +
  "If sources are cited, carry the citation numbers through unchanged. Keep the merged answer under 250 words — you must leave output budget for the agreement, disagreement and caveat lists, which are the part a reader cannot get from the answers themselves.";

/**
 * Field order is load-bearing.
 *
 * The lists are bounded — six, six and four short lines — while `answer` is
 * prose of whatever length the model feels like. Measured live against an 8B
 * synthesizer: with `answer` first it consumed the entire output budget every
 * time and the lists never arrived, and telling the model to keep the answer
 * under 250 words did not change that. Emitting the lists first means a merge
 * that runs out of room loses the tail of its prose instead of losing the only
 * part a reader cannot get by reading the answers themselves.
 */
export const SYNTHESIS_SCHEMA = {
  name: "compare_synthesis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["agreements", "divergences", "caveats", "answer"],
    properties: {
      agreements: {
        type: "array",
        maxItems: 6,
        items: { type: "string" },
        description: "Points the answers agreed on. One line each.",
      },
      divergences: {
        type: "array",
        maxItems: 6,
        items: { type: "string" },
        description:
          "Points they disagreed on. Say what each side held, not which is right. One line each.",
      },
      caveats: {
        type: "array",
        maxItems: 4,
        items: { type: "string" },
        description: "Where this merge is least reliable. Empty if none.",
      },
      answer: {
        type: "string",
        description:
          "The merged answer, in markdown, at most 250 words. Carry citation markers like [1] " +
          "through unchanged.",
      },
    },
  },
} as const;

export interface SynthesisPromptInput {
  task: string;
  lanes: Pick<LaneState, "id" | "text">[];
  evidence?: EvidencePack;
  /** Lane ids that broadly agreed, from the similarity pass. */
  clusters?: string[][];
  /** The lane that took a different line, if any. */
  outlier?: string;
}

export interface SynthesisPrompt {
  prompt: string;
  mapping: Record<string, string>;
}

/**
 * Build the merge prompt.
 *
 * Answers stay anonymous here too. The synthesizer's job is to merge content,
 * and knowing which model wrote what invites it to defer to a brand rather than
 * to an argument.
 */
export function buildSynthesisPrompt(input: SynthesisPromptInput): SynthesisPrompt {
  const answering = input.lanes.filter((l) => l.text.trim().length > 0);
  const mapping: Record<string, string> = {};
  const labelOf = new Map<string, string>();

  const blocks = answering.map((lane, i) => {
    const label = anonLabel(i);
    mapping[label] = lane.id;
    labelOf.set(lane.id, label);
    return `### ${label}\n${lane.text.trim()}`;
  });

  const notes: string[] = [];
  if (input.clusters && input.clusters.length > 1) {
    const groups = input.clusters
      .map((group) => group.map((id) => labelOf.get(id)).filter(Boolean).join(", "))
      .filter(Boolean);
    if (groups.length > 1) {
      notes.push(
        `These answers cover the same ground as each other: ${groups.map((g) => `(${g})`).join(" and ")}. ` +
          "Do not let the larger group win by weight of numbers alone.",
      );
    }
  }
  if (input.outlier && labelOf.has(input.outlier)) {
    notes.push(
      `${labelOf.get(input.outlier)} took a different line from the rest. Say what it saw that the ` +
        "others did not, rather than dropping it as an outlier.",
    );
  }

  const sources =
    input.evidence && input.evidence.sources.length > 0
      ? `\n\nSources, numbered. Reuse these numbers exactly:\n${input.evidence.sources
          .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)
          .join("\n")}`
      : "";

  return {
    mapping,
    prompt:
      `Question:\n"""${input.task}"""${sources}\n\n` +
      (notes.length ? `${notes.join("\n")}\n\n` : "") +
      `Answers to merge:\n\n${blocks.join("\n\n")}`,
  };
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Read the merge back.
 *
 * Falls back to treating the whole reply as the answer when it is not JSON —
 * a model that ignored the schema still wrote something useful, and showing it
 * beats showing nothing. `structured: false` on the result is how the UI knows
 * the agreements and divergences are genuinely absent rather than empty.
 */
export function parseSynthesis(raw: string, modelId?: string): Synthesis & { structured: boolean } {
  const text = raw.trim();
  if (!text) {
    return { answer: "", agreements: [], divergences: [], caveats: [], modelId, structured: false };
  }

  try {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    const parsed = JSON.parse((fenced ? fenced[1] : text).trim()) as Record<string, unknown>;
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    if (!answer) throw new Error("no answer field");
    return {
      answer,
      agreements: stringList(parsed.agreements, 6),
      divergences: stringList(parsed.divergences, 6),
      caveats: stringList(parsed.caveats, 4),
      modelId,
      structured: true,
    };
  } catch {
    // A merge cut off at its token ceiling is well-formed JSON right up to the
    // cut. Closing the open string and brackets recovers every field that
    // finished — which, with the lists emitted first, is the part worth having.
    const repaired = repairTruncatedJson(text);
    if (repaired) {
      const answer = typeof repaired.answer === "string" ? repaired.answer.trim() : "";
      return {
        answer,
        agreements: stringList(repaired.agreements, 6),
        divergences: stringList(repaired.divergences, 6),
        caveats: stringList(repaired.caveats, 4),
        modelId,
        truncated: true,
        structured: false,
      };
    }

    const salvaged = salvageAnswer(text);
    if (salvaged) {
      return {
        answer: salvaged,
        agreements: [],
        divergences: [],
        caveats: [],
        modelId,
        truncated: true,
        structured: false,
      };
    }
    return {
      answer: text,
      agreements: [],
      divergences: [],
      caveats: [],
      modelId,
      structured: false,
    };
  }
}

/**
 * Close a JSON object that stopped mid-write, then parse it.
 *
 * Walks the text tracking whether it is inside a string and what brackets are
 * open, discards a dangling key or a half-written escape, and appends the
 * closers. Returns `null` when the result still will not parse, so a caller
 * never receives a half-invented object.
 *
 * Only useful because output is truncated at the *end*: everything before the
 * cut is exactly what the model meant to say.
 */
export function repairTruncatedJson(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*)$/.exec(text);
  const body = (fenced ? fenced[1] : text).trim().replace(/```\s*$/, "");
  if (!body.startsWith("{")) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafe = 0;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      // A completed string is a safe point to cut back to if the tail is junk.
      if (!inString) lastSafe = i + 1;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
    if (ch === "," || ch === "}" || ch === "]") lastSafe = i + 1;
  }

  // A cut that lands mid-escape leaves a dangling backslash, which would escape
  // the closing quote appended below and leave the string open again.
  const trunk = escaped ? body.slice(0, -1) : body;

  const attempts: string[] = [];
  const closers = [...stack].reverse().join("");
  // A string left open is closed where it stopped; the value is truncated prose
  // rather than corrupt.
  if (inString) attempts.push(trunk + '"' + closers);
  attempts.push(trunk + closers);

  // Last resort: rewind to the last completed value and close from there. This
  // is what saves a reply cut inside a key rather than inside a value.
  const rewound = body.slice(0, lastSafe).replace(/,\s*$/, "");
  if (rewound.startsWith("{")) {
    const rewoundStack: string[] = [];
    let s2 = false;
    let e2 = false;
    for (const ch of rewound) {
      if (e2) {
        e2 = false;
        continue;
      }
      if (ch === "\\") {
        if (s2) e2 = true;
        continue;
      }
      if (ch === '"') {
        s2 = !s2;
        continue;
      }
      if (s2) continue;
      if (ch === "{" || ch === "[") rewoundStack.push(ch === "{" ? "}" : "]");
      else if (ch === "}" || ch === "]") rewoundStack.pop();
    }
    attempts.push(rewound + [...rewoundStack].reverse().join(""));
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next repair.
    }
  }
  return null;
}

/**
 * Pull the `answer` field out of JSON that never finished.
 *
 * Only fires when the text actually looks like the object the schema asked for,
 * so a model that wrote prose beginning with a brace is not mangled. Returns
 * `null` when there is nothing recognisable to recover, and the caller shows the
 * raw reply instead.
 */
export function salvageAnswer(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("```")) return null;

  const opener = /"answer"\s*:\s*"/.exec(trimmed);
  if (!opener) return null;

  let out = "";
  for (let i = opener.index + opener[0].length; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\") {
      const next = trimmed[i + 1];
      // Standard JSON escapes, so a truncated answer still reads as prose.
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "";
      else if (next !== undefined) out += next;
      i++;
      continue;
    }
    // An unescaped quote ends the string — the field was complete after all.
    if (ch === '"') break;
    out += ch;
  }

  const answer = out.trim();
  return answer.length > 0 ? answer : null;
}

/** One line for the run spine. */
export function describeSynthesis(synthesis: Synthesis, name?: string): string {
  const parts: string[] = [];
  if (synthesis.agreements.length) parts.push(`${synthesis.agreements.length} agreements`);
  if (synthesis.divergences.length) parts.push(`${synthesis.divergences.length} disagreements`);
  if (parts.length === 0) return name ? `Merged by ${name}` : "Merged";
  return parts.join(" · ") + (name ? ` · merged by ${name}` : "");
}
