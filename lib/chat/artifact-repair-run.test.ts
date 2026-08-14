import { describe, it, expect, vi } from "vitest";
import { runArtifactRepair, type RepairPorts, type RepairTurnOutcome } from "./artifact-repair-run";
import { repairLimitsFor, type RepairLimits } from "./artifact-repair";
import { triageArtifactErrors, type VerifyResult } from "./artifact-verify";

/**
 * The repair driver.
 *
 * These tests are the answer to "can this ever spend money it should not".
 * Every case counts `repairTurn` calls, because that count is the bill.
 */
const limits = (o: Partial<RepairLimits> = {}): RepairLimits =>
  repairLimitsFor(false, { maxUsd: 1, ...o });

const verified = (messages: string[]): VerifyResult => ({
  ...triageArtifactErrors(messages.map((m) => ({ kind: "error", message: m }))),
  ran: true,
  elapsedMs: 5,
});

const CLEAN = verified([]);
const BROKEN = verified(["TypeError: boom is not a function"]);
const OTHER = verified(["TypeError: other is not a function"]);
const HOST = verified(["Cannot resolve module 'framer-motion'"]);

const ok = (patch: Partial<RepairTurnOutcome> = {}): RepairTurnOutcome => ({
  artifactChanged: true,
  spentUsd: 0.01,
  ...patch,
});

/** Verify returns each scripted result in turn, repeating the last one. */
function scripted(results: (VerifyResult | null)[]) {
  let i = 0;
  return vi.fn(async () => results[Math.min(i++, results.length - 1)]);
}

const run = (ports: Partial<RepairPorts>, l = limits()) =>
  runArtifactRepair("App.jsx", l, {
    verify: scripted([CLEAN]),
    repairTurn: vi.fn(async () => ok()),
    ...ports,
  });

