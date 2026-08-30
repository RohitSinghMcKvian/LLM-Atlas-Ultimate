import { describe, it, expect } from "vitest";
import { scanMarkers } from "./markers";
import { profileCitations, sourceCoverage } from "./citations";

describe("scanMarkers", () => {
  it("reads a grouped citation, which the shared parser misses entirely", () => {
    // Observed live from llama-3-1-8b against a 12-source pack:
    //   "RAG [1, 5, 8] is generally more cost-effective than long-context…"
    // `/\[(\d{1,3})\]/g` finds nothing there, so the answer was recorded as
    // citing zero sources while visibly citing three.
    expect(scanMarkers("RAG [1, 5, 8] is cheaper.").distinct).toEqual([1, 5, 8]);
  });

  it("still reads the plain and adjacent forms", () => {
    expect(scanMarkers("See [1] and [2][3].").distinct).toEqual([1, 2, 3]);
  });

  it("expands a range", () => {
    expect(scanMarkers("As shown in [2-4].").distinct).toEqual([2, 3, 4]);
  });

  it("accepts semicolons and spaces inside a group", () => {
    expect(scanMarkers("[1; 2] and [3 4]").distinct).toEqual([1, 2, 3, 4]);
  });

  it("counts groups separately from references", () => {
    const scan = scanMarkers("[1, 5, 8] then [1]");
    expect(scan.groups).toBe(2);
    expect(scan.all).toEqual([1, 5, 8, 1]);
    expect(scan.distinct).toEqual([1, 5, 8]);
  });

  it("ignores a markdown link, which is not a citation", () => {
    expect(scanMarkers("[the title](https://example.com/9)").distinct).toEqual([]);
  });

  it("ignores bracketed prose", () => {
    expect(scanMarkers("[see above] and [TODO]").distinct).toEqual([]);
  });

  it("ignores a bracket with no digits at all", () => {
    expect(scanMarkers("[-] [,]").distinct).toEqual([]);
  });

  it("rejects a descending range rather than inventing numbers", () => {
    expect(scanMarkers("[9-2]").distinct).toEqual([]);
  });

  it("rejects an absurd range rather than emitting hundreds of citations", () => {
    expect(scanMarkers("[1-900]").distinct).toEqual([]);
  });

  it("rejects a group containing a non-number", () => {
    expect(scanMarkers("[1, five, 8]").distinct).toEqual([]);
  });

  it("rejects a number beyond three digits, matching the shared parser's bound", () => {
    expect(scanMarkers("[1234]").distinct).toEqual([]);
  });

  it("finds nothing in text with no markers", () => {
    expect(scanMarkers("No citations here at all.").distinct).toEqual([]);
  });
});

describe("profileCitations with grouped markers", () => {
  it("counts a grouped citation as three references, not zero", () => {
    const p = profileCitations("RAG [1, 5, 8] is cheaper.", 12);
    expect(p.cited).toEqual([1, 5, 8]);
    expect(p.markers).toBe(3);
    expect(p.density).toBeGreaterThan(0);
  });

  it("catches a fabricated number hiding inside a group", () => {
    // The dangerous case: the group reads as grounded, and one of its numbers
    // does not exist.
    expect(profileCitations("See [1, 99].", 12).fabricated).toEqual([99]);
  });
});

describe("sourceCoverage with grouped markers", () => {
  it("credits every source named in a group", () => {
    const r = sourceCoverage([{ id: "a", text: "Per [1, 3]." }], 3);
    expect(r.usage[0].laneIds).toEqual(["a"]);
    expect(r.usage[2].laneIds).toEqual(["a"]);
    expect(r.unused).toEqual([2]);
  });
});
