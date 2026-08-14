import { GLOBALS } from "./artifact-bundle";
import { buildArtifactDoc, type VerifyTarget } from "./artifact-doc";
import type { Transform } from "./artifact-bundle";
import type { ArtifactRuntimeError } from "./artifact-bridge";

/**
 * Deciding what an artifact's errors mean, and who can fix them.
 *
 * The model can write an artifact but has never been able to find out whether it
 * runs. This module is the half of that answer which does not need a DOM: given
 * what a frame reported, which of it is a real failure, which is noise, and which
 * is Atlas's own fault.
 *
 * The last of those three is the one that matters most, and it is easy to leave
 * out. A two-way fatal/cosmetic split makes `Cannot resolve module 'framer-motion'`
 * fatal — which it is, to the user — and therefore worth a repair turn. But the
 * model wrote correct code; Atlas simply could not run it. Every artifact that
 * touched an unvendored library would spend money asking the model to fix a bug
 * in the host, forever, and it would never converge because there is nothing on
 * the model's side to change.
 */

/** How long to wait after `load` before concluding. */
export const VERIFY_SETTLE_MS = 1200;
/** Ceiling from insertion to resolution, for a document that never fires `load`. */
export const VERIFY_TIMEOUT_MS = 6000;
/** Errors quoted into a repair prompt. Beyond this they stop adding information. */
export const MAX_PROMPT_ERRORS = 5;

export type Severity = "fatal" | "host" | "warning";

export interface Classified extends ArtifactRuntimeError {
  severity: Severity;
}

export interface Triage {
  /** The model's fault, and worth spending a turn on. */
  fatal: Classified[];
  /** Atlas's fault. Never worth a turn — there is nothing for the model to fix. */
  host: Classified[];
  /** Shown, never repaired. */
  warnings: Classified[];
  /** Stable key over the fatal set. The repair memo is keyed on this. */
  signature: string;
  /** One-liners for `artifactErrors` and the panel's error strip. */
  messages: string[];
}

/** What a document run reported. Returned by the DOM harness. */
export interface DocRun {
  errors: ArtifactRuntimeError[];
  /** No `load` inside the timeout. The page is hung, not clean. */
  timedOut: boolean;
  aborted: boolean;
  /** No DOM available. Nothing was verified; do not treat as a pass. */
  skipped: boolean;
  elapsedMs: number;
}

export type DocRunner = (doc: string) => Promise<DocRun>;

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Failures caused by the host, not the artifact.
 *
 * `Cannot resolve module '<bare name>'` is the important one. The bundler only
 * emits it for a specifier that IS in `GLOBALS` — an unknown specifier is caught
 * at build time with a different message — so reaching it at runtime means the
 * vendored file did not load or the global name is wrong. Both are ours.
 */
export const HOST_PATTERNS: RegExp[] = [
  /cannot resolve module ['"]([^'"./][^'"]*)['"]/i,
  /could not load[^.]*\/artifact-runtime\//i,
  /\b(React|ReactDOM|Babel|Recharts|THREE|Papa|LucideReact|Motion|AtlasShims)\b is not defined/,
];

/** Crashes. The page is broken and the model wrote the reason. */
export const FATAL_PATTERNS: RegExp[] = [
  /\b(ReferenceError|TypeError|SyntaxError|RangeError)\b/,
  /\bis not defined\b/,
  /\bis not a function\b/,
  /\bis not iterable\b/,
  /Cannot read propert/i,
  /Cannot access ['"][^'"]+['"] before initialization/i,
  /Unexpected (token|identifier|end of input)/i,
  /Minified React error #\d+/,
  /Objects are not valid as a React child/,
  /Rendered (more|fewer) hooks/,
  /Maximum update depth exceeded/,
  /Too many re-renders/,
];

/**
 * `console.error` lines that really are a crash.
 *
 * Everything else logged through `console.error` defaults to a warning, and that
 * default is the crux of the whole triage. `console.error` is a library's
 * opinion, not a failure: React logs key warnings and `validateDOMNesting`
 * through it, Recharts complains about a zero-width container through it. Paying
 * a model turn for those would make almost every artifact cost twice.
 *
 * It also shrinks the prompt-injection surface. Artifact code is model-written
 * and its console output ends up in a prompt, so a page that logs "ignore your
 * previous instructions" is a thing that can happen. Only text matching one of
 * these ever reaches the model.
 */
export const FATAL_CONSOLE_PATTERNS: RegExp[] = [
  /^\s*Uncaught\b/,
  /The above error occurred in/,
  /Consider adding an error boundary/,
];