describe("runArtifactRepair", () => {
  it("spends nothing when the artifact is clean", async () => {
    const repairTurn = vi.fn(async () => ok());
    const verify = scripted([CLEAN]);
    const { state } = await run({ verify, repairTurn });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(repairTurn).not.toHaveBeenCalled();
    expect(state.status).toBe("clean");
  });

  it("fixes a broken artifact in one attempt", async () => {
    const repairTurn = vi.fn(async () => ok());
    const { state } = await run({ verify: scripted([BROKEN, CLEAN]), repairTurn });
    expect(repairTurn).toHaveBeenCalledTimes(1);
    expect(state.status).toBe("clean");
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0].fatalBefore).toBe(1);
    expect(state.attempts[0].fatalAfter).toBe(0);
  });

  it("spends nothing on a host fault", async () => {
    // The whole reason the `host` class exists.
    const repairTurn = vi.fn(async () => ok());
    const { state } = await run({ verify: scripted([HOST]), repairTurn });
    expect(repairTurn).not.toHaveBeenCalled();
    expect(state.gaveUpBecause).toBe("unfixable");
    expect(state.surviving).toHaveLength(1);
  });

  it("stops after one attempt when the same failure comes back", async () => {
    const repairTurn = vi.fn(async () => ok());
    const { state } = await run(
      { verify: scripted([BROKEN, BROKEN]), repairTurn },
      limits({ maxAttempts: 5 }),
    );
    expect(repairTurn).toHaveBeenCalledTimes(1);
    expect(state.gaveUpBecause).toBe("repeat");
  });

  it("escalates to a second strategy when the failure changes", async () => {
    const repairTurn =
      vi.fn<(instruction: string, strategy: string) => Promise<RepairTurnOutcome>>(async () => ok());
    const { state } = await run(
      { verify: scripted([BROKEN, OTHER, CLEAN]), repairTurn },
      limits({ maxAttempts: 2 }),
    );
    expect(repairTurn).toHaveBeenCalledTimes(2);
    expect(repairTurn.mock.calls[0][1]).toBe("minimal_fix");
    expect(repairTurn.mock.calls[1][1]).toBe("isolate");
    expect(state.status).toBe("clean");
  });

  it("stops at the attempt cap even while the failure keeps changing", async () => {
    const repairTurn = vi.fn(async () => ok());
    const { state } = await run(
      { verify: scripted([BROKEN, OTHER, verified(["TypeError: third is not a function"])]), repairTurn },
      limits({ maxAttempts: 1 }),
    );
    expect(repairTurn).toHaveBeenCalledTimes(1);
    expect(state.gaveUpBecause).toBe("attempts");
  });

  it("spends nothing when the cap is zero but still reports", async () => {
    const repairTurn = vi.fn(async () => ok());
    const { state, verified: v } = await run(
      { verify: scripted([BROKEN]), repairTurn },
      limits({ maxAttempts: 0 }),
    );
    expect(repairTurn).not.toHaveBeenCalled();
    expect(state.surviving).toHaveLength(1);
    expect(v?.fatal).toHaveLength(1);
  });

  it("stops when the repair changed nothing", async () => {
    // The common barren case: the model replies with an apology and no fence.
    const repairTurn = vi.fn(async () => ok({ artifactChanged: false }));
    const verify = scripted([BROKEN, BROKEN]);
    const { state } = await run({ verify, repairTurn }, limits({ maxAttempts: 5 }));
    expect(state.gaveUpBecause).toBe("no-progress");
    // Re-verifying an unchanged document would return the identical errors.
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("treats a thrown repair turn as a failed attempt, not a crashed run", async () => {
    const repairTurn = vi.fn(async () => {
      throw new Error("network died");
    });
    const { state } = await run({ verify: scripted([BROKEN]), repairTurn });
    expect(state.status).toBe("gave_up");
    expect(state.gaveUpBecause).toBe("errored");
  });

  it("treats a reported turn error the same way", async () => {
    const repairTurn = vi.fn(async () => ok({ errored: true }));
    const { state } = await run({ verify: scripted([BROKEN]), repairTurn });
    expect(state.gaveUpBecause).toBe("errored");
  });

  it("stops at the spend ceiling across attempts", async () => {
    const repairTurn = vi.fn(async () => ok({ spentUsd: 0.9 }));
    const { state } = await run(
      { verify: scripted([BROKEN, OTHER, CLEAN]), repairTurn },
      limits({ maxAttempts: 5, maxUsd: 0.5 }),
    );
    expect(repairTurn).toHaveBeenCalledTimes(1);
    expect(state.gaveUpBecause).toBe("budget");
    expect(state.spentUsd).toBeCloseTo(0.9);
  });

  it("does not verify at all when already stopped", async () => {
    const verify = scripted([CLEAN]);
    const { state } = await run({ verify, shouldStop: () => true });
    expect(verify).not.toHaveBeenCalled();
    expect(state.gaveUpBecause).toBe("aborted");
  });

  it("abandons between attempts when the guard flips", async () => {
    // The user sent a new message, regenerated, or switched conversation.
    let stop = false;
    const repairTurn = vi.fn(async () => {
      stop = true;
      return ok();
    });
    const { state } = await run(
      { verify: scripted([BROKEN, OTHER]), repairTurn, shouldStop: () => stop },
      limits({ maxAttempts: 5 }),
    );
    expect(repairTurn).toHaveBeenCalledTimes(1);
    expect(state.gaveUpBecause).toBe("aborted");
  });

  it("reports nothing when there is nothing executable to verify", async () => {
    const repairTurn = vi.fn(async () => ok());
    const { state, verified: v } = await run({ verify: scripted([null]), repairTurn });
    expect(repairTurn).not.toHaveBeenCalled();
    expect(state.status).toBe("clean");
    expect(v).toBeNull();
  });

  it("emits state so the UI can follow along", async () => {
    const seen: string[] = [];
    await run({
      verify: scripted([BROKEN, CLEAN]),
      repairTurn: vi.fn(async () => ok()),
      onState: (s) => seen.push(s.status),
    });
    expect(seen[0]).toBe("verifying");
    expect(seen).toContain("repairing");
    expect(seen[seen.length - 1]).toBe("clean");
  });

  it("surfaces host errors, not fatal ones, when it gives up as unfixable", async () => {
    const { state } = await run({ verify: scripted([HOST]) });
    expect(state.surviving[0]).toContain("framer-motion");
  });
});
