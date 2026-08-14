import { describe, it, expect } from "vitest";
import {
  BUILD_THRESHOLD,
  detectBuildIntent,
  resolveAgentic,
  WEIGHTS,
  type BuildSignal,
} from "./agentic";

const verdict = (text: string, extra = {}) => detectBuildIntent({ text, ...extra }).verdict;

describe("detectBuildIntent — builds", () => {
  it("recognises an instruction to produce something", () => {
    const builds = [
      "Build me a single-page expense tracker with a chart",
      "Create a landing page for a coffee subscription, then write the README",
      "Write a Python script that parses these logs and outputs a CSV summary",
      "Make a React dashboard showing revenue by month",
      "Implement a CLI tool that renames files by EXIF date",
      "Generate a full slide deck on our Q3 results",
      "Scaffold a Next.js app with Tailwind and a working contact form",
      "Port this jQuery widget to a React component",
      "Build a snake game I can play in the browser",
      "Put together a production-ready pricing page from scratch",
      "Design a spreadsheet that tracks freelance invoices end to end",
      "Refactor this into multiple files and add a test suite",
    ];
    for (const t of builds) expect(verdict(t), t).toBe("build");
  });

  it("counts a numbered or bulleted list as multi-step", () => {
    expect(
      verdict("Write a report:\n1. summarise the data\n2. chart it\n3. add a conclusion"),
    ).toBe("build");
  });
});

describe("detectBuildIntent — not builds", () => {
  it("leaves ordinary questions and short asks alone", () => {
    const chats = [
      "What is the difference between a mutex and a semaphore?",
      "Why does my React component re-render on every keystroke?",
      "Explain how OAuth PKCE works",
      "Summarise this article",
      "Compare Postgres and SQLite for a small app",
      "Translate this paragraph into Spanish",
      "thanks!",
      "who wrote Dune",
      "Is Rust worth learning in 2026?",
      "How do I center a div",
      "Tell me about the Model Context Protocol",
      "when did the Apollo program end",
    ];
    for (const t of chats) expect(verdict(t), t).toBe("chat");
  });

  // A build verb in a question about building is still a question.
  it("does not fire on a question that merely mentions building", () => {
    expect(verdict("How would you build a rate limiter?")).toBe("chat");
    expect(verdict("What is the best way to create a design system?")).toBe("chat");
  });

  // ...unless it also asks for the thing. "Explain X, then write it" is a build.
  it("still fires when a question is followed by a real instruction", () => {
    expect(
      verdict("What would a good README for a CLI tool look like? Write one for this repo."),
    ).toBe("build");
  });
});

/**
 * The rule that fixes the most common real failure.
 *
 * Build mode used to apply to turn one and silently drop on turn two, because
 * "now make the header blue" scores nothing on any lexical signal. Users describe
 * this as Atlas forgetting what it was doing.
 */
describe("an existing build keeps the conversation in build mode", () => {
  it("clears the threshold on its own", () => {
    expect(WEIGHTS.hasBuild).toBeGreaterThanOrEqual(BUILD_THRESHOLD);
  });

  it("keeps terse follow-ups in build mode", () => {
    for (const t of ["now make the header blue", "add a footer", "fix the spacing", "one more page"]) {
      expect(detectBuildIntent({ text: t, workspaceFileCount: 3 }).verdict, t).toBe("build");
      expect(detectBuildIntent({ text: t }).verdict, t).toBe("chat");
    }
  });

  it("counts an open artifact as well as workspace files", () => {
    expect(detectBuildIntent({ text: "make it dark", hasOpenArtifact: true }).verdict).toBe("build");
  });

  // A genuine question in a build conversation is still a question: the -0.4
  // penalty has to be able to pull it back under the line.
  it("does not drag a plain question into build mode", () => {
    expect(
      detectBuildIntent({ text: "what does useMemo do?", workspaceFileCount: 3 }).verdict,
    ).toBe("chat");
  });
});

describe("attachments", () => {
  it("treats attached data as an instruction to do something with it", () => {
    expect(
      detectBuildIntent({
        text: "summarise this by month",
        attachments: [{ kind: "csv", name: "sales.csv" }],
      }).score,
    ).toBeGreaterThan(detectBuildIntent({ text: "summarise this by month" }).score);
  });

  it("does not treat an image or a PDF as a build signal", () => {
    expect(
      detectBuildIntent({
        text: "what is in this?",
        attachments: [{ kind: "image", name: "a.png" }],
      }).verdict,
    ).toBe("chat");
  });
});

describe("reasons", () => {
  it("names the rules that fired, so the UI can explain itself", () => {
    const s = detectBuildIntent({ text: "Build a dashboard in React, end to end" });
    expect(s.reasons).toContain("build instruction");
    expect(s.reasons).toContain("deliverable noun");
    expect(s.reasons).toContain("names a technology or file");
  });

  it("handles empty input without crashing", () => {
    expect(detectBuildIntent({ text: "" }).verdict).toBe("chat");
    expect(detectBuildIntent({ text: "   " }).reasons).toBeInstanceOf(Array);
  });
});

describe("resolveAgentic", () => {
  const build: BuildSignal = { score: 1, reasons: [], verdict: "build" };
  const chat: BuildSignal = { score: 0, reasons: [], verdict: "chat" };

  it("off never builds, whatever the detector says", () => {
    expect(resolveAgentic("off", null, build)).toEqual({ build: false, auto: false });
    expect(resolveAgentic("off", true, build)).toEqual({ build: false, auto: false });
  });

  it("always builds without claiming the decision was automatic", () => {
    expect(resolveAgentic("always", null, chat)).toEqual({ build: true, auto: false });
  });

  it("auto follows the detector and flags that it decided", () => {
    expect(resolveAgentic("auto", null, build)).toEqual({ build: true, auto: true });
    expect(resolveAgentic("auto", null, chat)).toEqual({ build: false, auto: false });
  });

  // "Just answer" has to mean it. A user who declined once must not be asked
  // again by the same heuristic three messages later.
  it("lets a per-conversation override beat the detector", () => {
    expect(resolveAgentic("auto", false, build)).toEqual({ build: false, auto: false });
    expect(resolveAgentic("auto", true, chat)).toEqual({ build: true, auto: false });
  });
});
