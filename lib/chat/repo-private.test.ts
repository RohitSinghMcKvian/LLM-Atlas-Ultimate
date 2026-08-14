import { describe, it, expect, beforeEach, vi } from "vitest";
import { readOnlyRepo } from "./repo-private";
import {
  isIncognito,
  setIncognito,
  subscribeIncognito,
  resetIncognito,
} from "./incognito";
import type { ChatRepo } from "./repo";
import type { ChatMessage } from "./types";

// The P4 acceptance criterion is "incognito writes nothing". These tests aim at
// exactly that: the wrapper must swallow every mutating method on the interface,
// and must keep reads working so existing history stays browsable.

function msg(id: string): ChatMessage {
  return { id, role: "user", content: "hi", parentId: null, createdAt: 1 };
}

/** A repo that records every call, so "wrote nothing" is checkable. */
function spyRepo() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push(name);
      void args;
      return undefined as never;
    };
  const repo: ChatRepo = {
    remote: true,
    listConversations: vi.fn(async () => {
      calls.push("listConversations");
      return [
        {
          id: "c1",
          title: "saved chat",
          createdAt: 1,
          updatedAt: 2,
        },
      ];
    }),
    listMessages: vi.fn(async (id: string) => {
      calls.push("listMessages");
      return [msg(`${id}-m1`)];
    }),
    createConversation: record("createConversation"),
    updateConversation: record("updateConversation"),
    deleteConversation: record("deleteConversation"),
    addMessage: record("addMessage"),
    updateMessage: record("updateMessage"),
    updateMessages: record("updateMessages"),
  };
  return { repo, calls };
}

const WRITES = [
  "createConversation",
  "updateConversation",
  "deleteConversation",
  "addMessage",
  "updateMessage",
  "updateMessages",
] as const;

describe("readOnlyRepo", () => {
  it("drops every write without reaching the underlying repo", async () => {
    const { repo, calls } = spyRepo();
    const ro = readOnlyRepo(repo);

    await ro.createConversation({ id: "c1", title: "t" });
    await ro.updateConversation("c1", { title: "t2" });
    await ro.deleteConversation("c1");
    await ro.addMessage("c1", msg("m1"));
    await ro.updateMessage("c1", "m1", { content: "edited" });
    // The batched write compaction uses. An incognito fold holds for the
    // session and touches nothing on disk — which is all an incognito
    // conversation ever gets, since a reload loses the whole thing regardless.
    await ro.updateMessages("c1", [{ id: "m1", patch: { folded: true } }]);

    expect(calls).toEqual([]);
  });

  it("covers every mutating method on the ChatRepo interface", () => {
    // If a later phase adds a write to ChatRepo without teaching the wrapper
    // about it, the wrapper would forward it. This asserts the list stays whole.
    const { repo } = spyRepo();
    const ro = readOnlyRepo(repo) as unknown as Record<string, unknown>;
    for (const name of WRITES) {
      expect(typeof ro[name]).toBe("function");
      // The wrapper's own function, not the base's.
      expect(ro[name]).not.toBe(
        (repo as unknown as Record<string, unknown>)[name],
      );
    }
  });

  it("resolves writes rather than throwing, so callers need no special case", async () => {
    const { repo } = spyRepo();
    const ro = readOnlyRepo(repo);
    await expect(ro.addMessage("c1", msg("m1"))).resolves.toBeUndefined();
  });

  it("passes reads through, so saved history stays browsable", async () => {
    const { repo, calls } = spyRepo();
    const ro = readOnlyRepo(repo);

    const convs = await ro.listConversations();
    const msgs = await ro.listMessages("c1");

    expect(convs).toHaveLength(1);
    expect(convs[0].title).toBe("saved chat");
    expect(msgs[0].id).toBe("c1-m1");
    expect(calls).toEqual(["listConversations", "listMessages"]);
  });

  it("keeps reporting the underlying driver's remote flag", () => {
    const { repo } = spyRepo();
    expect(readOnlyRepo(repo).remote).toBe(true);
    expect(readOnlyRepo({ ...repo, remote: false }).remote).toBe(false);
  });
});

describe("incognito gate", () => {
  beforeEach(() => resetIncognito());

  it("starts off — the mode is never remembered across sessions", () => {
    expect(isIncognito()).toBe(false);
  });

  it("toggles", () => {
    setIncognito(true);
    expect(isIncognito()).toBe(true);
    setIncognito(false);
    expect(isIncognito()).toBe(false);
  });

  it("notifies subscribers only on an actual change", () => {
    const seen: boolean[] = [];
    subscribeIncognito((v) => seen.push(v));
    setIncognito(true);
    setIncognito(true); // no-op
    setIncognito(false);
    expect(seen).toEqual([true, false]);
  });

  it("stops notifying after unsubscribe", () => {
    const seen: boolean[] = [];
    const off = subscribeIncognito((v) => seen.push(v));
    setIncognito(true);
    off();
    setIncognito(false);
    expect(seen).toEqual([true]);
  });
});
