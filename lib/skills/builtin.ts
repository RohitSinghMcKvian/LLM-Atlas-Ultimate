// Skills shipped with Atlas.
//
// Kept as raw SKILL.md text rather than as `Skill` objects so they go through
// exactly the same parser as a user's own skill. If a built-in would fail
// validation, the test suite says so instead of the malformed skill quietly
// working because it skipped the checks everything else runs.
//
// Three, not thirty. Each demonstrates a different part of the mechanism — a
// tool restriction, an unrestricted skill, and a skill that produces an
// artifact — so the feature is exercised without shipping a content library
// nobody asked for.

export const BUILTIN_SKILL_SOURCES: string[] = [
  `---
name: Web research brief
description: Use when the user asks for current information, market or competitor research, or anything that depends on recent events. Produces a short cited brief rather than an essay.
allowed-tools: [web_search]
version: 1.0
---

Produce a brief, not an essay.

1. Search before writing. Run two or three distinct queries rather than one broad
   one — a single query returns one framing of the topic.
2. Open with the answer in one or two sentences. The reader should be able to stop
   there.
3. Then give the supporting detail as short bullets, each carrying its citation
   number inline.
4. Separate what the sources say from what you infer. Label inference as
   inference.
5. Say what you could not find. A gap named is more useful than a gap papered
   over with a plausible sentence.

Never cite a source you did not retrieve in this turn.`,

  `---
name: Code review
description: Use when the user asks for a review of code, a diff, or a pull request. Prioritises correctness and real defects over style commentary.
version: 1.0
---

Review for defects that would bite in production, in this order:

1. **Correctness** — wrong results, unhandled cases, off-by-one, race conditions,
   incorrect error handling. For each, give a concrete failing input and the
   wrong output it produces. A finding without a failure scenario is a guess.
2. **Security** — injection, missing authorisation, secrets in code or logs,
   unsafe deserialisation, path traversal.
3. **Resource handling** — leaks, unbounded growth, missing cleanup on the error
   path.
4. **Tests** — behaviour that changed with no test covering it.

Then, and only briefly, style. Do not pad a review with naming preferences to
make it look thorough.

Order findings by severity, most severe first. If you find nothing, say so
plainly rather than manufacturing a finding.`,

  `---
name: Data visualisation
description: Use when the user asks for a chart, graph, dashboard, or any visual presentation of data. Produces a self-contained interactive artifact.
version: 1.0
---

Return a single fenced \`jsx\` block so it renders as an artifact.

Constraints of the sandbox, which are real and will bite silently:

- No network. Do not fetch data — inline it in the component.
- Recharts, d3 and React are preloaded as globals. Tailwind is NOT available, so
  use inline styles or a \`<style>\` block.
- Use \`await storage.set(...)\` / \`storage.get(...)\` if the view needs to remember
  a filter or selection across reloads.

Choices that matter more than the library:

- Pick the encoding from the question, not from novelty. Time series: line.
  Comparison across categories: bar. Part-to-whole with few parts: stacked bar,
  not a pie.
- Label axes with units. An unlabelled axis makes a chart decorative.
- Start a bar chart's value axis at zero. Do not truncate it to exaggerate a
  difference.
- State the source and the time range in the chart itself.`,
];
