import { describe, expect, it } from "vitest";
import {
  describeIntent,
  intentHelp,
  looksLikeQuestion,
  matchModels,
  matchModule,
  parseIntent,
} from "./intent";

/**
 * The vocabulary that lets voice operate Atlas.
 *
 * The property that matters more than any single phrase: **a question is never
 * a command**. A missed command costs a model round-trip; a false one moves the
 * page out from under someone who was reading it. Every ambiguous case here is
 * asserted to fall through to `ask`.
 */

const MODELS = [
  { id: "gpt-5-codex", name: "GPT-5 Codex" },
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "qwen3-coder", name: "Qwen3 Coder" },
];

describe("questions are never commands", () => {
  it.each([
    "what is on the cost page",
    "how does compare work",
    "which leaderboard sort is default",
    "can you open compare",
    "tell me about the playground",
    "is news up to date",
    "why is the cost page empty",
  ])("falls through to ask: %s", (text) => {
    expect(parseIntent(text, { models: MODELS }).kind).toBe("ask");
  });

  it("recognises the question shape without punctuation", () => {
    expect(looksLikeQuestion("what does this cost")).toBe(true);
    expect(looksLikeQuestion("open compare")).toBe(false);
  });

  it("does not navigate on a bare module name", () => {
    // "Compare" alone is as likely to be the start of a question as a command.
    expect(parseIntent("compare", { models: MODELS }).kind).toBe("ask");
    expect(parseIntent("the cost page", {}).kind).toBe("ask");
  });
});

describe("navigation", () => {
  it("resolves a module to its real route", () => {
    const i = parseIntent("open compare", {});
    expect(i).toMatchObject({ kind: "navigate", moduleId: "compare", href: "/compare" });
  });

  it.each([
    ["go to cost", "cost"],
    ["take me to the leaderboard", "leaderboard"],
    ["show me news", "news"],
    ["switch to playground", "playground"],
    ["pull up the prompt library", "prompt"],
    ["open rankings", "leaderboard"],
    ["open pricing", "cost"],
    ["bring up the sandbox", "playground"],
  ])("%s opens %s", (text, moduleId) => {
    expect(parseIntent(text, {})).toMatchObject({ kind: "navigate", moduleId });
  });

  it("carries models named alongside the destination", () => {
    const i = parseIntent("open compare with gpt-5 codex and claude opus 5", { models: MODELS });
    expect(i).toMatchObject({ kind: "navigate", moduleId: "compare" });
    expect(i.kind === "navigate" && i.modelIds).toEqual(["gpt-5-codex", "claude-opus-5"]);
  });

  it("carries the access footing when it is named", () => {
    expect(parseIntent("open the leaderboard free models", {})).toMatchObject({
      kind: "navigate",
      moduleId: "leaderboard",
      access: "free",
    });
  });

  it("refuses when two modules are named with equal weight", () => {
    // "Open cost and news" is not a destination; it is a question about both.
    expect(parseIntent("open cost and news", {}).kind).toBe("ask");
  });

  it("takes back as its own intent, verb or not", () => {
    expect(parseIntent("go back", {})).toEqual({ kind: "back" });
    expect(parseIntent("back", {})).toEqual({ kind: "back" });
  });
});

describe("matchModule", () => {
  it("matches on word boundaries, not substrings", () => {
    // "costly" must not resolve to the Cost module.
    expect(matchModule("that looks costly")).toBeNull();
    expect(matchModule("cost")).toMatchObject({ id: "cost" });
  });

  it("prefers the longer name when one contains the other", () => {
    expect(matchModule("leader board")).toMatchObject({ id: "leaderboard" });
  });
});

describe("matchModels", () => {
  it("finds names in the order they were spoken", () => {
    expect(matchModels("compare claude opus 5 and gpt-5 codex", MODELS)).toEqual([
      "claude-opus-5",
      "gpt-5-codex",
    ]);
  });

  it("finds an id said as words", () => {
    expect(matchModels("add qwen3 coder", MODELS)).toEqual(["qwen3-coder"]);
  });

  it("returns nothing rather than a guess when nothing is close", () => {
    expect(matchModels("add the purple one", MODELS)).toEqual([]);
  });

  it("is empty with no catalog to match against", () => {
    expect(matchModels("compare anything", [])).toEqual([]);
  });
});

