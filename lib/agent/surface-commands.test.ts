import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import { makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { MINI_MODELS } from "@/lib/graph/__fixtures__/mini-catalog";
import { commandFor, resolveCommand, sortKeyForSpoken } from "./surface-commands";
import { parseIntent } from "@/lib/voice/intent";

/**
 * Where a spoken command goes.
 *
 * The property under test throughout: a command the current page cannot carry
 * out is *routed*, not refused. Refusing would make voice control feel like a
 * guessing game about which page is listening.
 */

beforeAll(() => installSnapshot(makeSnapshot(MINI_MODELS, { version: "surface-cmd" })));
afterAll(() => resetSnapshot());

const MODELS = MINI_MODELS.map((m) => ({ id: m.id, name: m.name }));
const LEADERBOARD = { moduleId: "leaderboard", accepts: ["filter" as const] };
const COMPARE = { moduleId: "compare", accepts: ["select" as const, "filter" as const] };

describe("commandFor", () => {
  it("carries a selection across unchanged", () => {
    const intent = parseIntent(`compare ${MODELS[0].name} and ${MODELS[1].name}`, { models: MODELS });
    expect(commandFor(intent)).toEqual({
      kind: "select",
      op: "set",
      modelIds: [MODELS[0].id, MODELS[1].id],
    });
  });

  it("carries a filter across unchanged", () => {
    expect(commandFor(parseIntent("show only free models", {}))).toEqual({
      kind: "filter",
      access: "free",
    });
  });

  it("is null for anything that is not a surface command", () => {
    expect(commandFor(parseIntent("what does this cost", {}))).toBeNull();
    expect(commandFor(parseIntent("open compare", {}))).toBeNull();
    expect(commandFor(parseIntent("stop", {}))).toBeNull();
  });
});

describe("resolveCommand", () => {
  it("hands a command to a surface that accepts it", () => {
    const r = resolveCommand(parseIntent("show only free models", {}), LEADERBOARD);
    expect(r).toMatchObject({ kind: "surface", command: { kind: "filter", access: "free" } });
  });

  it("routes to the module whose job it is when the current one cannot", () => {
    // Said on the Leaderboard, which has no selection to set.
    const intent = parseIntent(`compare ${MODELS[0].name} and ${MODELS[1].name}`, { models: MODELS });
    const r = resolveCommand(intent, LEADERBOARD);
    expect(r).toMatchObject({ kind: "navigate" });
    expect(r && r.kind === "navigate" && r.href).toBe(
      `/compare?models=${MODELS[0].id}%2C${MODELS[1].id}`,
    );
  });

  it("routes a filter to the leaderboard from a surface that cannot filter", () => {
    const r = resolveCommand(parseIntent("show only free models", {}), {
      moduleId: "news",
      accepts: [],
    });
    expect(r).toMatchObject({ kind: "navigate", href: "/leaderboard?access=free" });
  });

  it("routes from no surface at all", () => {
    const r = resolveCommand(parseIntent("show only free models", {}), null);
    expect(r).toMatchObject({ kind: "navigate" });
  });

  it("refuses to navigate somewhere to clear a selection that is not there", () => {
    const r = resolveCommand(parseIntent("clear the selection", { models: MODELS }), LEADERBOARD);
    expect(r).toMatchObject({ kind: "unsupported" });
  });

  it("clears in place on a surface that has a selection", () => {
    const r = resolveCommand(parseIntent("clear the selection", { models: MODELS }), COMPARE);
    expect(r).toMatchObject({ kind: "surface", command: { op: "clear" } });
  });

  it("is null for an intent that is not a surface command at all", () => {
    expect(resolveCommand(parseIntent("open cost", {}), COMPARE)).toBeNull();
  });

  it("reports the catalog's own refusal rather than inventing a URL", () => {
    const r = resolveCommand(
      { kind: "select", op: "set", modelIds: ["not-a-real-model"] },
      LEADERBOARD,
    );
    expect(r).toMatchObject({ kind: "unsupported" });
    expect(r && r.kind === "unsupported" && r.message).toContain("not-a-real-model");
  });
});

describe("sortKeyForSpoken", () => {
  // Two vocabularies that cannot be changed to suit each other: nobody says
  // "arena" or "release", and the component has never heard of "speed".
  it("translates the words people say into the component's enum", () => {
    expect(sortKeyForSpoken("speed")).toBe("arena");
    expect(sortKeyForSpoken("recency")).toBe("release");
    expect(sortKeyForSpoken("price")).toBe("price");
    expect(sortKeyForSpoken("intelligence")).toBe("intelligence");
    expect(sortKeyForSpoken("context")).toBe("context");
  });

  it("maps nothing rather than guessing", () => {
    expect(sortKeyForSpoken("vibes")).toBeNull();
    expect(sortKeyForSpoken(undefined)).toBeNull();
  });

  it("covers every sort the parser can produce", () => {
    // If `intent.ts` learns a new sort word, this fails until the surface can
    // carry it out — rather than the agent silently reporting success.
    for (const spoken of ["price", "intelligence", "speed", "context", "recency"]) {
      expect(sortKeyForSpoken(spoken), spoken).not.toBeNull();
    }
  });
});
