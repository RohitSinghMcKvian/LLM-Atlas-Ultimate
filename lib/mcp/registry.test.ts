import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  connectorRefreshToken,
  connectorToken,
  deleteConnector,
  getConnector,
  isTokenExpired,
  listConnectors,
  listEnabledConnectors,
  resetConnectorDb,
  saveConnector,
  setConnectorEnabled,
  slugifyConnectorId,
  updateConnector,
} from "./registry";
import { resetMasterKeyCache } from "@/lib/crypto/secret-box";
import { resetIncognito, setIncognito } from "@/lib/chat/incognito";
import { namespacedToolName } from "./protocol";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetConnectorDb();
  resetMasterKeyCache();
  resetIncognito();
});
afterEach(() => resetIncognito());

const BASE = { name: "Calendar", url: "https://mcp.example.com/v1" };

function ok<T>(r: T | { error: string }): T {
  if (typeof r === "object" && r !== null && "error" in r) {
    throw new Error(`expected success, got: ${(r as { error: string }).error}`);
  }
  return r as T;
}

describe("slugifyConnectorId", () => {
  it("derives a hyphenated id from the name", () => {
    expect(slugifyConnectorId("My Calendar!", "https://x.test/")).toBe("my-calendar");
  });

  it("falls back to the hostname when the name is blank", () => {
    expect(slugifyConnectorId("  ", "https://mcp.example.com/")).toBe("mcp-example-com");
  });

  // The id becomes part of `mcp__<id>__<tool>`, where `__` is the separator.
  it("never contains the tool-name separator", () => {
    expect(slugifyConnectorId("a__b", "https://x.test/")).not.toContain("__");
  });
});

describe("saveConnector — token handling", () => {
  // The invariant this whole module exists to keep: a third-party bearer token
  // must never sit in storage as cleartext.
  it("stores the token sealed, never in plaintext", async () => {
    const saved = ok(await saveConnector({ ...BASE, token: "super-secret-token" }));
    expect(saved.sealedToken).toBeTruthy();
    expect(saved.sealedToken).toMatch(/^atlas1\./);
    // Nothing anywhere on the record contains the plaintext.
    expect(JSON.stringify(saved)).not.toContain("super-secret-token");
  });

  it("the record as it lands in IndexedDB contains no plaintext either", async () => {
    await saveConnector({ ...BASE, token: "super-secret-token" });
    const fromDb = await getConnector("calendar");
    expect(JSON.stringify(fromDb)).not.toContain("super-secret-token");
  });

  it("round-trips the token back through decryption", async () => {
    await saveConnector({ ...BASE, token: "super-secret-token" });
    expect(await connectorToken("calendar")).toBe("super-secret-token");
  });

  it("seals a refresh token the same way", async () => {
    const saved = ok(await saveConnector({ ...BASE, token: "a", refreshToken: "refresh-me" }));
    expect(saved.sealedRefreshToken).toMatch(/^atlas1\./);
    expect(JSON.stringify(saved)).not.toContain("refresh-me");
    expect(await connectorRefreshToken("calendar")).toBe("refresh-me");
  });

  it("supports a connector with no token at all", async () => {
    const saved = ok(await saveConnector(BASE));
    expect(saved.sealedToken).toBeUndefined();
    expect(await connectorToken("calendar")).toBeUndefined();
  });

  it("keeps the existing token when a save omits it", async () => {
    await saveConnector({ ...BASE, token: "keep-me" });
    await saveConnector({ ...BASE, id: "calendar", name: "Renamed" });
    expect(await connectorToken("calendar")).toBe("keep-me");
    expect((await getConnector("calendar"))?.name).toBe("Renamed");
  });

  it("replaces the token when a new one is supplied", async () => {
    await saveConnector({ ...BASE, token: "old" });
    await saveConnector({ ...BASE, id: "calendar", token: "new" });
    expect(await connectorToken("calendar")).toBe("new");
  });

  it("returns undefined rather than throwing for an undecryptable token", async () => {
    await saveConnector({ ...BASE, token: "x" });
    // Simulate a corrupted record.
    await updateConnector("calendar", {});
    const c = await getConnector("calendar");
    const db = await import("@/lib/chat/idb");
    const conn = await db.openChatDb();
    await db.put(conn, db.CONNECTORS, { ...c, sealedToken: "atlas1.GARBAGE.GARBAGE" });
    conn.close();
    expect(await connectorToken("calendar")).toBeUndefined();
  });
});

