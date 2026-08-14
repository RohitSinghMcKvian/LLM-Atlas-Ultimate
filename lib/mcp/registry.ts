"use client";

import { CONNECTORS, del, get, getAll, idbAvailable, openChatDb, put } from "@/lib/chat/idb";
import { isIncognito } from "@/lib/chat/incognito";
import { open as openSealed, seal } from "@/lib/crypto/secret-box";
import type { McpTool } from "./protocol";
import { guardConnectorUrl } from "./url-guard";
import type { ApprovalPolicy } from "./approval";

/**
 * Installed MCP connectors (spec §4, Connectors).
 *
 * The security-relevant part is the token. A connector's OAuth access token is a
 * bearer credential for a third-party account, so it gets the same treatment as
 * the BYOK provider key from P0: sealed with `lib/crypto/secret-box.ts` — AES-GCM
 * under a non-extractable key in IndexedDB — and never written in cleartext.
 *
 * `Connector` therefore has no plaintext token field at all. It is not that the
 * field is "usually" sealed; there is nowhere for a plaintext token to live. The
 * only way to obtain one is `connectorToken()`, which decrypts on demand, and the
 * only place it goes from there is the outbound `x-connector-token` header.
 */

export interface Connector {
  id: string;
  name: string;
  /** Endpoint. Always re-validated on save; a stored URL is not trusted. */
  url: string;
  enabled: boolean;
  /** Sealed access token (`atlas1.…`), or undefined when the server is open. */
  sealedToken?: string;
  sealedRefreshToken?: string;
  /** Epoch ms. Undefined for tokens that do not expire. */
  expiresAt?: number;
  /** OAuth client id, when the connector was authorised. Not a secret. */
  clientId?: string;
  /** Tools as last discovered. Cached so the index does not need a round trip. */
  tools: McpTool[];
  /** Protocol version the server negotiated at `initialize`. */
  protocolVersion?: string;
  /** Session id issued by the server, if any. Not durable across restarts. */
  sessionId?: string;
  /** Per-tool approval rules for this connector. */
  approvals: ApprovalPolicy;
  addedAt: number;
  updatedAt: number;
  /** Last connection failure, shown in the UI. Never contains the token. */
  lastError?: string;
}

/** What a connector looks like to the rest of the app: no credential material. */
export type ConnectorSummary = Omit<Connector, "sealedToken" | "sealedRefreshToken">;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openChatDb().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** Test seam: drop the memoized connection. */
export function resetConnectorDb(): void {
  dbPromise = null;
}

async function ready(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  try {
    return await db();
  } catch {
    return null;
  }
}

export function slugifyConnectorId(name: string, url: string): string {
  const base = name.trim() || new URL(url).hostname;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // The id becomes part of the namespaced tool name, where `__` is the
  // separator — a hyphen-only slug can never collide with it.
  return slug || "connector";
}

