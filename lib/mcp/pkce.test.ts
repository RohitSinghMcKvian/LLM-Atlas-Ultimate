import { describe, it, expect } from "vitest";
import {
  authorizeUrl,
  base64UrlEncode,
  challengeFor,
  createPkce,
  createState,
  createVerifier,
  parseCallback,
  refreshRequestBody,
  tokenRequestBody,
} from "./pkce";

describe("base64UrlEncode", () => {
  // Standard base64 would be rejected: + and / are not URL-safe and = padding is
  // explicitly disallowed in a code challenge.
  it("is URL-safe and unpadded", () => {
    const bytes = new Uint8Array([251, 255, 190, 1, 2]);
    const out = base64UrlEncode(bytes);
    expect(out).not.toMatch(/[+/=]/);
  });

  it("round-trips through the URL-safe alphabet", () => {
    const out = base64UrlEncode(new Uint8Array([0, 1, 2, 3, 4]));
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("createVerifier", () => {
  it("lands inside RFC 7636's 43–128 character range", () => {
    const v = createVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });

  it("uses only the unreserved character set", () => {
    expect(createVerifier()).toMatch(/^[A-Za-z0-9._~-]+$/);
  });

  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 20 }, () => createVerifier()));
    expect(seen.size).toBe(20);
  });
});

describe("challengeFor", () => {
  // RFC 7636 Appendix B's published vector — the one way to be sure this is S256
  // and not something that merely looks like it.
  it("matches the RFC 7636 test vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await challengeFor(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("is deterministic for the same verifier", async () => {
    const v = createVerifier();
    expect(await challengeFor(v)).toBe(await challengeFor(v));
  });

  it("differs for different verifiers", async () => {
    expect(await challengeFor(createVerifier())).not.toBe(await challengeFor(createVerifier()));
  });
});

describe("createPkce", () => {
  it("returns a matching verifier/challenge plus a distinct state", async () => {
    const p = await createPkce();
    expect(await challengeFor(p.verifier)).toBe(p.challenge);
    expect(p.state).not.toBe(p.verifier);
    expect(p.state.length).toBeGreaterThan(20);
  });
});

describe("authorizeUrl", () => {
  const base = {
    authorizationEndpoint: "https://auth.example.com/authorize",
    clientId: "atlas",
    redirectUri: "https://atlas.test/connectors/callback",
    challenge: "CHAL",
    state: "STATE",
  };

  it("declares S256, never plain", () => {
    const url = new URL(authorizeUrl(base));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("CHAL");
  });

  it("carries the standard public-client parameters", () => {
    const url = new URL(authorizeUrl(base));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("atlas");
    expect(url.searchParams.get("state")).toBe("STATE");
  });

  it("never sends a client secret", () => {
    expect(authorizeUrl(base)).not.toContain("client_secret");
  });

  it("omits optional parameters when not given", () => {
    const url = new URL(authorizeUrl(base));
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.has("resource")).toBe(false);
  });

  // RFC 8707: without it, a token minted for one MCP server can be replayed
  // against another that trusts the same authorization server.
  it("binds the token to an audience when a resource is given", () => {
    const url = new URL(authorizeUrl({ ...base, resource: "https://mcp.example.com/" }));
    expect(url.searchParams.get("resource")).toBe("https://mcp.example.com/");
  });

  it("preserves an endpoint's existing query string", () => {
    const url = new URL(
      authorizeUrl({ ...base, authorizationEndpoint: "https://auth.example.com/a?tenant=7" }),
    );
    expect(url.searchParams.get("tenant")).toBe("7");
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("parseCallback", () => {
  const cb = (q: string) => `https://atlas.test/connectors/callback?${q}`;

  it("returns the code when state matches", () => {
    expect(parseCallback(cb("code=abc&state=S"), "S")).toEqual({ code: "abc" });
  });

  // State is checked before anything else; validating after acting on the code
  // is the bug that makes state ceremonial.
  it("refuses a mismatched state even when a code is present", () => {
    const r = parseCallback(cb("code=abc&state=EVIL"), "S");
    expect(r.code).toBeUndefined();
    expect(r.error).toContain("state");
  });

  it("refuses a missing state", () => {
    expect(parseCallback(cb("code=abc"), "S").code).toBeUndefined();
  });

  it("refuses when the expected state is empty", () => {
    expect(parseCallback(cb("code=abc"), "").code).toBeUndefined();
  });

  it("surfaces the provider's error description", () => {
    const r = parseCallback(cb("error=access_denied&error_description=User+said+no&state=S"), "S");
    expect(r.error).toBe("User said no");
  });

  it("falls back to the error code when there is no description", () => {
    expect(parseCallback(cb("error=access_denied&state=S"), "S").error).toBe("access_denied");
  });

  it("reports a callback with neither code nor error", () => {
    expect(parseCallback(cb("state=S"), "S").error).toContain("no authorization code");
  });

  it("reports an unparseable URL", () => {
    expect(parseCallback("not a url", "S").error).toContain("could not be parsed");
  });
});

describe("token request bodies", () => {
  it("sends the verifier in place of a client secret", () => {
    const body = new URLSearchParams(
      tokenRequestBody({
        code: "abc",
        clientId: "atlas",
        redirectUri: "https://atlas.test/cb",
        verifier: "VERIFIER",
      }),
    );
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("VERIFIER");
    expect(body.has("client_secret")).toBe(false);
  });

  it("includes the resource when binding an audience", () => {
    const body = new URLSearchParams(
      tokenRequestBody({
        code: "a",
        clientId: "c",
        redirectUri: "r",
        verifier: "v",
        resource: "https://mcp.example.com/",
      }),
    );
    expect(body.get("resource")).toBe("https://mcp.example.com/");
  });

  it("builds a secret-free refresh body", () => {
    const body = new URLSearchParams(
      refreshRequestBody({ refreshToken: "RT", clientId: "atlas" }),
    );
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("RT");
    expect(body.has("client_secret")).toBe(false);
  });
});

describe("createState", () => {
  it("is unique per call", () => {
    expect(new Set(Array.from({ length: 20 }, () => createState())).size).toBe(20);
  });
});
