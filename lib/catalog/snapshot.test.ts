import { describe, it, expect, beforeEach } from "vitest";
import { makeSnapshot, syntheticSnapshot } from "./__fixtures__/snapshots";
import { BASELINE_SNAPSHOT } from "./baseline";
import {
  EMPTY_SNAPSHOT,
  activeSnapshot,
  installSnapshot,
  resetSnapshot,
  subscribeSnapshot,
  toWireSnapshot,
} from "./snapshot";

// The pointer is read synchronously by ~30 call sites, several of them mid-render.
// Idempotence and monotonicity are what make that safe: a duplicate install must
// not notify (or React StrictMode's double render would re-render every catalog
// consumer), and a late-arriving older snapshot must not clobber a newer one.

describe("installSnapshot", () => {
  beforeEach(() => {
    resetSnapshot();
  });

  it("starts at the empty sentinel", () => {
    expect(activeSnapshot()).toBe(EMPTY_SNAPSHOT);
  });

  it("installs a snapshot and reports the move", () => {
    const s = syntheticSnapshot(10);
    expect(installSnapshot(s)).toBe(true);
    expect(activeSnapshot()).toBe(s);
  });

  it("is idempotent for the same object", () => {
    const s = syntheticSnapshot(10);
    installSnapshot(s);
    expect(installSnapshot(s)).toBe(false);
  });

  it("is idempotent for a different object with the same version", () => {
    const models = syntheticSnapshot(10).models;
    const a = makeSnapshot(models, { version: "same" });
    const b = makeSnapshot(models, { version: "same" });
    installSnapshot(a);
    expect(installSnapshot(b)).toBe(false);
    expect(activeSnapshot()).toBe(a);
  });

  it("ignores null and undefined", () => {
    expect(installSnapshot(null)).toBe(false);
    expect(installSnapshot(undefined)).toBe(false);
    expect(activeSnapshot()).toBe(EMPTY_SNAPSHOT);
  });

  it("refuses to go backwards in time", () => {
    const newer = makeSnapshot(syntheticSnapshot(4).models, {
      version: "newer",
      syncedAt: "2026-07-20T00:00:00.000Z",
    });
    const older = makeSnapshot(syntheticSnapshot(4).models, {
      version: "older",
      syncedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(installSnapshot(newer)).toBe(true);
    expect(installSnapshot(older)).toBe(false);
    expect(activeSnapshot()).toBe(newer);
  });

  it("accepts anything on top of the sentinel, however old", () => {
    expect(installSnapshot(BASELINE_SNAPSHOT)).toBe(true);
    expect(activeSnapshot()).toBe(BASELINE_SNAPSHOT);
  });

  it("notifies subscribers once per real change", () => {
    let calls = 0;
    const unsubscribe = subscribeSnapshot(() => {
      calls++;
    });

    const s = syntheticSnapshot(6);
    installSnapshot(s);
    installSnapshot(s); // idempotent — must not notify
    expect(calls).toBe(1);

    unsubscribe();
    resetSnapshot();
    installSnapshot(syntheticSnapshot(7));
    expect(calls).toBe(1);
  });
});

describe("toWireSnapshot", () => {
  it("drops server-only bookkeeping", () => {
    const wire = toWireSnapshot({
      ...syntheticSnapshot(3),
      // Fields only present on CatalogSnapshotRecord.
      sources: { openrouter: { status: "ok", count: 3 } },
      firstSeen: { "synth-0": "2026-07-01" },
      missCount: { "synth-1": 1 },
      tombstones: [
        { id: "gone", name: "Gone", reason: "delisted", lastSeenAt: "2026-07-01" },
      ],
    } as Parameters<typeof toWireSnapshot>[0]);

    expect(Object.keys(wire).sort()).toEqual(
      ["aliases", "diff", "models", "origin", "stats", "syncedAt", "version", "warnings"].sort(),
    );
  });
});

describe("BASELINE_SNAPSHOT", () => {
  it("describes the bundled catalog", () => {
    expect(BASELINE_SNAPSHOT.origin).toBe("baseline");
    expect(BASELINE_SNAPSHOT.models.length).toBeGreaterThan(0);
    expect(BASELINE_SNAPSHOT.stats.models).toBe(BASELINE_SNAPSHOT.models.length);
    expect(BASELINE_SNAPSHOT.warnings).toEqual([]);
  });

  it("has no duplicate model ids", () => {
    const ids = BASELINE_SNAPSHOT.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is older than any synced snapshot, so a sync always wins", () => {
    expect(BASELINE_SNAPSHOT.syncedAt < new Date().toISOString()).toBe(true);
  });
});