describe("saveConnector — URL guard", () => {
  // A stored connector must not be editable into pointing at a private address
  // and then relied on later.
  it.each([
    "http://mcp.example.com/",
    "https://127.0.0.1/mcp",
    "https://localhost/mcp",
    "https://10.0.0.1/mcp",
    "https://user:pw@mcp.example.com/",
    "not a url",
  ])("refuses %s", async (url) => {
    const r = await saveConnector({ ...BASE, url });
    expect(r).toHaveProperty("error");
    expect(await listConnectors()).toEqual([]);
  });

  it("normalises and stores a valid URL", async () => {
    const saved = ok(await saveConnector({ ...BASE, url: "https://mcp.example.com/v1?t=1" }));
    expect(saved.url).toBe("https://mcp.example.com/v1?t=1");
  });
});

describe("registry CRUD", () => {
  it("lists connectors sorted by name", async () => {
    await saveConnector({ name: "Zed", url: "https://z.example.com/" });
    await saveConnector({ name: "Alpha", url: "https://a.example.com/" });
    expect((await listConnectors()).map((c) => c.name)).toEqual(["Alpha", "Zed"]);
  });

  it("starts enabled and can be disabled", async () => {
    await saveConnector(BASE);
    expect((await listEnabledConnectors()).length).toBe(1);
    await setConnectorEnabled("calendar", false);
    expect((await listEnabledConnectors()).length).toBe(0);
    expect((await getConnector("calendar"))?.enabled).toBe(false);
  });

  it("preserves enabled state and approvals across a re-save", async () => {
    await saveConnector(BASE);
    const key = namespacedToolName("calendar", "create_event");
    await updateConnector("calendar", { approvals: { [key]: "always" }, enabled: false });
    await saveConnector({ ...BASE, id: "calendar", name: "Calendar v2" });
    const c = await getConnector("calendar");
    expect(c?.enabled).toBe(false);
    expect(c?.approvals).toEqual({ [key]: "always" });
  });

  // Approval rules live on the record, so deleting takes them with it —
  // reinstalling starts from `ask` rather than inheriting a stale "always".
  it("deleting removes the tokens and the approval rules together", async () => {
    await saveConnector({ ...BASE, token: "t" });
    const key = namespacedToolName("calendar", "create_event");
    await updateConnector("calendar", { approvals: { [key]: "always" } });
    await deleteConnector("calendar");
    expect(await getConnector("calendar")).toBeUndefined();
    expect(await connectorToken("calendar")).toBeUndefined();

    const again = ok(await saveConnector(BASE));
    expect(again.approvals).toEqual({});
  });

  it("updateConnector cannot set a token", async () => {
    await saveConnector(BASE);
    // The type forbids it; this asserts the runtime shape too.
    await updateConnector("calendar", { tools: [] });
    expect((await getConnector("calendar"))?.sealedToken).toBeUndefined();
  });
});

describe("registry — incognito", () => {
  it("refuses to save, toggle or delete", async () => {
    await saveConnector(BASE);
    setIncognito(true);
    expect(await saveConnector({ name: "New", url: "https://n.example.com/" })).toHaveProperty(
      "error",
    );
    await setConnectorEnabled("calendar", false);
    await deleteConnector("calendar");
    const c = await getConnector("calendar");
    expect(c?.enabled).toBe(true);
    expect(c).toBeDefined();
  });

  it("still reads, so connectors stay usable in a temporary chat", async () => {
    await saveConnector({ ...BASE, token: "t" });
    setIncognito(true);
    expect((await listEnabledConnectors()).length).toBe(1);
    expect(await connectorToken("calendar")).toBe("t");
  });
});

describe("isTokenExpired", () => {
  it("treats an absent expiry as never expiring", () => {
    expect(isTokenExpired({ expiresAt: undefined })).toBe(false);
  });

  it("reports a past expiry", () => {
    expect(isTokenExpired({ expiresAt: Date.now() - 1000 })).toBe(true);
  });

  // Skew, so a token that expires mid-request is refreshed first.
  it("expires slightly early rather than at the last moment", () => {
    expect(isTokenExpired({ expiresAt: Date.now() + 5_000 })).toBe(true);
    expect(isTokenExpired({ expiresAt: Date.now() + 120_000 })).toBe(false);
  });
});
