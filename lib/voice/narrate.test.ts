import { describe, expect, it } from "vitest";
import { finishNarration, initNarration, isSpeakable, narrate, narrateAll } from "./narrate";

/**
 * What a spoken turn actually says.
 *
 * These are the cases that make the difference between a conversation and a
 * synthesiser reading a document out loud, and every one of them is a thing the
 * two halves could not check on their own: `segment.ts` does not know what
 * markdown sounds like, `speech-plan.ts` does not know it is being handed a
 * stream.
 */

/** Feed a stream chunk by chunk, the way the tool loop delivers it. */
function stream(chunks: string[]): string[] {
  let state = initNarration();
  const out: string[] = [];
  for (const c of chunks) {
    const r = narrate(state, c);
    state = r.state;
    out.push(...r.utterances);
  }
  out.push(...finishNarration(state).utterances);
  return out;
}

describe("narrate", () => {
  it("says nothing until a sentence is complete", () => {
    // The whole reason for the segmenter. Speaking every token produces a
    // stutter, and speaking every clause produces a stutter with pauses in it.
    let state = initNarration();
    const a = narrate(state, "Claude Opus costs");
    expect(a.utterances).toEqual([]);
    state = a.state;
    const b = narrate(state, " fifteen dollars per million. ");
    expect(b.utterances).toEqual(["Claude Opus costs fifteen dollars per million."]);
  });

  it("does not care where the chunk boundaries fell", () => {
    // A stream splits mid-word; the sentences must come out the same either way.
    const whole = stream(["One thing. Then another thing here."]);
    const split = stream(["One thi", "ng. Then ano", "ther thing here."]);
    expect(split).toEqual(whole);
  });

  it("announces a code block once, when it closes, and never reads it", () => {
    const said = stream([
      "Here is the fix. ",
      "```python\n",
      "print('hello')\n",
      "```",
      " That is all.",
    ]);
    const joined = said.join(" ");
    expect(joined).toContain("The python is on screen");
    expect(joined).not.toContain("print");
    // Once. Planning before segmenting announced the unterminated fence on
    // every flush, then announced the closed one again at the end.
    expect(joined.match(/on screen/g)).toHaveLength(1);
  });

  it("keeps the words of a link and drops the address", () => {
    const said = narrateAll("Read [the model card](https://example.com/a/b/c) for details.");
    expect(said.join(" ")).toContain("the model card");
    expect(said.join(" ")).not.toContain("example.com");
  });

  it("does not read citation markers as numbers", () => {
    // "one" mid-sentence is a number the listener tries to attach to the noun
    // in front of it.
    expect(narrateAll("Prices rose [1] last quarter.").join(" ")).not.toContain("1]");
  });

  it("says a table is on screen instead of reading its pipes", () => {
    const said = narrateAll("Compare them.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nThat is the shape.");
    const joined = said.join(" ");
    expect(joined).toContain("table on screen");
    expect(joined).not.toContain("|");
  });

  it("drops a segment with nothing sayable in it", () => {
    // A stranded citation or bare URL plans down to punctuation. Queued, it is
    // a gap the listener reads as the agent having stopped - and on some
    // engines an utterance that never fires `onend`, stranding the turn.
    const said = narrateAll("Fine. [2] https://x.example/y");
    expect(said.every((s) => /[a-zA-Z0-9]/.test(s))).toBe(true);
  });

  it("flushes a trailing fragment that never got a full stop", () => {
    // Providers truncate. Losing the last clause because no period arrived
    // would be silence exactly where the answer was.
    expect(stream(["It costs about nine dollars"])).toEqual(["It costs about nine dollars"]);
  });

  it("produces nothing at all for an empty answer", () => {
    expect(narrateAll("")).toEqual([]);
    expect(narrateAll("   \n\n  ")).toEqual([]);
  });
});

describe("isSpeakable", () => {
  it("accepts words and numbers, rejects punctuation and whitespace", () => {
    expect(isSpeakable("Nine dollars.")).toBe(true);
    expect(isSpeakable("42")).toBe(true);
    expect(isSpeakable(" . , — ")).toBe(false);
    expect(isSpeakable("")).toBe(false);
  });
});
