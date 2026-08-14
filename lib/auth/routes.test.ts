import { describe, expect, it } from "vitest";
import {
  classifyPath,
  requiresSession,
  safeNext,
  signInUrlFor,
  DEFAULT_SIGNED_IN_PATH,
} from "./routes";

describe("classifyPath", () => {
  it("gates the surfaces that persist per-user rows", () => {
    for (const p of ["/chat", "/code", "/playground", "/vault", "/notebooks"]) {
      expect(classifyPath(p)).toBe("protected");
    }
  });

  it("leaves reference surfaces open", () => {
    for (const p of ["/", "/leaderboard", "/news", "/docs", "/learn", "/cost"]) {
      expect(classifyPath(p)).toBe("public");
    }
  });

  it("matches nested paths under a protected prefix", () => {
    expect(classifyPath("/chat/abc-123")).toBe("protected");
    expect(classifyPath("/code/session/1/file")).toBe("protected");
  });

  it("respects segment boundaries", () => {
    // The bug a plain startsWith would introduce: gating an unrelated route
    // because its name happens to begin with a gated one.
    expect(classifyPath("/chatterbox")).toBe("public");
    expect(classifyPath("/benchmarks")).toBe("public");
    expect(classifyPath("/administration")).toBe("public");
  });

  it("separates /learn from /leaderboard", () => {
    expect(classifyPath("/learn")).toBe("public");
    expect(classifyPath("/leaderboard")).toBe("public");
  });

  it("classifies admin ahead of everything else", () => {
    expect(classifyPath("/admin")).toBe("admin");
    expect(classifyPath("/admin/users")).toBe("admin");
  });

  it("classifies the auth surfaces", () => {
    expect(classifyPath("/login")).toBe("auth");
    expect(classifyPath("/register")).toBe("auth");
  });

  it("never gates API routes", () => {
    // Middleware matches /api so cookies stay refreshed; nothing there may be
    // answered with an HTML redirect.
    for (const p of ["/api/v1/chat", "/api/v1/catalog", "/api/v1/mcp"]) {
      expect(classifyPath(p)).toBe("public");
      expect(requiresSession(p)).toBe(false);
    }
  });
});

describe("requiresSession", () => {
  it("covers protected and admin, not public or auth", () => {
    expect(requiresSession("/chat")).toBe(true);
    expect(requiresSession("/admin")).toBe(true);
    expect(requiresSession("/leaderboard")).toBe(false);
    expect(requiresSession("/login")).toBe(false);
  });
});

describe("safeNext", () => {
  it("keeps same-origin paths, including query strings", () => {
    expect(safeNext("/chat")).toBe("/chat");
    expect(safeNext("/leaderboard?sort=elo")).toBe("/leaderboard?sort=elo");
  });

  it("falls back when there is nothing to honour", () => {
    expect(safeNext(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNext("")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNext(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses absolute URLs", () => {
    expect(safeNext("https://evil.com")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNext("http://evil.com/chat")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses protocol-relative URLs", () => {
    // The case that survives a naive startsWith("/"): browsers read this as
    // absolute, so it would bounce a freshly signed-in user off-site.
    expect(safeNext("//evil.com")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNext("//evil.com/chat")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses backslashes, which some parsers normalize to /", () => {
    expect(safeNext("/\\evil.com")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNext("\\\\evil.com")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses control characters", () => {
    expect(safeNext("/chat\nSet-Cookie: x=1")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNext("/chat\r\n")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNext("/chat" + String.fromCharCode(0))).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("honours an explicit fallback", () => {
    expect(safeNext("https://evil.com", "/leaderboard")).toBe("/leaderboard");
  });
});

describe("signInUrlFor", () => {
  it("encodes the destination", () => {
    expect(signInUrlFor("/chat")).toBe("/login?next=%2Fchat");
  });

  it("carries the query string so a deep link survives the detour", () => {
    expect(signInUrlFor("/playground", "?model=gpt")).toBe(
      "/login?next=%2Fplayground%3Fmodel%3Dgpt",
    );
  });

  it("sanitizes before encoding", () => {
    expect(signInUrlFor("//evil.com")).toBe(
      `/login?next=${encodeURIComponent(DEFAULT_SIGNED_IN_PATH)}`,
    );
  });
});
