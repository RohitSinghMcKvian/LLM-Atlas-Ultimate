import { describe, expect, it } from "vitest";
import { SUMMARY_MAX, summarize } from "./summarize";

describe("summarize", () => {
  it("flattens HTML and never returns markup", () => {
    const out = summarize({
      summaryHtml:
        "<p>Nova 3 is available today at <strong>$3 per million tokens</strong>.</p><script>track()</script>",
    });
    expect(out).toBe("Nova 3 is available today at $3 per million tokens.");
    expect(out).not.toContain("<");
    expect(out).not.toContain("track()");
  });

  it("drops the 'appeared first on' boilerplate every WordPress feed appends", () => {
    const out = summarize({
      summaryHtml:
        "<p>Regulators opened an inquiry into training data.</p>" +
        "<p>The post Regulators open inquiry appeared first on Example Press.</p>",
    });
    expect(out).toBe("Regulators opened an inquiry into training data.");
    expect(out).not.toContain("appeared first on");
  });

  it("drops other trailing boilerplate", () => {
    for (const tail of [
      "Continue reading…",
      "Subscribe to our weekly newsletter for more.",
      "Share this: Twitter Facebook",
      "Image credit: Getty Images",
    ]) {
      const out = summarize({ summaryHtml: `<p>A real sentence about the model.</p><p>${tail}</p>` });
      expect(out, tail).toBe("A real sentence about the model.");
    }
  });

  it("strips the arXiv machine preamble", () => {
    const out = summarize({
      summaryHtml:
        "arXiv:2507.01234v1 Announce Type: new Abstract: We present an empirical study of scaling behaviour.",
    });
    expect(out).toBe("We present an empirical study of scaling behaviour.");
  });

  it("never exceeds the cap and ends on a word boundary", () => {
    const long = `${"The model improves throughput and reduces latency across every tested workload. ".repeat(20)}`;
    const out = summarize({ summaryHtml: long });
    expect(out.length).toBeLessThanOrEqual(SUMMARY_MAX);
    // No mid-word truncation: the last chunk is either a whole word or an ellipsis.
    expect(out).not.toMatch(/\w-…$/);
    expect(out.trim()).toBe(out);
  });

  it("truncates a single over-long sentence rather than returning nothing", () => {
    const monster = `Nova 3 ${"and more capabilities ".repeat(60)}shipped`;
    const out = summarize({ summaryHtml: monster });
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  it("keeps at most three sentences", () => {
    const out = summarize({
      summaryHtml: "One thing. Two things. Three things. Four things. Five things.",
    });
    expect(out).toBe("One thing. Two things. Three things.");
  });

  it("does not split on abbreviations or decimals", () => {
    const out = summarize({
      summaryHtml: "Dr. Chen reported a 4.8 point gain. The team will publish next week.",
    });
    expect(out).toContain("Dr. Chen");
    expect(out).toContain("4.8 point");
  });

  it("falls back to the body when the excerpt is too thin", () => {
    const out = summarize({
      summaryHtml: "Read on.",
      contentHtml: "<p>The company reduced prices across the entire model family this morning.</p>",
    });
    expect(out).toContain("reduced prices");
  });

  it("drops a headline that the description merely repeats", () => {
    const title = "Nova 3 arrives with a one million token context window";
    const out = summarize({
      title,
      summaryHtml: `${title}. It is available in the API today and costs $3 per million input tokens.`,
    });
    expect(out.startsWith(title)).toBe(false);
    expect(out).toContain("available in the API today");
  });

  it("keeps the headline when stripping it would leave nothing useful", () => {
    const title = "Nova 3 arrives";
    const out = summarize({ title, summaryHtml: `${title}. Short.` });
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns an empty string only when there is genuinely no text", () => {
    expect(summarize({})).toBe("");
    expect(summarize({ summaryHtml: "   " })).toBe("");
    expect(summarize({ summaryHtml: "<p></p>" })).toBe("");
    expect(summarize({ summaryHtml: "<p>Anything at all.</p>" })).not.toBe("");
  });

  it("is deterministic", () => {
    const input = {
      title: "Nova 3 ships",
      summaryHtml: "<p>Nova 3 is available today. It costs less than Nova 2. Benchmarks follow.</p>",
    };
    const first = summarize(input);
    for (let i = 0; i < 5; i++) expect(summarize(input)).toBe(first);
  });

  it("collapses whitespace introduced by block elements", () => {
    const out = summarize({ summaryHtml: "<div>One</div>\n\n\n<div>Two</div>" });
    expect(out).not.toMatch(/\s{2,}/);
  });
});
