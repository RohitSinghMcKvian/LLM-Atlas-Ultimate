import { describe, expect, it } from "vitest";
import { VOICE_PROMPT, isVisualAnswer, planSpeech } from "./speech-plan";

describe("planSpeech", () => {
  it("announces code instead of reading it aloud", () => {
    const r = planSpeech("Here is the fix.\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nThat is it.");
    expect(r.speak).toContain("The ts is on screen");
    expect(r.speak).not.toContain("const a");
    expect(r.skipped).toContainEqual({ kind: "code", count: 1 });
  });

  it("announces a block still being written", () => {
    const r = planSpeech("Working on it.\n\n```python\ndef f():\n    return 1");
    expect(r.speak).toContain("being written on screen");
  });

  it("announces a table rather than reading its pipes", () => {
    const r = planSpeech("Compare:\n\n| Model | Price |\n| --- | --- |\n| A | $1 |\n\nDone.");
    expect(r.speak).toContain("There is a table on screen");
    expect(r.speak).not.toContain("|");
  });

  it("keeps the words of a link and drops the address", () => {
    const r = planSpeech("See [the pricing page](https://example.com/pricing) for detail.");
    expect(r.speak).toBe("See the pricing page for detail.");
    expect(r.skipped).toContainEqual({ kind: "link", count: 1 });
  });

  it("does not read a bare URL character by character", () => {
    const r = planSpeech("Docs at https://example.com/a/b?c=d are useful.");
    expect(r.speak).toBe("Docs at a link on screen are useful.");
  });

  it("drops citation markers, which are for the eye", () => {
    expect(planSpeech("Summit Pro leads [1], ahead of Meridian [2].").speak).toBe(
      "Summit Pro leads , ahead of Meridian .",
    );
  });

  it("keeps headings and list content as prose", () => {
    const r = planSpeech("## The options\n\n- Cheap one\n- Fast one\n\n1. First\n2. Second");
    expect(r.speak).toContain("The options.");
    expect(r.speak).toContain("Cheap one");
    expect(r.speak).toContain("First");
    expect(r.speak).not.toContain("- ");
  });

  it("keeps inline code, which is usually a name worth saying", () => {
    expect(planSpeech("Call `atlas_cost` for that.").speak).toBe("Call atlas_cost for that.");
  });

  it("strips emphasis without eating the words", () => {
    expect(planSpeech("It is **much** cheaper and _far_ faster.").speak).toBe(
      "It is much cheaper and far faster.",
    );
  });

  it("announces an image by its alt text when there is one", () => {
    expect(planSpeech("![a chart of prices](x.png)").speak).toContain("An image: a chart of prices");
    expect(planSpeech("![](x.png)").speak).toContain("There is an image on screen");
  });

  it("announces display maths", () => {
    expect(planSpeech("The rate is $$c = k \\cdot n$$ per token.").speak).toContain(
      "There is an equation on screen",
    );
  });

  it("leaves plain prose exactly alone", () => {
    const plain = "Summit Pro costs more but scores higher on every benchmark they share.";
    expect(planSpeech(plain)).toEqual({ speak: plain, skipped: [] });
  });

  it("handles an empty answer", () => {
    expect(planSpeech("")).toEqual({ speak: "", skipped: [] });
  });
});

describe("isVisualAnswer", () => {
  it("recognises an answer shaped for the eye", () => {
    expect(isVisualAnswer("```js\nx\n```")).toBe(true);
    expect(isVisualAnswer("| a | b |\n| - | - |")).toBe(true);
  });

  it("does not flag ordinary prose or a mere link", () => {
    expect(isVisualAnswer("It is cheaper.")).toBe(false);
    expect(isVisualAnswer("See [docs](https://x.dev).")).toBe(false);
  });
});

describe("VOICE_PROMPT", () => {
  it("shapes the answer rather than just post-processing it", () => {
    expect(VOICE_PROMPT).toContain("spoken aloud");
    expect(VOICE_PROMPT).toContain("Lead with the answer");
    expect(VOICE_PROMPT).toContain("No tables");
  });
});
