/**
 * Local commit-message linting.
 *
 * Secondary to `.github/workflows/pr-title.yml`: this repo squash-merges, so
 * individual commit subjects are collapsed into the PR title and it is the
 * title that reaches `main` and drives release-please. This hook is here so the
 * habit is consistent and so anyone who later switches to merge-commits is
 * already writing parseable subjects.
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Matches the list in .github/scripts/check-pr-title.mjs and CONTRIBUTING.md.
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "perf", "refactor", "docs", "test", "ci", "build", "chore", "style", "revert"],
    ],
    // The default 100 is measured against the header only, which is what we want.
    "header-max-length": [2, "always", 100],
    // Bodies here carry real reasoning and are wrapped by hand; the default
    // 100-char body rule fights that for no benefit.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
