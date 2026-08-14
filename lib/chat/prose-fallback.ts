/**
 * Building with a model that cannot deliver a large tool call.
 *
 * Build mode writes files by calling `workspace` with `create` and the whole
 * file as the `content` argument. That is the right shape when it works, and it
 * is the only shape Atlas had — which turned out to be an assumption about the
 * provider rather than about the model.
 *
 * Measured against `nvidia/nemotron-3-ultra-550b-a55b`, repeatedly:
 *
 *  - **Without tools**, asked in plain prose for the same NASA landing page, it
 *    streamed 48,992 characters of well-formed HTML — NASA palette, Orbitron,
 *    a hand-built SVG of the SLS stack — in one answer.
 *  - **With tools**, asked to write that same file through `workspace create`,
 *    it emitted its reasoning ("Now I'll create the complete NASA landing page
 *    as a single HTML file."), then nothing. Three separate runs through Atlas,
 *    and two direct probes against the provider at 311 s each, one of them with
 *    `tool_choice` pinned to the function: **zero tool calls, reasoning only.**
 *
 * So the model can write the page and cannot hand it over as a JSON string
 * argument. Every capability Atlas has for long builds — the workspace, the
 * plan, the preview, the artifact history — sat behind a channel this model
 * could not use, and a build that a plain chat turn would have finished produced
 * nothing at all.
 *
 * The fallback is to ask again, with no tools, for the files as fenced blocks —
 * which `extractArtifacts` already reads, including the `path="…"` attribute
 * that names the file. The model gets to answer the way it can answer, and the
 * build still ends with real files in the workspace.
 *
 * Pure: what to ask for, and what to do with the answer. The asking and the
 * writing belong to the caller.
 */

import { extractArtifacts, kindAndLangForPath } from "./artifact-extract";

/** A file recovered from a fenced block, ready for `FsStore.write`. */
export interface ProseFile {
  path: string;
  text: string;
}

/** Where a single untagged page goes when the model names no path. */
export const DEFAULT_PROSE_PATH = "index.html";

/**
 * Ceiling on what one fallback answer may write.
 *
 * The same reasoning as every other cap here: the fallback exists to rescue a
 * turn, not to become an unbounded second channel into the user's workspace.
 */
export const MAX_PROSE_FILES = 6;

/**
 * What we ask for.
 *
 * Three things it must say, each because of a way the retry can fail:
 *
 *  - **Name the file on the fence.** Without `path=`, a multi-file answer is one
 *    artifact and the rest is lost.
 *  - **No tools.** Saying so matters even though none are offered: a model that
 *    has just spent a round trying to call one will otherwise describe the call
 *    it wanted to make instead of writing the file.
 *  - **The whole file.** A diff or an excerpt cannot be written to disk, and a
 *    model that has already reasoned about the page will happily summarise it.
 */
export const PROSE_FALLBACK_INSTRUCTION =
  "The tool call did not get through, so write the files directly in your reply instead. " +
  'Put each complete file in its own fenced code block tagged with its path, like ```html path="index.html". ' +
  "Write the entire contents of every file — no diffs, no excerpts, no placeholders, and no " +
  "commentary about tools. There are no tools available on this turn.";

/**
 * Errors there is no point retrying, in any channel.
 *
 * A missing key or an empty balance will refuse the second request exactly as it
 * refused the first, and charging the user for the attempt to find that out is
 * the opposite of helpful.
 */
export const UNRETRYABLE = new Set(["key_required", "no_credit", "provider_key_invalid"]);

