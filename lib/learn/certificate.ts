/**
 * Atlas Learn — credential minting and the academic transcript.
 *
 * The credential id is *derived*, not random: the same learner, the same
 * completed work, and the same grades always produce the same id. That makes a
 * shared certificate re-checkable offline — recompute the id from the printed
 * transcript and compare — without Atlas running a verification service.
 *
 * To be explicit about what this is: a self-issued course credential. It is not
 * accredited, and the UI says so on the certificate itself.
 */

import { gpa as computeGpa, letterFor } from "./grading";
import {
  courseCoverage,
  trackCoverage,
  trackMastery,
  type ProgressState,
} from "./progress";
import type { Track } from "./types";

export interface TranscriptRow {
  trackId: string;
  title: string;
  level: string;
  lessons: string;
  mastery: number;
  /** Letter for the track's practicals; "—" when the track has none. */
  grade: string;
}

export interface Transcript {
  rows: TranscriptRow[];
  gpa: number;
  overallLetter: string;
  lessonsCompleted: number;
  lessonsTotal: number;
  practicalsGraded: number;
  totalMinutes: number;
  xp: number;
}

export function buildTranscript(
  tracks: Track[],
  state: ProgressState,
): Transcript {
  const rows: TranscriptRow[] = tracks.map((track) => {
    const coverage = trackCoverage(track, state);
    const records = track.lessons
      .flatMap((l) => l.blocks)
      .filter((b) => b.type === "exercise")
      .map((b) => state.exercises[(b as { id: string }).id])
      .filter(Boolean);

    const avg = records.length
      ? records.reduce((n, r) => n + r.percent, 0) / records.length
      : null;

    return {
      trackId: track.id,
      title: track.title,
      level: track.level,
      lessons: `${coverage.done}/${coverage.total}`,
      mastery: trackMastery(track, state),
      grade: avg === null ? "—" : letterFor(avg),
    };
  });

  const graded = Object.values(state.exercises);
  const coverage = courseCoverage(tracks, state);
  const overallPercent = graded.length
    ? graded.reduce((n, r) => n + r.percent, 0) / graded.length
    : 0;

  // Minutes are counted for lessons actually finished, so the transcript
  // reports time invested rather than the course's nominal length.
  const totalMinutes = tracks
    .flatMap((t) => t.lessons)
    .filter((l) => state.completedLessons[l.id])
    .reduce((n, l) => n + l.minutes, 0);

  return {
    rows,
    gpa: computeGpa(graded),
    overallLetter: graded.length ? letterFor(overallPercent) : "—",
    lessonsCompleted: coverage.done,
    lessonsTotal: coverage.total,
    practicalsGraded: graded.length,
    totalMinutes,
    xp: state.xp,
  };
}

// ---------------------------------------------------------------------------
// Credential id
// ---------------------------------------------------------------------------

/**
 * FNV-1a, 32-bit. Chosen over anything cryptographic on purpose: the id is a
 * *reproducibility* check, not a security boundary, and it has to be computable
 * in a synchronous render on both server and client. `crypto.subtle` is async
 * and Node-vs-browser divergent; this is neither.
 */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // `Math.imul` keeps the multiply in 32-bit space; `h * prime` would lose
    // precision past 2^53 and stop matching other FNV-1a implementations.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface CredentialInput {
  learner: string;
  tracks: Track[];
  state: ProgressState;
}

export interface Credential {
  /** e.g. `ATLAS-LLM-7K3F9A-2Q` — printed on the certificate. */
  id: string;
  /** The exact string the id hashes, so verification is reproducible. */
  payload: string;
  issuedOn: string;
}

/**
 * Mints the credential id.
 *
 * The payload is canonicalized — lessons sorted, grades rounded to whole
 * percent — so two devices that recorded the same work in a different order
 * still mint the same id. Rounding matters: a 91.4 and a 91.44 are the same
 * grade to a reader and must be the same credential.
 */
export function mintCredential({
  learner,
  tracks,
  state,
}: CredentialInput): Credential {
  const lessons = Object.keys(state.completedLessons).sort().join(",");
  const grades = Object.entries(state.exercises)
    .map(([id, r]) => `${id}:${Math.round(r.percent)}`)
    .sort()
    .join(",");
  const transcript = buildTranscript(tracks, state);

  const payload = [
    "atlas-learn-v1",
    learner.trim().toLowerCase(),
    lessons,
    grades,
    transcript.gpa.toFixed(2),
  ].join("|");

  const primary = hash32(payload).toString(36).toUpperCase().padStart(6, "0");
  // A second hash over the first acts as a transcription checksum — a mistyped
  // character in the visible id almost always breaks the suffix.
  const check = (hash32(primary) % 1296).toString(36).toUpperCase().padStart(2, "0");

  return {
    id: `ATLAS-LLM-${primary.slice(0, 6)}-${check}`,
    payload,
    issuedOn: (state.lastActiveDay || "").slice(0, 10),
  };
}

/** Re-derives the id from a payload and compares. Used by the verify panel. */
export function verifyCredential(id: string, payload: string): boolean {
  const primary = hash32(payload).toString(36).toUpperCase().padStart(6, "0");
  const check = (hash32(primary) % 1296).toString(36).toUpperCase().padStart(2, "0");
  return id.trim().toUpperCase() === `ATLAS-LLM-${primary.slice(0, 6)}-${check}`;
}
