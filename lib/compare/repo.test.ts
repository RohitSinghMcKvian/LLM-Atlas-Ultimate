import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  SESSION_RETENTION_MS,
  compareRepo,
  ephemeralCompareRepo,
  resetCompareRepo,
  type CompareRepo,
} from "./repo";
import { newSession, type CompareSession } from "./session";
import { emptyStages, type CompareRun, type LaneState } from "./types";

const lane = (id: string, band: LaneState["band"], over: Partial<LaneState> = {}): LaneState => ({
  id,
  modelId: id,
  band,
  fit: "stuff",
  maxTokens: 1_000,
  budgetUsd: 0.1,
  status: "queued",
  text: "",
  reasoning: "",
  meters: {},
  ...over,
});

const run = (id: string, sessionId: string, turnIndex: number, over: Partial<CompareRun> = {}): CompareRun => ({
  id,
  createdAt: 1_000,
  updatedAt: 1_000,
  sessionId,
  turnIndex,
  config: { question: "why?", modelIds: ["a", "b"], depth: "standard" },
  stages: emptyStages(),
  lanes: [lane("a", 0), lane("b", 1)],
  ...over,
});

function session(over: Partial<CompareSession> = {}): CompareSession {
  return {
    ...newSession({ question: "why?", modelIds: ["a", "b"], depth: "standard", now: 1_000 }),
    ...over,
  };
}

let repo: CompareRepo;

beforeEach(() => {
  // A fresh factory per test: the store is global and a leaked session would
  // make the ordering and pruning assertions depend on test order.
  globalThis.indexedDB = new IDBFactory();
  resetCompareRepo();
  repo = compareRepo();
});