/** Noise that must never spend a turn, even though it matches something above. */
export const BENIGN_PATTERNS: RegExp[] = [
  /Download the React DevTools/,
  /Each child in a list should have a unique ["']key["']/,
  /validateDOMNesting/,
  /React does not recognize the/,
  /Support for defaultProps will be removed/,
  /findDOMNode is deprecated/,
  /\[Violation\]/,
  /width\(0\) and height\(0\) of chart should be greater than 0/,
  /Warning: ReactDOM\.render is no longer supported/,
];

/** A `<script>` or `<link>` failing is fatal; a decorative `<img>` is not. */
const FATAL_RESOURCE = /could not load <(script|link)>/i;

export function classifyArtifactError(e: ArtifactRuntimeError): Severity {
  const m = e.message;

  // Host first: `Cannot resolve module 'framer-motion'` also matches nothing
  // else, but `React is not defined` would otherwise be caught as fatal.
  for (const re of HOST_PATTERNS) if (re.test(m)) return "host";

  if (BENIGN_PATTERNS.some((re) => re.test(m))) return "warning";

  switch (e.kind) {
    case "bundle":
      return "fatal";
    case "blank":
      return "fatal";
    case "timeout":
      return "fatal";
    case "resource":
      return FATAL_RESOURCE.test(m) ? "fatal" : "warning";
    case "console":
      return FATAL_CONSOLE_PATTERNS.some((re) => re.test(m)) ? "fatal" : "warning";
    default:
      return FATAL_PATTERNS.some((re) => re.test(m)) ? "fatal" : "warning";
  }
}

/**
 * Whether a bundle error names a package Atlas never offered.
 *
 * That is the model's mistake and is fixable — it should pick something on the
 * list. A bundle error about a *relative* path is likewise the model's (it
 * referenced a file it did not write). So build failures are fatal by default,
 * and only the runtime "cannot resolve module" case is host.
 */
function bundleErrorSeverity(message: string): Severity {
  const m = /cannot resolve import ["']([^"']+)["']/i.exec(message);
  if (!m) return "fatal";
  const spec = m[1];
  const bare = !spec.startsWith(".") && !spec.startsWith("/");
  // A bare specifier that IS in the table should never have failed to build.
  return bare && spec in GLOBALS ? "host" : "fatal";
}

// ── Signature ───────────────────────────────────────────────────────────────

/**
 * A stable key for a set of fatal errors.
 *
 * Line numbers are stripped because they move: a model that "fixes" an error by
 * adding a line above it produces the same failure at a different position, and
 * a signature that treated those as different failures would let the repair loop
 * retry the same mistake until it ran out of attempts. React error numbers are
 * kept — they are the identity of the error, not incidental detail.
 */
export function errorSignature(errors: ArtifactRuntimeError[]): string {
  const parts = errors
    .map((e) =>
      e.message
        .toLowerCase()
        .replace(/\(line \d+\)/g, "")
        .replace(/:\d+:\d+/g, "")
        .replace(/\bline \d+\b/g, "")
        .replace(/0x[0-9a-f]+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .sort();
  return [...new Set(parts)].join(" | ").slice(0, 200);
}

// ── Triage ──────────────────────────────────────────────────────────────────

export interface TriageOptions {
  /** Build failures, which never reached a frame. */
  bundleErrors?: string[];
  /** The document never finished loading. */
  timedOut?: boolean;
}

export function triageArtifactErrors(
  errors: ArtifactRuntimeError[],
  opts: TriageOptions = {},
): Triage {
  const all: Classified[] = [];

  for (const raw of opts.bundleErrors ?? []) {
    all.push({ kind: "bundle", message: raw, severity: bundleErrorSeverity(raw) });
  }

  for (const e of errors) all.push({ ...e, severity: classifyArtifactError(e) });

  // A page that never fired `load` reported nothing, and "reported nothing" must
  // not read as "clean" — a module graph stuck in an infinite loop at import time
  // is the worst false pass available.
  if (opts.timedOut && all.length === 0) {
    all.push({
      kind: "timeout",
      message:
        "The artifact never finished loading. Something in the top level of the code did not return — check for an infinite loop or a synchronous wait before the first render.",
      severity: "fatal",
    });
  }

  const seen = new Set<string>();
  const unique = all.filter((e) => {
    const k = `${e.kind}:${e.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const fatal = unique.filter((e) => e.severity === "fatal");
  return {
    fatal,
    host: unique.filter((e) => e.severity === "host"),
    warnings: unique.filter((e) => e.severity === "warning"),
    signature: errorSignature(fatal),
    messages: unique.map((e) => (e.line ? `${e.message} (line ${e.line})` : e.message)),
  };
}

// ── Verification ────────────────────────────────────────────────────────────

export interface VerifyResult extends Triage {
  /** False when a document was built but never run (a build failure). */
  ran: boolean;
  elapsedMs: number;
}

export interface VerifyInput {
  target: VerifyTarget;
  origin: string;
  /** The error shim plus the storage stub. */
  head: string;
  transform?: Transform;
}

/**
 * Build the artifact, run it, and say what broke.
 *
 * `null` means there was nothing to verify — prose, a deck, a diagram, or an
 * artifact still streaming. The runner is injected so this stays node-testable;
 * the browser passes the offscreen-frame harness.
 */
export async function verifyArtifact(
  input: VerifyInput,
  run: DocRunner,
): Promise<VerifyResult | null> {
  const { target, origin, head, transform } = input;

  const built = buildArtifactDoc({
    files: target.files,
    entry: target.entry,
    artifact: target.artifact,
    origin,
    head,
    transform,
  });

  if (built.errors.length) {
    // It never ran, so there is nothing to wait for and no frame to create.
    return { ...triageArtifactErrors([], { bundleErrors: built.errors }), ran: false, elapsedMs: 0 };
  }
  if (!built.doc) return null;

  const outcome = await run(built.doc);
  // A skipped run verified nothing. Reporting it as clean would let the caller
  // conclude the artifact works on a machine that never rendered it.
  if (outcome.skipped || outcome.aborted) return null;

  return {
    ...triageArtifactErrors(outcome.errors, { timedOut: outcome.timedOut }),
    ran: true,
    elapsedMs: outcome.elapsedMs,
  };
}