export async function listConnectors(): Promise<Connector[]> {
  const d = await ready();
  if (!d) return [];
  try {
    return (await getAll<Connector>(d, CONNECTORS)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return [];
  }
}

export async function listEnabledConnectors(): Promise<Connector[]> {
  return (await listConnectors()).filter((c) => c.enabled);
}

export async function getConnector(id: string): Promise<Connector | undefined> {
  const d = await ready();
  if (!d) return undefined;
  try {
    return await get<Connector>(d, CONNECTORS, id);
  } catch {
    return undefined;
  }
}

export interface SaveConnectorInput {
  id?: string;
  name: string;
  url: string;
  /** Plaintext token from the OAuth exchange or a manual paste. Sealed here. */
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
}

/**
 * Add or update a connector, sealing any token on the way in.
 *
 * The URL is re-validated on every save with the same guard the proxy uses, so a
 * stored connector cannot be edited into pointing at a private address and then
 * relied upon later.
 */
export async function saveConnector(
  input: SaveConnectorInput,
): Promise<Connector | { error: string }> {
  if (isIncognito()) return { error: "Connectors cannot be changed in a temporary chat." };

  const guard = guardConnectorUrl(input.url.trim());
  if (!guard.ok || !guard.url) return { error: guard.reason ?? "Invalid connector URL." };

  const d = await ready();
  if (!d) return { error: "Local storage is unavailable, so the connector could not be saved." };

  const id = input.id ?? slugifyConnectorId(input.name, guard.url.toString());
  const existing = await get<Connector>(d, CONNECTORS, id);
  const now = Date.now();

  let sealedToken = existing?.sealedToken;
  let sealedRefreshToken = existing?.sealedRefreshToken;
  if (input.token !== undefined) {
    // Sealing can fail (no WebCrypto, storage denied). Fail the save rather than
    // fall back to plaintext — same fail-closed rule as the BYOK vault.
    const sealedValue = await seal(input.token).catch(() => null);
    if (sealedValue === null) {
      return { error: "Could not encrypt the connector token, so it was not saved." };
    }
    sealedToken = sealedValue;
  }
  if (input.refreshToken !== undefined) {
    const sealedValue = await seal(input.refreshToken).catch(() => null);
    if (sealedValue === null) {
      return { error: "Could not encrypt the refresh token, so it was not saved." };
    }
    sealedRefreshToken = sealedValue;
  }

  const connector: Connector = {
    id,
    name: input.name.trim() || guard.url.hostname,
    url: guard.url.toString(),
    enabled: existing?.enabled ?? true,
    sealedToken,
    sealedRefreshToken,
    expiresAt: input.expiresAt ?? existing?.expiresAt,
    clientId: input.clientId ?? existing?.clientId,
    tools: existing?.tools ?? [],
    protocolVersion: existing?.protocolVersion,
    sessionId: existing?.sessionId,
    approvals: existing?.approvals ?? {},
    addedAt: existing?.addedAt ?? now,
    updatedAt: now,
    lastError: existing?.lastError,
  };
  await put(d, CONNECTORS, connector);
  return connector;
}

/**
 * Decrypt a connector's access token.
 *
 * The only path from sealed storage to a usable credential. Returns undefined
 * rather than throwing when the token is missing or undecryptable, so a corrupted
 * record degrades to "unauthenticated connector" instead of breaking the turn.
 */
export async function connectorToken(id: string): Promise<string | undefined> {
  const c = await getConnector(id);
  if (!c?.sealedToken) return undefined;
  try {
    return (await openSealed(c.sealedToken)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function connectorRefreshToken(id: string): Promise<string | undefined> {
  const c = await getConnector(id);
  if (!c?.sealedRefreshToken) return undefined;
  try {
    return (await openSealed(c.sealedRefreshToken)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Patch the non-secret parts of a connector. Cannot set a token. */
export async function updateConnector(
  id: string,
  patch: Partial<Omit<Connector, "id" | "sealedToken" | "sealedRefreshToken">>,
): Promise<void> {
  if (isIncognito()) return;
  const d = await ready();
  if (!d) return;
  const existing = await get<Connector>(d, CONNECTORS, id);
  if (!existing) return;
  await put(d, CONNECTORS, { ...existing, ...patch, updatedAt: Date.now() });
}

export async function setConnectorEnabled(id: string, enabled: boolean): Promise<void> {
  return updateConnector(id, { enabled });
}

/**
 * Remove a connector and everything derived from it.
 *
 * Deletes the record outright, which takes the sealed tokens with it. Approval
 * rules live on the record, so they go too — reinstalling the same connector
 * starts from `ask` rather than inheriting a stale "always allow".
 */
export async function deleteConnector(id: string): Promise<void> {
  if (isIncognito()) return;
  const d = await ready();
  if (!d) return;
  await del(d, CONNECTORS, id);
}

/** True once the recorded expiry has passed. Undefined expiry never expires. */
export function isTokenExpired(c: Pick<Connector, "expiresAt">, now = Date.now()): boolean {
  // A small skew so a token about to expire mid-request is refreshed first.
  const SKEW_MS = 30_000;
  return c.expiresAt !== undefined && c.expiresAt - SKEW_MS <= now;
}
