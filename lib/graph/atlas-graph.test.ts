import { beforeEach, describe, expect, it } from "vitest";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import { makeModel, makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { atlasGraph, resetAtlasGraph } from "./atlas-graph";
import { nodeId } from "./types";
import { graphStats } from "./types";

describe("atlasGraph", () => {
  beforeEach(() => {
    resetSnapshot();
    resetAtlasGraph();
  });

  it("builds from the live snapshot with no sources and no network", () => {
    const g = atlasGraph();
    expect(g.nodes.size).toBeGreaterThan(50);
    expect(graphStats(g).byKind.model).toBeGreaterThan(10);
  });

  it("memoises on the snapshot version — the same call returns the same object", () => {
    expect(atlasGraph()).toBe(atlasGraph());
  });

  it("rebuilds when the snapshot changes", () => {
    const first = atlasGraph();
    installSnapshot(
      makeSnapshot([makeModel({ id: "only-one", name: "Only One" })], { version: "v-swap" }),
    );
    const second = atlasGraph();
    expect(second).not.toBe(first);
    expect(second.nodes.has(nodeId("model", "only-one"))).toBe(true);
  });

  it("rebuilds when the workspace overlay changes, and not when it does not", () => {
    const workspace = {
      nodes: [
        {
          id: nodeId("conversation", "c1"),
          kind: "conversation" as const,
          label: "Chat",
          summary: "s",
          text: "t",
          props: {},
        },
      ],
      edges: [],
    };
    const a = atlasGraph({ workspace });
    const b = atlasGraph({ workspace: { ...workspace } });
    expect(b).toBe(a);
    expect(a.nodes.has(nodeId("conversation", "c1"))).toBe(true);

    const c = atlasGraph({
      workspace: { nodes: [...workspace.nodes, { ...workspace.nodes[0], id: nodeId("conversation", "c2") }], edges: [] },
    });
    expect(c).not.toBe(a);
  });

  it("attaching news links an article to the catalog model it is about", () => {
    installSnapshot(makeSnapshot([makeModel({ id: "acme-1", name: "Acme One" })], { version: "v-news" }));
    resetAtlasGraph();
    const g = atlasGraph({
      news: {
        version: "n1",
        articles: [
          {
            id: "a1",
            title: "Acme One ships",
            summary: "s",
            url: "https://x.dev/a",
            domain: "x.dev",
            host: "x.dev",
            sourceId: "s",
            sourceName: "X",
            tier: "press",
            publishedAt: "2026-06-01T00:00:00.000Z",
            firstSeenAt: "2026-06-01T00:00:00.000Z",
            topics: ["models"],
            models: ["acme-1"],
            orgs: [],
            baseScore: 1,
            verification: {
              level: "reported",
              score: 10,
              signals: [],
              corroboration: 1,
              distinctDomains: 1,
              firstParty: false,
            },
            clusterId: "c1",
            lead: true,
          },
        ],
        clusters: [],
      },
    });
    const inbound = g.in.get(nodeId("model", "acme-1")) ?? [];
    expect(inbound.some((e) => e.kind === "about" && e.from === nodeId("article", "a1"))).toBe(true);
  });
});