/**
 * Whether a finished build round is worth retrying as prose.
 *
 * Deliberately narrow. This spends another turn's worth of tokens, so it fires
 * only when the round genuinely produced nothing usable:
 *
 *  - the provider stalled, errored, or the answer came back empty; **and**
 *  - the error is not one a second request would hit identically; **and**
 *  - nothing was written to the workspace, so there is no partial build to
 *    confuse with a fresh one.
 *
 * A round that wrote a file and then stalled is a *continuation* problem, not
 * this one, and retrying it would duplicate work the user already paid for.
 *
 * **Files, not tool calls.** The first version of this guard also refused when
 * the turn had made any tool call at all, on the reasoning that a successful
 * call means work in progress. That is wrong in exactly the case this exists
 * for: every build opens by calling `tasks` to write its plan, so the guard was
 * true on the first round of every real build and the fallback never fired once.
 * Watching it not fire, live, is the only reason it is written this way.
 *
 * `errorCode` is in the list because of what the provider actually said. Once
 * mid-stream error frames stopped being swallowed, the failure that had been
 * showing as a blank bubble turned out to be NVIDIA's own gateway reporting
 * `Upstream idle timeout exceeded` — its backend giving up while the 550B
 * composed a large tool-call argument. No amount of patience on this side fixes
 * that, which is precisely why there has to be another channel.
 */
export function shouldFallBackToProse(outcome: {
  stalled?: boolean;
  errored?: boolean;
  errorCode?: string;
  content?: string;
  filesWritten?: number;
}): boolean {
  if (outcome.filesWritten) return false;
  if (outcome.errorCode && UNRETRYABLE.has(outcome.errorCode)) return false;
  const empty = !outcome.content?.trim();
  return Boolean(outcome.stalled || outcome.errored || empty);
}

/**
 * The files in a prose answer.
 *
 * Blocks the model named with `path=` are taken at their word — that is what the
 * attribute is for, and `validFencePath` has already rejected anything that
 * escapes the workspace. A single unnamed block is accepted too, under
 * {@link DEFAULT_PROSE_PATH}, because "write me a landing page" answered with
 * one HTML block is the common case and refusing it on a technicality would
 * throw away the whole point.
 *
 * Later blocks win over earlier ones at the same path: a model that corrects
 * itself mid-answer means the correction.
 */
export function filesFromProse(content: string): ProseFile[] {
  const blocks = extractArtifacts(content);
  if (!blocks.length) return [];

  const named = blocks.filter((b) => b.path);
  const chosen = named.length
    ? named
    : blocks.length === 1
      ? [{ ...blocks[0], path: defaultPathFor(blocks[0].lang) }]
      : [];

  const byPath = new Map<string, ProseFile>();
  for (const b of chosen) {
    if (!b.path || !b.code.trim()) continue;
    byPath.set(b.path, { path: b.path, text: b.code });
  }
  return [...byPath.values()].slice(0, MAX_PROSE_FILES);
}

/**
 * A filename for an unnamed block, from its fence language.
 *
 * `kindAndLangForPath` maps the other way and is the pin that keeps the two
 * consistent — a block written as `html` must land somewhere that reads back as
 * html, or the preview would refuse the file the model just wrote.
 */
function defaultPathFor(lang: string): string {
  switch (lang) {
    case "html":
      return DEFAULT_PROSE_PATH;
    case "svg":
      return "image.svg";
    case "css":
      return "styles.css";
    case "js":
    case "javascript":
      return "app.js";
    case "jsx":
      return "App.jsx";
    case "tsx":
      return "App.tsx";
    case "markdown":
    case "md":
      return "README.md";
    default:
      return kindAndLangForPath(`f.${lang}`).kind === "code" && lang
        ? `file.${lang}`
        : DEFAULT_PROSE_PATH;
  }
}

/**
 * What to tell the user, once the files are in.
 *
 * Said plainly rather than hidden, because the turn did cost twice and the next
 * one will too. Naming the model's limitation rather than Atlas's is not
 * blame-shifting — it is the only detail that helps the user decide whether to
 * switch models.
 */
export function proseFallbackNote(files: ProseFile[]): string {
  if (!files.length) return "";
  const names = files.map((f) => f.path).join(", ");
  return (
    `The model could not deliver these through a tool call, so they were written from its reply instead: ${names}. ` +
    "That costs an extra round each time; a model with more reliable tool calling will build faster."
  );
}
