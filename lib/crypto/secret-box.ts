// AES-GCM encryption for browser-held secrets (spec §1.3).
//
// The threat this addresses: BYOK keys previously sat in localStorage as
// cleartext, readable by anything that reached Atlas's origin. Now the master
// key is a NON-EXTRACTABLE CryptoKey kept in IndexedDB, and only ciphertext
// touches localStorage. `extractable: false` means even same-origin script
// cannot export the raw key bytes — it can only ask the browser to use it.
//
// This is defence in depth, not a silver bullet: any code running at Atlas's
// origin can still call decrypt(). That is exactly why the artifact iframe is
// origin-isolated (see lib/chat/artifact-sandbox.ts) — the two fixes are
// complementary, and neither is sufficient alone.
//
// The primitives here are deliberately free of IndexedDB and localStorage so
// they can be exercised in the Node test environment; storage lives below the
// `getMasterKey` boundary.

const DB_NAME = "atlas-crypto";
const STORE = "keys";
const RECORD = "master-v1";

/** Wire prefix so a stored value can be told apart from legacy cleartext JSON. */
const PREFIX = "atlas1";

const ALGO = "AES-GCM";
/** 96 bits is the size AES-GCM is specified for; longer IVs get re-hashed. */
const IV_BYTES = 12;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// Backed by an explicit ArrayBuffer rather than `Uint8Array.from`, whose return
// type widens to ArrayBufferLike and no longer satisfies BufferSource under
// TypeScript 5.7's narrowed typed-array generics.
function fromB64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** True when the value looks like output of `sealWith` rather than legacy plaintext. */
export function isSealed(value: string): boolean {
  return value.startsWith(`${PREFIX}.`);
}

/** Whether this environment can encrypt at all (needs a secure context). */
export function cryptoAvailable(): boolean {
  return (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle !== "undefined"
  );
}

export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: ALGO, length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt with an explicit key. Output: `atlas1.<b64 iv>.<b64 ciphertext>`. */
export async function sealWith(key: CryptoKey, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(plain);
  const ct = await crypto.subtle.encrypt({ name: ALGO, iv }, key, data);
  return `${PREFIX}.${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

/**
 * Decrypt with an explicit key. Returns null for anything that isn't a valid,
 * authentic payload — wrong key, truncated value, tampered ciphertext. Callers
 * treat null as "discard and start clean" rather than surfacing an error, since
 * a corrupt key blob is not something the user can act on.
 */
export async function openWith(key: CryptoKey, payload: string): Promise<string | null> {
  if (!isSealed(payload)) return null;
  const parts = payload.split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = fromB64(parts[1]);
    const ct = fromB64(parts[2]);
    // GCM verifies the auth tag here; tampering throws rather than returning junk.
    const out = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ct);
    return new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

// ── Master key persistence (browser only) ───────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, k: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(k);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, k: string, v: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let masterKeyPromise: Promise<CryptoKey> | null = null;

/**
 * The per-browser master key, created on first use and reused thereafter.
 *
 * A CryptoKey is structured-cloneable, so IndexedDB can store the handle itself
 * — the raw bytes never exist in JS. Memoized because every persisted write
 * would otherwise reopen the database.
 */
export function getMasterKey(): Promise<CryptoKey> {
  if (masterKeyPromise) return masterKeyPromise;
  masterKeyPromise = (async () => {
    if (!cryptoAvailable() || typeof indexedDB === "undefined")
      throw new Error("WebCrypto or IndexedDB unavailable");
    const db = await openDb();
    try {
      const existing = await idbGet(db, RECORD);
      // A stored value from an older/failed write may not be a usable key.
      if (existing && typeof (existing as CryptoKey).algorithm === "object")
        return existing as CryptoKey;
      const key = await generateMasterKey();
      await idbPut(db, RECORD, key);
      return key;
    } finally {
      db.close();
    }
  })();
  // Don't cache a rejection: a transient IndexedDB failure shouldn't disable
  // encryption for the rest of the session.
  masterKeyPromise.catch(() => {
    masterKeyPromise = null;
  });
  return masterKeyPromise;
}

/** Encrypt with this browser's master key. */
export async function seal(plain: string): Promise<string> {
  return sealWith(await getMasterKey(), plain);
}

/** Decrypt with this browser's master key; null if unreadable. */
export async function open(payload: string): Promise<string | null> {
  return openWith(await getMasterKey(), payload);
}

/** Test seam: drop the memoized key so a fresh one is fetched. */
export function resetMasterKeyCache(): void {
  masterKeyPromise = null;
}
