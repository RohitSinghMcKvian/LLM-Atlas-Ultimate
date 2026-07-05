import { describe, expect, it } from "vitest";
import {
  expandTemplate,
  matchTemplateInput,
  TASK_TEMPLATES,
  templateByCommand,
} from "./templates";

describe("template registry", () => {
  it("every template has a unique slash command and label", () => {
    const cmds = TASK_TEMPLATES.map((t) => t.command);
    expect(new Set(cmds).size).toBe(cmds.length);
    expect(cmds.every((c) => c.startsWith("/"))).toBe(true);
  });

  it("covers the B.4 command set", () => {
    for (const c of ["/fix-issue", "/add-feature", "/write-tests", "/refactor", "/review", "/migrate", "/document"])
      expect(templateByCommand(c)).toBeTruthy();
  });
});

describe("matchTemplateInput", () => {
  it("splits command and argument", () => {
    const m = matchTemplateInput("/fix-issue TypeError: cannot read x of undefined");
    expect(m?.template.id).toBe("fix-issue");
    expect(m?.arg).toBe("TypeError: cannot read x of undefined");
  });

  it("matches a bare command with no arg", () => {
    expect(matchTemplateInput("/review")?.template.id).toBe("review");
  });

  it("returns null for non-template input", () => {
    expect(matchTemplateInput("just do the thing")).toBeNull();
    expect(matchTemplateInput("/unknown-cmd stuff")).toBeNull();
  });

  it("is case-insensitive on the command", () => {
    expect(matchTemplateInput("/Fix-Issue boom")?.template.id).toBe("fix-issue");
  });
});

describe("expandTemplate", () => {
  it("embeds arg, guidance, and the plan skeleton", () => {
    const t = templateByCommand("/fix-issue")!;
    const goal = expandTemplate(t, "login crashes on empty password");
    expect(goal).toContain("login crashes on empty password");
    expect(goal).toContain("Approach:");
    expect(goal).toContain("Reproduce the failure");
  });

  it("falls back to the description when no arg is given", () => {
    const t = templateByCommand("/refactor")!;
    const goal = expandTemplate(t, "");
    expect(goal).toContain(t.description);
  });
});
