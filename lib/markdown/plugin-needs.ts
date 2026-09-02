/**
 * Which of the two expensive markdown plugins a given document actually needs.
 *
 * Measured on the production build, `rehype-katex` drags in KaTeX at 258 KB and
 * `rehype-highlight` drags in lowlight/highlight.js inside a 325 KB markdown
 * chunk. Both used to be static imports in `components/markdown.tsx`, which
 * five routes import — Chat, Compare, Playground, Code and Learn each paid the
 * full ~580 KB before their first paint, whether or not a single message on
 * screen contained a formula or a fenced code block. Most contain neither;
 * almost none contain both.
 *
 * The predicates live here rather than next to the hook so they can be tested:
 * the repo's suite covers `lib/**`, and getting these wrong is not a subtle
 * failure — a false negative renders a formula as raw `$$…$$` forever, and a
 * false positive fetches a quarter-megabyte for a message about pricing.
 */

/**
 * Fenced (```), tilde-fenced (~~~) or inline-backtick code.
 *
 * Inline code counts: `rehype-highlight` decorates `<code>` in inline position
 * too, and a message that is one backticked identifier is common enough that
 * skipping it would be a visible inconsistency.
 */
const CODE_RE = /(^|\n)[ \t]*(?:```|~~~)|`[^`\n]+`/;

/**
 * The delimiters `remark-math` is configured to honour.
 *
 * Deliberately *not* a lone `$`. `components/markdown.tsx` passes
 * `singleDollarTextMath: false` precisely because this product quotes prices
 * constantly, and a pair of prices in one paragraph is not a formula. This
 * detector has to agree with that parser setting or it would fetch 258 KB of
 * KaTeX for every answer that mentions "$0.16/M".
 */
const MATH_DELIMITERS = ["$$", "\\(", "\\["];

export function needsHighlight(text: string): boolean {
  return CODE_RE.test(text);
}

export function needsMath(text: string): boolean {
  return MATH_DELIMITERS.some((d) => text.includes(d));
}
