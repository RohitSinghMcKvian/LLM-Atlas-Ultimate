import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { encryptedLocalStorage } from "./encrypted-storage";
import { generateMasterKey, isSealed } from "./secret-box";

/** Minimal in-memory stand-in for localStorage (absent in the Node test env). */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const NAME = "atlas-keys";
const PLAINTEXT_LEGACY = JSON.stringify({
  state: { openrouterKey: "sk-or-v1-legacyplaintext" },
  version: 0,
});

let key: CryptoKey;
beforeAll(async () => {
  key = await generateMasterKey();
});

let store: ReturnType<typeof fakeStorage>;
let adapter: ReturnType<typeof encryptedLocalStorage<{ openrouterKey: string }>>;

beforeEach(() => {
  store = fakeStorage();
  adapter = encryptedLocalStorage<{ openrouterKey: string }>({
    getKey: async () => key,
    storage: store,
  });
});

describe("round-trip", () => {
  it("writes ciphertext, not the value", async () => {
    await adapter.setItem(NAME, { state: { openrouterKey: "sk-or-v1-abc" }, version: 0 });
    const raw = store.getItem(NAME)!;
    expect(isSealed(raw)).toBe(true);
    expect(raw).not.toContain("sk-or-v1-abc");
  });

  it("reads back what it wrote", async () => {
    const value = { state: { openrouterKey: "sk-or-v1-abc" }, version: 0 };
    await adapter.setItem(NAME, value);
    expect(await adapter.getItem(NAME)).toEqual(value);
  });

  it("returns null when nothing is stored", async () => {
    expect(await adapter.getItem(NAME)).toBeNull();
  });

  it("removes", async () => {
    await adapter.setItem(NAME, { state: { openrouterKey: "x" }, version: 0 });
    await adapter.removeItem(NAME);
    expect(await adapter.getItem(NAME)).toBeNull();
  });
});

describe("migration from legacy plaintext", () => {
  beforeEach(() => store.setItem(NAME, PLAINTEXT_LEGACY));

  it("still returns the user's existing key", async () => {
    const out = await adapter.getItem(NAME);
    expect(out).toEqual(JSON.parse(PLAINTEXT_LEGACY));
  });

  it("overwrites the cleartext on that same read", async () => {
    await adapter.getItem(NAME);
    const raw = store.getItem(NAME)!;
    expect(isSealed(raw)).toBe(true);
    expect(raw).not.toContain("sk-or-v1-legacyplaintext");
  });

  it("is idempotent — a second read decrypts rather than re-migrating", async () => {
    await adapter.getItem(NAME);
    expect(await adapter.getItem(NAME)).toEqual(JSON.parse(PLAINTEXT_LEGACY));
  });
});

describe("failure handling", () => {
  it("discards a corrupt sealed blob instead of throwing", async () => {
    store.setItem(NAME, "atlas1.notbase64!.alsonot!");
    expect(await adapter.getItem(NAME)).toBeNull();
    expect(store.getItem(NAME)).toBeNull();
  });

  it("discards a blob sealed under a different key", async () => {
    const foreign = encryptedLocalStorage<{ openrouterKey: string }>({
      getKey: async () => await generateMasterKey(),
      storage: store,
    });
    await foreign.setItem(NAME, { state: { openrouterKey: "x" }, version: 0 });
    expect(await adapter.getItem(NAME)).toBeNull();
  });

  it("drops unparseable legacy cleartext rather than keeping it", async () => {
    store.setItem(NAME, "this is not json");
    expect(await adapter.getItem(NAME)).toBeNull();
    expect(store.getItem(NAME)).toBeNull();
  });

  // The important one: if we cannot encrypt, we must not silently downgrade to
  // storing the key in the clear.
  it("fails closed when the key is unavailable, leaving nothing behind", async () => {
    const broken = encryptedLocalStorage<{ openrouterKey: string }>({
      getKey: async () => {
        throw new Error("no secure context");
      },
      storage: store,
    });
    await broken.setItem(NAME, { state: { openrouterKey: "sk-or-v1-secret" }, version: 0 });
    expect(store.getItem(NAME)).toBeNull();
  });

  it("erases legacy cleartext even when it cannot re-seal it", async () => {
    store.setItem(NAME, PLAINTEXT_LEGACY);
    const broken = encryptedLocalStorage<{ openrouterKey: string }>({
      getKey: async () => {
        throw new Error("no secure context");
      },
      storage: store,
    });
    // The in-flight value is still handed back so the session keeps working...
    expect(await broken.getItem(NAME)).toEqual(JSON.parse(PLAINTEXT_LEGACY));
    // ...but the plaintext no longer survives on disk.
    expect(store.getItem(NAME)).toBeNull();
  });
});
