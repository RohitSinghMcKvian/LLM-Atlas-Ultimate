import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import { makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { MINI_MODELS } from "@/lib/graph/__fixtures__/mini-catalog";
import { executeTool, toolDefsFor, type ToolAvailability } from "./tools";
import { gatedInChat } from "@/lib/tools/policy";
import type { AtlasToolPorts } from "@/lib/tools/atlas";

/**
 * The Atlas tools, from the chat page's own seam.
 *
 * `lib/tools/atlas/*` has been unit-tested since it was written and was still
 * unreachable from `/chat`: the availability flag was never set and the ports
 * were never wired, so every call answered "unavailable this turn". Unit tests
 * on the tools could not catch that, because the gap was in the two lines that
 * connect them — which is exactly what this file covers.
 *
 * The model is not involved. What is being pinned is that the chat page's
 * availability shape offers these tools, that `executeTool` reaches them, and
 * that the ports the page supplies are the ones they read.
 */

const BASE: ToolAvailability = {
  webSearch: false,
  hasProject: false,
  memory: false,
  hasSkills: false,
  github: false,
  hasArtifact: false,
  buildMode: false,
  codeExecution: false,
  hasFoldedContext: false,
  subagents: false,
};

const names = (a: ToolAvailability) => toolDefsFor(a).map((d) => d.function.name);

beforeAll(() => installSnapshot(makeSnapshot(MINI_MODELS, { version: "atlas-e2e" })));
afterAll(() => resetSnapshot());

describe("what the chat page offers", () => {
  it("offers the Atlas tools when the toggle is on", () => {
    const offered = names({ ...BASE, atlasTools: true });
    for (const n of ["atlas_catalog", "atlas_cost", "atlas_graph", "atlas_news", "atlas_open", "atlas_prompt"]) {
      expect(offered, n).toContain(n);
    }
  });

  it("offers none of them when it is off, so the switch means something", () => {
    const offered = names({ ...BASE, atlasTools: false });
    expect(offered.filter((n) => n.startsWith("atlas_"))).toEqual([]);
    // An absent field means the same as `false`; the chat page always sets it,
    // and the sub-agent and repair call sites deliberately do not.
    expect(names(BASE).filter((n) => n.startsWith("atlas_"))).toEqual([]);
  });

  it("marks exactly the acting tools as asking first", () => {
    const offered = names({ ...BASE, atlasTools: true });
    expect(offered.filter(gatedInChat).sort()).toEqual(["atlas_open", "atlas_prompt"]);
  });
});

describe("what the chat page wires up", () => {
  it("reads the catalog through the tool rather than from recollection", async () => {
    const r = await executeTool(
      "atlas_catalog",
      JSON.stringify({ command: "get", model_ids: ["summit-pro"], max_results: 8 }),
      { atlas: {} },
    );
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("summit-pro");
  });

  it("refuses honestly when the host wired no ports at all", async () => {
    // The state `/chat` was in before this change: the tool exists, the model
    // calls it, and every answer is an apology.
    const r = await executeTool("atlas_graph", JSON.stringify({ command: "query", search_query: "x", max_results: 5 }), {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("unavailable this turn");
  });

  it("navigates through the port the page supplies", async () => {
    const navigate = vi.fn();
    const atlas: AtlasToolPorts = { navigate };
    const r = await executeTool(
      "atlas_open",
      JSON.stringify({ module: "cost", model_ids: ["summit-pro"], reason: "cheaper at volume" }),
      { atlas },
    );
    expect(navigate).toHaveBeenCalledWith("/cost?model=summit-pro");
    expect(r.isError).toBeUndefined();
  });

  it("writes to the prompt library through its port, and versions rather than overwrites", async () => {
    const saved: { id: string; body: string }[] = [];
    const atlas: AtlasToolPorts = {
      prompts: {
        list: () => saved.map((s) => ({ ...s, title: s.id, tags: [], version: 1 })),
        save: ({ id, body }) => {
          const at = saved.findIndex((s) => s.id === id);
          if (at === -1) {
            saved.push({ id, body });
            return { created: true, version: 1 };
          }
          saved[at] = { id, body };
          return { created: false, version: 2 };
        },
      },
    };
    await executeTool("atlas_prompt", JSON.stringify({ command: "save", title: "Cost check", body: "a" }), { atlas });
    expect(saved).toEqual([{ id: "cost-check", body: "a" }]);

    const second = await executeTool(
      "atlas_prompt",
      JSON.stringify({ command: "save", prompt_id: "cost-check", body: "b" }),
      { atlas },
    );
    expect(second.content).toContain("v2");
    expect(saved).toHaveLength(1);
  });

  it("rejects a malformed call as a tool error the model can recover from", async () => {
    const r = await executeTool("atlas_open", JSON.stringify({ module: "nowhere" }), { atlas: {} });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("module");
  });
});
