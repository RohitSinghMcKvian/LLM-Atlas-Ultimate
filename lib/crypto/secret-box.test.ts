import { describe, it, expect, beforeAll } from "vitest";
import {
  cryptoAvailable,
  generateMasterKey,
  isSealed,
  openWith,
  sealWith,
} from "./secret-box";

// Node 20+ exposes WebCrypto globally, so the primitives run unchanged here.
// Only the IndexedDB-backed master key needs a browser, and it sits behind a
// separate boundary (`getMasterKey`) that these tests don't touch.

let key: CryptoKey;
let other: CryptoKey;

beforeAll(async () => {
  key = await generateMasterKey();
  other = await generateMasterKey();
});

describe("environment", () => {
  it("has WebCrypto", () => {
    expect(cryptoAvailable()).toBe(true);
  });
});

describe("sealWith / openWith", () => {
  it("round-trips a value", async () => {
    const secret = "sk-or-v1-0123456789abcdef";
    expect(await openWith(key, await sealWith(key, secret))).toBe(secret);
  });

  it("round-trips unicode and empty strings", async () => {
    for (const v of ["", "🔐 clé — ключ", JSON.stringify({ a: [1, 2, 3] })]) {
      expect(await openWith(key, await sealWith(key, v))).toBe(v);
    }
  });

  it("does not leave the plaintext recoverable in the payload", async () => {
    const secret = "sk-or-v1-supersecrettoken";
    const sealed = await sealWith(key, secret);
    expect(sealed).not.toContain(secret);
    expect(sealed).not.toContain("supersecret");
    // ...and not merely base64-encoded, which is what the old vault did.
    expect(Buffer.from(sealed, "base64").toString("utf8")).not.toContain(secret);
  });

  it("produces a distinct payload each time (fresh IV)", async () => {
    const a = await sealWith(key, "same");
    const b = await sealWith(key, "same");
    expect(a).not.toBe(b);
    expect(await openWith(key, a)).toBe(await openWith(key, b));
  });

  it("marks its output as sealed", async () => {
    expect(isSealed(await sealWith(key, "x"))).toBe(true);
  });
});

describe("openWith rejects bad input", () => {
  it("returns null for legacy plaintext", async () => {
    expect(await openWith(key, '{"state":{"openrouterKey":"sk-or-v1-x"}}')).toBeNull();
  });

  it("returns null for a different key", async () => {
    expect(await openWith(other, await sealWith(key, "secret"))).toBeNull();
  });

  it("returns null for tampered ciphertext (GCM auth tag)", async () => {
    const sealed = await sealWith(key, "secret value here");
    const [p, iv, ct] = sealed.split(".");
    // Flip a character in the ciphertext body.
    const flipped = ct[0] === "A" ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
    expect(await openWith(key, [p, iv, flipped].join("."))).toBeNull();
  });

  it("returns null for structurally malformed payloads", async () => {
    for (const bad of ["", "atlas1", "atlas1.onlyone", "atlas1.a.b.c", "atlas1.!!.??"]) {
      expect(await openWith(key, bad), bad).toBeNull();
    }
  });
});

describe("isSealed", () => {
  it("distinguishes sealed values from legacy cleartext JSON", () => {
    expect(isSealed('{"state":{}}')).toBe(false);
    expect(isSealed("atlas1.aaa.bbb")).toBe(true);
  });
});
