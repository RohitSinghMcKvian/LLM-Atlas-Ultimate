import { describe, it, expect } from "vitest";
import { applyArtifactPatch, describePatchFailure, summarizePatch } from "./artifact-patch";

const PAGE = `<header class="hero">
  <h1>Old headline</h1>
  <p>Subtitle</p>
</header>
<footer>
  <p>Subtitle</p>
</footer>`;

describe("applyArtifactPatch", () => {
  it("replaces a unique fragment", () => {
    const r = applyArtifactPatch(PAGE, "<h1>Old headline</h1>", "<h1>New headline</h1>");
    expect(r.ok).toBe(true);
    expect(r.code).toContain("<h1>New headline</h1>");
    expect(r.code).not.toContain("Old headline");
  });

  it("preserves everything outside the replaced fragment", () => {
    const r = applyArtifactPatch(PAGE, "Old headline", "New");
    expect(r.code.split("\n")).toHaveLength(PAGE.split("\n").length);
  });

  // Two candidates means the caller was not specific enough. Guessing which one
  // they meant is how the wrong element gets restyled.
  it("refuses an ambiguous match and reports how many it found", () => {
    const r = applyArtifactPatch(PAGE, "<p>Subtitle</p>", "<p>New</p>");
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("ambiguous");
    expect(r.occurrences).toBe(2);
    expect(r.code).toBe(PAGE);
  });

  it("refuses text that is not present", () => {
    const r = applyArtifactPatch(PAGE, "<h1>Nope</h1>", "x");
    expect(r.failure).toBe("not-found");
    expect(r.code).toBe(PAGE);
  });

  it("matches exactly — whitespace is not normalised", () => {
    expect(applyArtifactPatch(PAGE, "<h1>Old  headline</h1>", "x").failure).toBe("not-found");
    expect(applyArtifactPatch(PAGE, "<h1>Old headline</h1> ", "x").failure).toBe("not-found");
  });

  it("supports deletion", () => {
    const r = applyArtifactPatch(PAGE, "  <h1>Old headline</h1>\n", "");
    expect(r.ok).toBe(true);
    expect(r.code).not.toContain("Old headline");
  });

  it("rejects an empty or unchanged patch instead of reporting a no-op as success", () => {
    expect(applyArtifactPatch(PAGE, "", "x").failure).toBe("empty");
    expect(applyArtifactPatch(PAGE, "Subtitle", "Subtitle").failure).toBe("unchanged");
  });

  // The contract that matters: a caller that ignores `ok` can fail to change the
  // artifact, but can never corrupt it.
  it("returns the original code on every failure path", () => {
    for (const [o, n] of [
      ["", "x"],
      ["missing", "x"],
      ["<p>Subtitle</p>", "y"],
      ["same", "same"],
    ])
      expect(applyArtifactPatch(PAGE, o, n).code).toBe(PAGE);
  });
});

describe("describePatchFailure", () => {
  it("tells the model what to do differently", () => {
    const ambiguous = applyArtifactPatch(PAGE, "<p>Subtitle</p>", "x");
    expect(describePatchFailure(ambiguous, "<p>Subtitle</p>")).toContain("more surrounding lines");

    const missing = applyArtifactPatch(PAGE, "nope", "x");
    expect(describePatchFailure(missing, "nope")).toContain("read");
  });

  it("truncates a huge old_str in the message", () => {
    const long = "z".repeat(500);
    expect(describePatchFailure(applyArtifactPatch(PAGE, long, "x"), long).length).toBeLessThan(300);
  });
});

describe("summarizePatch", () => {
  it("counts lines in and out", () => {
    expect(summarizePatch("a\nb", "c\nd\ne")).toBe("Replaced 2 lines with 3.");
    expect(summarizePatch("a", "b")).toBe("Replaced 1 line with 1.");
    expect(summarizePatch("a\nb", "")).toBe("Removed 2 lines.");
  });
});