describe("sessions", () => {
  it("round-trips a session with its turns and lanes", async () => {
    const s = session();
    await repo.saveSession({ ...s, turnIds: ["r1"] });
    await repo.saveRun(run("r1", s.id, 0));

    const loaded = await repo.loadSession(s.id);
    expect(loaded?.session.title).toBe("why?");
    expect(loaded?.runs).toHaveLength(1);
    expect(loaded?.runs[0].lanes.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("returns undefined for a session that was never written", async () => {
    expect(await repo.loadSession("nope")).toBeUndefined();
  });

  it("finds a session's turns through the index, not by scanning", async () => {
    const a = session();
    const b = session();
    await repo.saveSession(a);
    await repo.saveSession(b);
    await repo.saveRun(run("r1", a.id, 0));
    await repo.saveRun(run("r2", b.id, 0));

    expect((await repo.loadSession(a.id))?.runs.map((r) => r.id)).toEqual(["r1"]);
    expect((await repo.loadSession(b.id))?.runs.map((r) => r.id)).toEqual(["r2"]);
  });

  it("lists pinned sessions first, then most recent", async () => {
    await repo.saveSession(session({ title: "old", updatedAt: 1 }));
    await repo.saveSession(session({ title: "new", updatedAt: 9 }));
    await repo.saveSession(session({ title: "pinned", updatedAt: 2, pinned: true }));
    expect((await repo.listSessions()).map((s) => s.title)).toEqual(["pinned", "new", "old"]);
  });

  it("honours the list cap", async () => {
    for (let i = 0; i < 5; i++) await repo.saveSession(session({ updatedAt: i }));
    expect(await repo.listSessions(2)).toHaveLength(2);
  });
});

describe("deleteSession", () => {
  it("takes the session's runs and their lanes with it", async () => {
    const keep = session();
    const drop = session();
    await repo.saveSession(keep);
    await repo.saveSession(drop);
    await repo.saveRun(run("r1", drop.id, 0));
    await repo.saveRun(run("r2", keep.id, 0));

    await repo.deleteSession(drop.id);

    expect(await repo.loadSession(drop.id)).toBeUndefined();
    // The run is gone, not merely orphaned — an orphan would leak the answers.
    expect(await repo.loadRun("r1")).toBeUndefined();
    expect((await repo.loadSession(keep.id))?.runs).toHaveLength(1);
  });
});

describe("lane checkpointing", () => {
  it("writes one lane without disturbing the others", async () => {
    const s = session();
    await repo.saveRun(run("r1", s.id, 0));
    await repo.saveLane("r1", lane("a", 0, { status: "streaming", text: "half an answer" }));

    const back = await repo.loadRun("r1");
    expect(back?.lanes.find((l) => l.id === "a")?.text).toBe("half an answer");
    expect(back?.lanes.find((l) => l.id === "b")?.text).toBe("");
  });

  it("restores lanes in band order, not IndexedDB key order", async () => {
    // Keys sort lexicographically, so a run whose bands run z,a would come back
    // reversed and every lane would change colour on reload.
    const s = session();
    await repo.saveRun(run("r1", s.id, 0, { lanes: [lane("zebra", 0), lane("alpha", 1)] }));
    expect((await repo.loadRun("r1"))?.lanes.map((l) => l.id)).toEqual(["zebra", "alpha"]);
  });

  it("does not leak the storage foreign key back into the run", async () => {
    await repo.saveRun(run("r1", session().id, 0));
    expect((await repo.loadRun("r1"))?.lanes[0]).not.toHaveProperty("runId");
  });

  it("keeps runs apart even when they share model ids", async () => {
    const s = session();
    await repo.saveRun(run("r1", s.id, 0));
    await repo.saveRun(run("r2", s.id, 1));
    await repo.saveLane("r1", lane("a", 0, { text: "first turn" }));
    expect((await repo.loadRun("r1"))?.lanes[0].text).toBe("first turn");
    expect((await repo.loadRun("r2"))?.lanes[0].text).toBe("");
  });

  it("tolerates an empty batch", async () => {
    await expect(repo.saveLanes("r1", [])).resolves.toBeUndefined();
  });

  it("updates the header without rewriting lane text", async () => {
    const s = session();
    await repo.saveRun(run("r1", s.id, 0));
    await repo.saveLane("r1", lane("a", 0, { text: "streamed" }));
    const stages = emptyStages();
    stages.lanes = { status: "done" };
    await repo.saveRunHeader({ ...run("r1", s.id, 0), stages, lanes: [] });

    const back = await repo.loadRun("r1");
    expect(back?.stages.lanes.status).toBe("done");
    expect(back?.lanes.find((l) => l.id === "a")?.text).toBe("streamed");
  });

  it("fills in stages missing from an older record", async () => {
    const s = session();
    await repo.saveRun(run("r1", s.id, 0));
    const partial = { ...run("r1", s.id, 0), stages: { brief: { status: "done" } } } as unknown as CompareRun;
    await repo.saveRunHeader(partial);
    const back = await repo.loadRun("r1");
    // A missing stage must read as pending so resume re-runs it.
    expect(back?.stages.synthesis.status).toBe("pending");
    expect(back?.stages.brief.status).toBe("done");
  });
});

describe("pruneSessions", () => {
  it("drops sessions past the retention window and keeps the rest", async () => {
    const now = 10 * SESSION_RETENTION_MS;
    await repo.saveSession(session({ updatedAt: now - SESSION_RETENTION_MS - 1 }));
    await repo.saveSession(session({ updatedAt: now - 1_000 }));
    expect(await repo.pruneSessions(SESSION_RETENTION_MS, now)).toBe(1);
    expect(await repo.listSessions()).toHaveLength(1);
  });

  it("never expires a pinned session", async () => {
    // Pinning is the user saying this one matters; expiring it makes the pin a lie.
    const now = 10 * SESSION_RETENTION_MS;
    await repo.saveSession(session({ updatedAt: 0, pinned: true }));
    expect(await repo.pruneSessions(SESSION_RETENTION_MS, now)).toBe(0);
  });

  it("takes a pruned session's runs with it", async () => {
    const now = 10 * SESSION_RETENTION_MS;
    const stale = session({ updatedAt: 0 });
    await repo.saveSession(stale);
    await repo.saveRun(run("r1", stale.id, 0));
    await repo.pruneSessions(SESSION_RETENTION_MS, now);
    expect(await repo.loadRun("r1")).toBeUndefined();
  });
});

describe("ephemeralCompareRepo", () => {
  it("drops every write", async () => {
    const temp = compareRepo(true);
    const s = session();
    await temp.saveSession(s);
    await temp.saveRun(run("r1", s.id, 0));
    await temp.saveLane("r1", lane("a", 0, { text: "secret" }));
    await temp.saveLanes("r1", [lane("b", 1, { text: "also secret" })]);
    await temp.saveRunHeader(run("r1", s.id, 0));

    // Read through the *saving* repo: nothing reached storage at all.
    expect(await repo.listSessions()).toEqual([]);
    expect(await repo.loadRun("r1")).toBeUndefined();
  });

  it("passes reads through — a temporary session hides nothing already saved", async () => {
    const s = session();
    await repo.saveSession(s);
    await repo.saveRun(run("r1", s.id, 0));

    const temp = compareRepo(true);
    expect(await temp.listSessions()).toHaveLength(1);
    expect((await temp.loadSession(s.id))?.runs).toHaveLength(1);
    expect(await temp.loadRun("r1")).toBeTruthy();
  });

  it("blocks deletes too", async () => {
    // A delete is a durable mutation of saved data, and a bug that erased
    // history because temporary mode relaxed the rule is unrecoverable.
    const s = session();
    await repo.saveSession(s);
    await repo.saveRun(run("r1", s.id, 0));

    const temp = compareRepo(true);
    await temp.deleteSession(s.id);
    await temp.deleteRun("r1");

    expect(await repo.loadSession(s.id)).toBeTruthy();
    expect(await repo.loadRun("r1")).toBeTruthy();
  });

  it("prunes nothing", async () => {
    expect(await compareRepo(true).pruneSessions(0, Date.now())).toBe(0);
  });

  it("covers every method on the interface", () => {
    // The point of the seam: a write method added to `CompareRepo` and forgotten
    // here is a *type error*, not a silent leak. This asserts the runtime half —
    // that the literal is complete — which typecheck alone cannot show.
    const wrapped = ephemeralCompareRepo(repo) as unknown as Record<string, unknown>;
    for (const key of Object.keys(repo as unknown as Record<string, unknown>)) {
      expect(typeof wrapped[key]).toBe("function");
    }
  });
});
