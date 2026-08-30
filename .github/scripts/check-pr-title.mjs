#!/usr/bin/env node
/**
 * Is the pull-request title a Conventional Commit?
 *
 * This matters more here than commit messages do. The repo squash-merges, so
 * the PR title becomes the single commit subject on `main` — and that subject
 * is what release-please parses to decide the next version and to write the
 * changelog. A PR titled "fixes" produces a release note that says "fixes", and
 * a `feat:` typed as `feature:` produces no release at all.
 *
 * Written by hand rather than pulled from the marketplace on purpose: this runs
 * on a public repository against attacker-influenced input, and a third-party
 * action here would be a supply-chain dependency for one regex.
 *
 * The title arrives via the environment, never interpolated into a shell
 * command — `${{ github.event.pull_request.title }}` inside a `run:` block is a
 * script-injection hole, since anyone who can open a PR chooses that string.
 */

const TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "ci",
  "build",
  "chore",
  "style",
  "revert",
];

// type(optional-scope)!: subject
const PATTERN = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9._/-]+\\))?(!)?: (.+)$`);

const title = process.env.PR_TITLE ?? "";

function fail(reason, hint) {
  console.error(`✗ ${reason}\n`);
  console.error(`  title: ${JSON.stringify(title)}\n`);
  if (hint) console.error(`  ${hint}\n`);
  console.error(`  Expected:  type(optional-scope): summary`);
  console.error(`  Types:     ${TYPES.join(", ")}`);
  console.error(`  Breaking:  add ! before the colon — feat(router)!: drop v1`);
  console.error(`\n  Examples:`);
  console.error(`    fix(router): stop dropping the upstream error detail`);
  console.error(`    feat(chat): add the Ask Atlas dock`);
  console.error(`    ci: run the production build on pull requests`);
  console.error(`\n  See CONTRIBUTING.md. Edit the PR title and this re-runs.`);
  process.exit(1);
}

if (!title.trim()) fail("The pull-request title is empty.");

const match = PATTERN.exec(title);

if (!match) {
  // Point at the most likely mistake rather than restating the rule.
  const looksLikeType = /^([a-zA-Z]+)\s*(\(.*?\))?\s*:/.exec(title);
  let hint;
  if (looksLikeType) {
    const used = looksLikeType[1];
    if (TYPES.includes(used.toLowerCase()) && used !== used.toLowerCase()) {
      hint = `"${used}" must be lowercase.`;
    } else if (!TYPES.includes(used.toLowerCase())) {
      const near = { feature: "feat", bugfix: "fix", bug: "fix", hotfix: "fix", chores: "chore", doc: "docs", tests: "test" }[used.toLowerCase()];
      hint = near
        ? `"${used}" is not a type — did you mean "${near}"?`
        : `"${used}" is not one of the allowed types.`;
    }
  } else if (!title.includes(":")) {
    hint = "There is no colon — a type prefix is required.";
  }
  fail("The pull-request title is not a Conventional Commit.", hint);
}

const [, type, scope, breaking, subject] = match;

if (subject.length < 5) fail("The summary is too short to describe anything.");
if (subject.endsWith(".")) fail("Drop the trailing period from the summary.");
if (title.length > 100) {
  fail(`The title is ${title.length} characters; keep it under 100 so it reads as a commit subject.`);
}

const release =
  breaking || /^BREAKING[ -]CHANGE/.test(subject)
    ? "major (minor while the version is < 1.0.0)"
    : type === "feat"
      ? "minor"
      : type === "fix" || type === "perf"
        ? "patch"
        : "none — this type does not cut a release";

console.log(`✓ ${title}`);
console.log(`  type: ${type}${scope ?? ""}${breaking ?? ""}`);
console.log(`  release impact: ${release}`);
