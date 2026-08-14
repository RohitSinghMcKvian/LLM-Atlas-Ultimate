import { describe, it, expect } from "vitest";
import { buildSystemPrompt, STYLE_PRESETS, SYSTEM_PROMPT_MAX_CHARS } from "./settings-store";

// buildSystemPrompt is a pure composer over the settings context; the zustand
// store around it isn't exercised here.

describe("buildSystemPrompt", () => {
  const base = { style: "default" as const };

  it("always includes the Atlas base instruction", () => {
    expect(buildSystemPrompt(base)).toContain("You are Atlas");
  });

  it("appends the chosen style preset's prompt", () => {
    const concise = STYLE_PRESETS.find((s) => s.id === "concise");
    if (concise?.prompt) {
      expect(buildSystemPrompt({ style: "concise" })).toContain(concise.prompt);
    }
  });

  it("includes account preferences when present", () => {
    const out = buildSystemPrompt({
      ...base,
      displayName: "Sam",
      aboutYou: "I am a data engineer.",
      responseGuidance: "Prefer SQL examples.",
    });
    expect(out).toContain("Sam");
    expect(out).toContain("data engineer");
    expect(out).toContain("SQL examples");
  });

  // The P3 acceptance criterion: project instructions must override account
  // preferences, and must say so explicitly rather than relying on ordering.
  it("states that project instructions override account preferences", () => {
    const out = buildSystemPrompt({
      ...base,
      aboutYou: "I like long answers.",
      projectInstructions: "Answer in one sentence.",
    });
    expect(out).toContain("Answer in one sentence.");
    expect(out.toLowerCase()).toContain("take precedence");
    // The override clause must come after the account preference it overrides.
    expect(out.indexOf("Answer in one sentence.")).toBeGreaterThan(
      out.indexOf("I like long answers."),
    );
  });

  it("omits the project block when there are no project instructions", () => {
    expect(buildSystemPrompt(base).toLowerCase()).not.toContain("take precedence");
  });

  it("lists recalled memories when provided", () => {
    const out = buildSystemPrompt({ ...base, memories: ["prefers metric units"] });
    expect(out).toContain("prefers metric units");
  });

  // ── P4 ────────────────────────────────────────────────────────────────────

  it("includes the user's memory summary and attributes it to them", () => {
    const out = buildSystemPrompt({
      ...base,
      memorySummary: "Preferences:\n- prefers metric units",
    });
    expect(out).toContain("prefers metric units");
    expect(out).toContain("approved by them");
  });

  it("advertises memory file paths without their contents", () => {
    const out = buildSystemPrompt({
      ...base,
      memoryDirectory: "Your memory directory contains these files:\n- /memories/prefs.md (12 bytes)",
    });
    expect(out).toContain("/memories/prefs.md");
  });

  it("tells the model when the chat is temporary", () => {
    const out = buildSystemPrompt({ ...base, incognito: true });
    expect(out).toContain("temporary chat");
    expect(out.toLowerCase()).toContain("nothing from it is saved");
  });

  it("says nothing about incognito when the mode is off", () => {
    expect(buildSystemPrompt(base)).not.toContain("temporary chat");
  });

  // ── P5 ────────────────────────────────────────────────────────────────────

  it("includes the skills index when provided", () => {
    const out = buildSystemPrompt({
      ...base,
      skillsIndex: "Skills available to you.\n- research: Research — Use for current info.",
    });
    expect(out).toContain("research");
    expect(out).toContain("Use for current info.");
  });

  // A skill is instructions the model follows; the user's own instructions must
  // read as outranking it, not the other way round.
  it("places the skills index after the user's own instructions", () => {
    const out = buildSystemPrompt({
      ...base,
      responseGuidance: "Always answer in French.",
      skillsIndex: "Skills available to you.",
    });
    expect(out.indexOf("Skills available to you.")).toBeGreaterThan(
      out.indexOf("Always answer in French."),
    );
  });

  it("omits the skills block when nothing is installed", () => {
    expect(buildSystemPrompt(base)).not.toContain("Skills available to you");
  });

  // ── P6 ────────────────────────────────────────────────────────────────────

  it("names connected services and warns they touch real accounts", () => {
    const out = buildSystemPrompt({
      ...base,
      connectorsIndex: "Connected external services act on the user's real accounts.\n- Calendar: 2 tool(s)",
    });
    expect(out).toContain("Calendar");
    expect(out).toContain("real accounts");
  });

  it("omits the connectors block when nothing is connected", () => {
    expect(buildSystemPrompt(base)).not.toContain("Connected external services");
  });
});

describe("build mode", () => {
  const base = { style: "default" as const };

  it("adds nothing when build mode is off", () => {
    const out = buildSystemPrompt(base);
    expect(out).not.toContain("BUILD MODE");
  });

  it("states the build conventions when on", () => {
    const out = buildSystemPrompt({ ...base, buildMode: true });
    expect(out).toContain("BUILD MODE");
    expect(out).toContain("append");
    expect(out).toContain("str_replace");
    expect(out).toContain("tasks");
  });

  it("carries the workspace context through", () => {
    const out = buildSystemPrompt({
      ...base,
      buildMode: true,
      workspaceContext: "## Build workspace\nGoal: a coffee landing page",
    });
    expect(out).toContain("a coffee landing page");
  });
});

describe("system prompt budget", () => {
  const big = (n: number) => "x".repeat(n);

  it("leaves an ordinary prompt untouched", () => {
    const out = buildSystemPrompt({
      style: "default",
      aboutYou: "I am a data engineer.",
      skillsIndex: "Skills: one, two",
    });
    expect(out).toContain("data engineer");
    expect(out).toContain("Skills: one, two");
  });

  it("stays inside the ceiling when every subsystem contributes", () => {
    const out = buildSystemPrompt({
      style: "default",
      buildMode: true,
      aboutYou: big(9000),
      responseGuidance: big(9000),
      projectInstructions: big(9000),
      workspaceContext: big(2400),
      memorySummary: big(9000),
      memories: [big(9000)],
      memoryDirectory: big(9000),
      skillsIndex: big(9000),
      connectorsIndex: big(9000),
    });
    expect(out.length).toBeLessThanOrEqual(SYSTEM_PROMPT_MAX_CHARS);
  });

  // What must survive: who Atlas is, the build rules, and the build state. The
  // three tool indexes are recoverable — the model can still call the tool.
  it("drops the recoverable indexes before the irrecoverable build state", () => {
    const out = buildSystemPrompt({
      style: "default",
      buildMode: true,
      workspaceContext: "Goal: SENTINEL_GOAL",
      memoryDirectory: big(11000),
      skillsIndex: big(11000),
      connectorsIndex: big(11000),
    });
    expect(out).toContain("You are Atlas");
    expect(out).toContain("BUILD MODE");
    expect(out).toContain("SENTINEL_GOAL");
    expect(out.length).toBeLessThanOrEqual(SYSTEM_PROMPT_MAX_CHARS);
  });

  it("never drops the incognito promise", () => {
    const out = buildSystemPrompt({
      style: "default",
      incognito: true,
      memoryDirectory: big(11000),
      skillsIndex: big(11000),
      connectorsIndex: big(11000),
    });
    expect(out).toContain("temporary chat");
  });
});
