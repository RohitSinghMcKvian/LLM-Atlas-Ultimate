import { describe, expect, it } from "vitest";
import { PRINT_PROTOCOL, printClientScript, printHtmlDocument } from "./print";

describe("printClientScript", () => {
  const src = printClientScript();

  it("only answers its own protocol", () => {
    expect(src).toContain(JSON.stringify(PRINT_PROTOCOL));
    expect(src).toContain("d.protocol!==P");
  });

  it("only answers the parent window", () => {
    // Any other frame on the page could otherwise pop a print dialog.
    expect(src).toContain("e.source!==parent");
  });

  it("is a complete script element, ready to concatenate into a head", () => {
    expect(src.startsWith("<script>")).toBe(true);
    expect(src.trimEnd().endsWith("</script>")).toBe(true);
  });

  it("appends its page rules instead of restyling the artifact", () => {
    // A generated page is designed for a screen; forcing paper colours on it
    // would discard the design the user is looking at.
    expect(src).toContain("appendChild");
    expect(src).toContain("@page{size:A4");
  });

  it("swallows its own failures", () => {
    // Printing is a nicety. A frame that throws here must not take the artifact
    // down with it.
    expect(src).toContain("catch(err){}");
  });
});

describe("printHtmlDocument", () => {
  it("is a no-op without a DOM rather than throwing", () => {
    // It is imported by a client component that the node-only suite loads.
    expect(typeof document).toBe("undefined");
    expect(() => printHtmlDocument("<p>x</p>")).not.toThrow();
  });
});
