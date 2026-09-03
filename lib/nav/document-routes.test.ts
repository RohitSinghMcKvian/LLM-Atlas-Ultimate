import { describe, it, expect, vi } from "vitest";
import { needsDocumentNav, navigateTo } from "./document-routes";

describe("needsDocumentNav", () => {
  it("claims the cross-origin-isolated route", () => {
    expect(needsDocumentNav("/code")).toBe(true);
  });

  /**
   * The header rule in `next.config.mjs` is `/code/:path*`, so isolation covers
   * sub-routes too — and a sub-route reached by the router would be just as
   * un-isolated as the root one.
   */
  it("claims its sub-routes", () => {
    expect(needsDocumentNav("/code/new")).toBe(true);
    expect(needsDocumentNav("/code/a/b")).toBe(true);
  });

  it("ignores query strings and hashes", () => {
    expect(needsDocumentNav("/code?tab=terminal")).toBe(true);
    expect(needsDocumentNav("/code#run")).toBe(true);
  });

  /** `/codex` is not `/code`, and a prefix test that got this wrong would send
   *  ordinary routes through a full page load. */
  it("does not claim routes that merely start with the same letters", () => {
    expect(needsDocumentNav("/codex")).toBe(false);
    expect(needsDocumentNav("/code-review")).toBe(false);
  });

  it("leaves every other route to the router", () => {
    for (const href of ["/chat", "/compare", "/leaderboard", "/", "/news/abc"]) {
      expect(needsDocumentNav(href)).toBe(false);
    }
  });
});

describe("navigateTo", () => {
  it("routes ordinary hrefs through the client router", () => {
    const push = vi.fn();
    navigateTo("/chat", push);
    expect(push).toHaveBeenCalledWith("/chat");
  });

  it("does not use the router for a document-nav route", () => {
    const push = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    navigateTo("/code", push);
    expect(push).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/code");
    vi.unstubAllGlobals();
  });
});
