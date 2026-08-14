import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROSE_PATH,
  filesFromProse,
  MAX_PROSE_FILES,
  proseFallbackNote,
  PROSE_FALLBACK_INSTRUCTION,
  shouldFallBackToProse,
  UNRETRYABLE,
} from "./prose-fallback";

/**
 * The measurement this module exists for.
 *
 * `nvidia/nemotron-3-ultra-550b-a55b` wrote 48,992 characters of a NASA landing
 * page when asked in prose, and emitted zero tool calls when asked to write the
 * same file through `workspace create` — three runs through Atlas and two direct
 * probes at 311 s each, one with `tool_choice` pinned to the function. Build
 * mode had exactly one channel for producing a file, and it was the one this
 * model could not use.
 */

const page = (body: string) => "```html\n" + body + "\n```";
const named = (path: string, lang: string, body: string) =>
  "```" + lang + ' path="' + path + '"\n' + body + "\n```";

describe("shouldFallBackToProse", () => {
  it("fires on the measured failure: stalled, nothing written", () => {
    expect(shouldFallBackToProse({ stalled: true, content: "", filesWritten: 0 })).toBe(true);
  });

  it("fires on an empty answer even without a stall", () => {
    expect(shouldFallBackToProse({ content: "   " })).toBe(true);
  });

  // Retrying a round that already wrote something would duplicate work the user
  // has paid for, and leave two versions of a half-built page.
  it("does not fire once anything reached the workspace", () => {
    expect(shouldFallBackToProse({ stalled: true, filesWritten: 1 })).toBe(false);
  });

  // The bug that made the first version of this dead code: every build opens by
  // calling `tasks` to write its plan, so refusing on "any tool call succeeded"
  // was true on round one of every real build and the fallback never fired.
  it("still fires when the plan tool succeeded but no file was written", () => {
    expect(shouldFallBackToProse({ stalled: true, filesWritten: 0 })).toBe(true);
  });

  it("does not fire on an ordinary answer", () => {
    expect(shouldFallBackToProse({ content: "Here is the page." })).toBe(false);
  });
});

describe("filesFromProse", () => {
  it("takes the path the model named on the fence", () => {
    const files = filesFromProse(named("index.html", "html", "<!doctype html><h1>NASA</h1>"));
    expect(files).toEqual([{ path: "index.html", text: "<!doctype html><h1>NASA</h1>" }]);
  });

  it("recovers a whole multi-file build", () => {
    const content = [
      "Here is the page.",
      named("index.html", "html", "<!doctype html>"),
      named("styles.css", "css", "body{margin:0}"),
      named("app.js", "js", "console.log(1)"),
    ].join("\n\n");
    expect(filesFromProse(content).map((f) => f.path)).toEqual([
      "index.html",
      "styles.css",
      "app.js",
    ]);
  });

  // The common case: "build me a landing page", answered with one HTML block.
  // Refusing it because the model forgot an attribute would throw away the page.
  it("accepts a single unnamed block under a default path", () => {
    const files = filesFromProse(page("<!doctype html><h1>NASA</h1>"));
    expect(files).toEqual([
      { path: DEFAULT_PROSE_PATH, text: "<!doctype html><h1>NASA</h1>" },
    ]);
  });

  // With several blocks and no paths there is no way to tell a file from an
  // illustrative snippet, and guessing would write the snippet over the page.
  it("refuses to guess when several blocks are unnamed", () => {
    expect(filesFromProse([page("<h1>a</h1>"), page("<h1>b</h1>")].join("\n\n"))).toEqual([]);
  });

  it("prefers the named blocks and ignores loose snippets beside them", () => {
    const content = [
      named("index.html", "html", "<!doctype html>"),
      "```bash\nnpm run dev\n```",
    ].join("\n\n");
    expect(filesFromProse(content).map((f) => f.path)).toEqual(["index.html"]);
  });

  it("lets a later block correct an earlier one at the same path", () => {
    const content = [
      named("index.html", "html", "<h1>first</h1>"),
      named("index.html", "html", "<h1>second</h1>"),
    ].join("\n\n");
    expect(filesFromProse(content)).toEqual([{ path: "index.html", text: "<h1>second</h1>" }]);
  });

  it("is bounded", () => {
    const content = Array.from({ length: 12 }, (_, i) =>
      named(`f${i}.html`, "html", `<h1>${i}</h1>`),
    ).join("\n\n");
    expect(filesFromProse(content)).toHaveLength(MAX_PROSE_FILES);
  });

  it("returns nothing for an answer with no code at all", () => {
    expect(filesFromProse("I would start by choosing a colour palette.")).toEqual([]);
  });

  // Truncation is the normal end of a long page on a capped output budget, and
  // an unclosed fence is what that looks like. The block still has to count.
  it("keeps a page whose closing fence never arrived", () => {
    const files = filesFromProse('```html path="index.html"\n<!doctype html><h1>NAS');
    expect(files).toEqual([{ path: "index.html", text: "<!doctype html><h1>NAS" }]);
  });
});

describe("the instruction", () => {
  // Each of these is a way the retry was seen to fail, or would fail silently.
  it("asks for the path, the whole file, and no tool talk", () => {
    expect(PROSE_FALLBACK_INSTRUCTION).toContain('path="index.html"');
    expect(PROSE_FALLBACK_INSTRUCTION).toContain("entire contents");
    expect(PROSE_FALLBACK_INSTRUCTION).toContain("no tools available");
  });
});

describe("proseFallbackNote", () => {
  it("names the files and says the turn cost extra", () => {
    const note = proseFallbackNote([{ path: "index.html", text: "x" }]);
    expect(note).toContain("index.html");
    expect(note).toContain("extra round");
  });

  it("says nothing when there is nothing to say", () => {
    expect(proseFallbackNote([])).toBe("");
  });
});

/**
 * The failure the provider actually reported.
 *
 * Once mid-stream error frames stopped being swallowed, the blank bubble turned
 * out to be NVIDIA's own gateway saying `Upstream idle timeout exceeded` — its
 * backend giving up while the 550B composed a large tool-call argument. Nothing
 * on this side can wait that out, so the retry has to cover an errored round and
 * not only a silent one.
 */
describe("falling back after a provider error", () => {
  it("retries a round the provider errored out of", () => {
    expect(
      shouldFallBackToProse({ errored: true, errorCode: "upstream_error", filesWritten: 0 }),
    ).toBe(true);
  });

  // A second request hits these identically, so paying to find that out is the
  // opposite of helpful.
  it("does not retry an error a second request would hit identically", () => {
    for (const code of [...UNRETRYABLE]) {
      expect(shouldFallBackToProse({ errored: true, errorCode: code })).toBe(false);
    }
  });

  it("still refuses once anything was written, error or not", () => {
    expect(shouldFallBackToProse({ errored: true, errorCode: "upstream_error", filesWritten: 2 })).toBe(
      false,
    );
  });
});
