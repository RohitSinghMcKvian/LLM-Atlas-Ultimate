"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

/**
 * Atlas Vault — a browser-local store for tool/agent credentials plus an audit
 * trail of every access. Values live ONLY in this browser (localStorage); in a
 * hosted deployment these would be envelope-encrypted server-side and injected
 * at call time by Atlas Router. This store is the faithful front-end of that
 * surface — see the security note in the Vault UI.
 */

export type SecretScope = "All modules" | "Flow" | "Code" | "Router" | "Chat";

export interface VaultSecret {
  id: string;
  name: string;
  /** Stored obfuscated at rest (base64) — not a security boundary, just avoids plaintext-at-a-glance. */
  value: string;
  scope: SecretScope;
  note?: string;
  createdAt: number;
  lastUsedAt?: number;
}

export type AuditAction =
  | "created"
  | "revealed"
  | "copied"
  | "removed"
  | "used"
  | "tested"
  | "updated";

export interface AuditEntry {
  id: string;
  ts: number;
  action: AuditAction;
  target: string;
}

const AUDIT_CAP = 60;

function enc(v: string): string {
  try {
    return typeof btoa === "function" ? btoa(unescape(encodeURIComponent(v))) : v;
  } catch {
    return v;
  }
}

export function decodeSecret(v: string): string {
  try {
    return typeof atob === "function" ? decodeURIComponent(escape(atob(v))) : v;
  } catch {
    return v;
  }
}

const SEED_SECRETS: VaultSecret[] = [
  {
    id: "seed-github",
    name: "GitHub PAT",
    value: enc("ghp_examicNPLACEHOLDERexampletoken0192834"),
    scope: "Code",
    note: "Used by Atlas Code to open PRs in the sandbox",
    createdAt: Date.parse("2026-06-18"),
    lastUsedAt: Date.parse("2026-06-29"),
  },
  {
    id: "seed-serp",
    name: "Search API key",
    value: enc("serp-EXAMPLE-7f2a91c4bd0e"),
    scope: "Flow",
    note: "Web-search tool node in Flow",
    createdAt: Date.parse("2026-06-22"),
  },
];

const SEED_AUDIT: AuditEntry[] = [
  {
    id: "a-seed-1",
    ts: Date.parse("2026-06-29T14:12:00"),
    action: "used",
    target: "GitHub PAT",
  },
  {
    id: "a-seed-2",
    ts: Date.parse("2026-06-22T09:03:00"),
    action: "created",
    target: "Search API key",
  },
  {
    id: "a-seed-3",
    ts: Date.parse("2026-06-18T11:40:00"),
    action: "created",
    target: "GitHub PAT",
  },
];

interface VaultState {
  secrets: VaultSecret[];
  audit: AuditEntry[];
  add: (s: { name: string; value: string; scope: SecretScope; note?: string }) => void;
  remove: (id: string) => void;
  touch: (id: string) => void;
  log: (action: AuditAction, target: string) => void;
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      secrets: SEED_SECRETS,
      audit: SEED_AUDIT,
      add: ({ name, value, scope, note }) => {
        const secret: VaultSecret = {
          id: nanoid(8),
          name: name.trim(),
          value: enc(value.trim()),
          scope,
          note: note?.trim() || undefined,
          createdAt: Date.now(),
        };
        set((s) => ({
          secrets: [secret, ...s.secrets],
          audit: pushAudit(s.audit, "created", secret.name),
        }));
      },
      remove: (id) =>
        set((s) => {
          const target = s.secrets.find((x) => x.id === id);
          return {
            secrets: s.secrets.filter((x) => x.id !== id),
            audit: target ? pushAudit(s.audit, "removed", target.name) : s.audit,
          };
        }),
      touch: (id) =>
        set((s) => {
          const target = s.secrets.find((x) => x.id === id);
          return {
            secrets: s.secrets.map((x) =>
              x.id === id ? { ...x, lastUsedAt: Date.now() } : x,
            ),
            audit: target ? pushAudit(s.audit, "used", target.name) : s.audit,
          };
        }),
      log: (action, target) =>
        set((s) => ({ audit: pushAudit(s.audit, action, target) })),
    }),
    { name: "atlas-vault" },
  ),
);

function pushAudit(
  audit: AuditEntry[],
  action: AuditAction,
  target: string,
): AuditEntry[] {
  return [
    { id: nanoid(8), ts: Date.now(), action, target },
    ...audit,
  ].slice(0, AUDIT_CAP);
}
