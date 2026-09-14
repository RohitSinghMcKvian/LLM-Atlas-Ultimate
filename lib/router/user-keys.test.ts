import { describe, expect, it } from "vitest";
import {
  LEGACY_OPENROUTER_HEADER,
  readUserKeys,
  userKeyHeaderFor,
  userKeyHeaders,
  userKeyProviders,
} from "./user-keys";

// The browser writes these headers and the route handlers read them back. Both
// halves come from this module, so the only way they can disagree is if the
// round-trip below breaks.

const h = (init: Record<string, string>) => new Headers(init);

describe("readUserKeys", () => {
  it("reads one key per provider", () => {
    const keys = readUserKeys(
      h({ "x-atlas-key-groq": "gsk_abc", "x-atlas-key-openrouter": "sk-or-v1-xyz" }),
    );
    expect(keys).toEqual({ groq: "gsk_abc", openrouter: "sk-or-v1-xyz" });
  });

  it("returns an empty object when nothing is sent", () => {
    expect(readUserKeys(h({}))).toEqual({});
  });

  it("trims surrounding whitespace", () => {
    expect(readUserKeys(h({ "x-atlas-key-groq": "  gsk_abc  " }))).toEqual({ groq: "gsk_abc" });
  });

  it("drops a blank value rather than storing an empty string", () => {
    // An empty string would read as "a key is present" to every downstream
    // `Boolean(...)` check and route the request onto a credential-less runtime.
    expect(readUserKeys(h({ "x-atlas-key-groq": "   " }))).toEqual({});
  });

  it("ignores headers that do not name a real provider", () => {
    // Only known ids are consulted, so an arbitrary header cannot be smuggled
    // through into a provider runtime.
    const keys = readUserKeys(
      h({ "x-atlas-key-evil": "nope", "x-atlas-key-__proto__": "nope" }),
    );
    expect(keys).toEqual({});
  });

  it("still accepts the legacy OpenRouter header", () => {
    // A tab left open across a deploy keeps working.
    expect(readUserKeys(h({ [LEGACY_OPENROUTER_HEADER]: "sk-or-v1-old" }))).toEqual({
      openrouter: "sk-or-v1-old",
    });
  });

  it("prefers the explicit header when both spellings are present", () => {
    const keys = readUserKeys(
      h({ "x-atlas-key-openrouter": "new", [LEGACY_OPENROUTER_HEADER]: "old" }),
    );
    expect(keys.openrouter).toBe("new");
  });
});

describe("userKeyProviders", () => {
  it("lists only providers with a non-empty key", () => {
    expect(userKeyProviders({ groq: "gsk_abc", openrouter: "" })).toEqual(["groq"]);
  });

  it("is empty for undefined", () => {
    expect(userKeyProviders(undefined)).toEqual([]);
  });
});

describe("the header round-trip", () => {
  it("survives write then read", () => {
    const original = { groq: "gsk_abc", google: "AIza-xyz" } as const;
    expect(readUserKeys(h(userKeyHeaders(original)))).toEqual(original);
  });

  it("emits nothing when no key is set", () => {
    expect(userKeyHeaders({})).toEqual({});
    expect(userKeyHeaders(undefined)).toEqual({});
  });

  it("names headers with the documented prefix", () => {
    expect(userKeyHeaderFor("groq")).toBe("x-atlas-key-groq");
  });
});