describe("selection", () => {
  it("sets, adds, removes and clears", () => {
    expect(parseIntent("compare gpt-5 codex and qwen3 coder", { models: MODELS })).toMatchObject({
      kind: "select",
      op: "set",
      modelIds: ["gpt-5-codex", "qwen3-coder"],
    });
    expect(parseIntent("add claude opus 5", { models: MODELS })).toMatchObject({
      kind: "select",
      op: "add",
    });
    expect(parseIntent("remove qwen3 coder", { models: MODELS })).toMatchObject({
      kind: "select",
      op: "remove",
    });
    expect(parseIntent("clear the selection", { models: MODELS })).toMatchObject({
      kind: "select",
      op: "clear",
      modelIds: [],
    });
  });

  it("does not select when no model was named", () => {
    expect(parseIntent("add something good", { models: MODELS }).kind).toBe("ask");
  });

  it("cannot select without a catalog", () => {
    expect(parseIntent("compare gpt-5 codex and qwen3 coder", {}).kind).toBe("ask");
  });
});

describe("filters", () => {
  it("reads access, licence and sort", () => {
    expect(parseIntent("show only free models", {})).toMatchObject({ kind: "filter", access: "free" });
    expect(parseIntent("only open weights", {})).toMatchObject({ kind: "filter", openWeights: true });
    expect(parseIntent("sort by price", {})).toMatchObject({ kind: "filter", sort: "price" });
    expect(parseIntent("sort by speed", {})).toMatchObject({ kind: "filter", sort: "speed" });
    expect(parseIntent("clear filters", {})).toMatchObject({ kind: "filter", clear: true });
  });

  it("does not filter on a passing mention of free", () => {
    expect(parseIntent("free models are usually slower", {}).kind).toBe("ask");
  });
});

describe("playback and session", () => {
  it.each([
    ["stop", "stop"],
    ["be quiet", "stop"],
    ["say that again", "repeat"],
    ["slow down", "slower"],
    ["speed up", "faster"],
  ])("%s is playback %s", (text, op) => {
    expect(parseIntent(text, {})).toEqual({ kind: "playback", op });
  });

  it.each([
    ["new topic", "reset"],
    ["what can i say", "help"],
    ["goodbye", "end"],
  ])("%s is session %s", (text, op) => {
    expect(parseIntent(text, {})).toEqual({ kind: "session", op });
  });

  it("only matches playback on an exact utterance", () => {
    // Otherwise "stop the comparison when it gets expensive" silences the agent.
    expect(parseIntent("stop the run when it gets expensive", {}).kind).toBe("ask");
  });
});

describe("describeIntent", () => {
  it("names the destination a person would recognise", () => {
    expect(describeIntent(parseIntent("open compare", {}))).toBe("Opening Atlas Compare");
  });

  it("says what a selection will do", () => {
    expect(describeIntent(parseIntent("add claude opus 5", { models: MODELS }))).toBe(
      "Adding claude-opus-5",
    );
  });

  it("has a line for every intent kind", () => {
    const samples = [
      parseIntent("open cost", {}),
      parseIntent("back", {}),
      parseIntent("clear the selection", { models: MODELS }),
      parseIntent("sort by price", {}),
      parseIntent("stop", {}),
      parseIntent("new topic", {}),
      parseIntent("anything else at all", {}),
    ];
    for (const s of samples) expect(describeIntent(s).length).toBeGreaterThan(0);
  });
});

describe("intentHelp", () => {
  it("lists examples that actually parse as commands", () => {
    for (const group of intentHelp({ models: MODELS })) {
      for (const example of group.examples) {
        const text = example.replace(/"/g, "");
        const intent = parseIntent(text, { models: MODELS });
        expect(intent.kind, `${example} should not fall through to ask`).not.toBe("ask");
      }
    }
  });

  it("omits model examples rather than inventing names for an empty catalog", () => {
    const picks = intentHelp({}).find((g) => g.group === "Pick models");
    expect(picks?.examples).toEqual(['"Clear the selection"']);
  });
});
