import { describe, it, expect } from "vitest";
import {
  MAX_DESCRIPTION_CHARS,
  MAX_SKILL_BODY_CHARS,
  isParseError,
  parseSkillMd,
  slugify,
  toSkillMd,
  type Skill,
} from "./parse";

const GOOD = `---
name: Web research brief
description: Use when the user asks for current information.
allowed-tools: [web_search]
version: 1.2
---

Search before writing.`;

/** Narrow to a Skill or fail the test with the parser's own message. */
function ok(content: string, opts?: Parameters<typeof parseSkillMd>[1]): Skill {
  const r = parseSkillMd(content, opts);
  if (isParseError(r)) throw new Error(`expected a skill, got: ${r.error}`);
  return r;
}

function err(content: string): string {
  const r = parseSkillMd(content);
  if (!isParseError(r)) throw new Error("expected a parse error");
  return r.error;
}

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Web Research Brief")).toBe("web-research-brief");
  });

  it("strips punctuation and collapses runs", () => {
    expect(slugify("C++  //  Style!!")).toBe("c-style");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  --hello--  ")).toBe("hello");
  });
});

describe("parseSkillMd", () => {
  it("parses frontmatter and body", () => {
    const s = ok(GOOD);
    expect(s.name).toBe("Web research brief");
    expect(s.description).toBe("Use when the user asks for current information.");
    expect(s.body).toBe("Search before writing.");
    expect(s.allowedTools).toEqual(["web_search"]);
    expect(s.version).toBe("1.2");
    expect(s.enabled).toBe(true);
  });

  it("derives an id from the name when there is no path", () => {
    expect(ok(GOOD).id).toBe("web-research-brief");
  });

  it("derives an id from the containing directory when given a path", () => {
    // Skills live at <skill-name>/SKILL.md, so the directory names the skill.
    expect(ok(GOOD, { path: "skills/pdf-filler/SKILL.md" }).id).toBe("pdf-filler");
  });

  it("defaults source to user and honours an override", () => {
    expect(ok(GOOD).source).toBe("user");
    expect(ok(GOOD, { source: "builtin" }).source).toBe("builtin");
  });

  it("leaves allowedTools undefined when unspecified", () => {
    const s = ok(`---
name: X
description: Y
---

Body.`);
    expect(s.allowedTools).toBeUndefined();
  });

  // An empty list is a real declaration — "use no tools" — and must not be
  // conflated with "unrestricted".
  it("distinguishes an empty allowed-tools list from an absent one", () => {
    const s = ok(`---
name: X
description: Y
allowed-tools: []
---

Body.`);
    expect(s.allowedTools).toEqual([]);
  });

  it("accepts a bare comma-separated allowed-tools", () => {
    const s = ok(`---
name: X
description: Y
allowed-tools: web_search, memory
---

Body.`);
    expect(s.allowedTools).toEqual(["web_search", "memory"]);
  });

  it("strips quotes from scalars", () => {
    const s = ok(`---
name: "My Skill"
description: 'Use for things.'
---

Body.`);
    expect(s.name).toBe("My Skill");
    expect(s.description).toBe("Use for things.");
  });

  it("ignores blank and comment lines in frontmatter", () => {
    const s = ok(`---
# a comment
name: X

description: Y
---

Body.`);
    expect(s.name).toBe("X");
  });

  it("handles CRLF line endings", () => {
    const s = ok("---\r\nname: X\r\ndescription: Y\r\n---\r\n\r\nBody.");
    expect(s.body).toBe("Body.");
  });

  it("keeps markdown structure in the body intact", () => {
    const s = ok(`---
name: X
description: Y
---

# Heading

- one
- two

\`\`\`js
const a = 1;
\`\`\``);
    expect(s.body).toContain("# Heading");
    expect(s.body).toContain("const a = 1;");
  });
});

describe("parseSkillMd — rejections", () => {
  it("rejects missing frontmatter and says what is needed", () => {
    const e = err("Just a body with no frontmatter.");
    expect(e).toContain("frontmatter");
    expect(e).toContain("name");
  });

  it("rejects a missing name", () => {
    expect(err(`---\ndescription: Y\n---\n\nBody.`)).toContain("`name`");
  });

  // The description is the entire basis on which the model decides to invoke a
  // skill, so a skill without one is inert rather than merely incomplete.
  it("rejects a missing description and explains why it matters", () => {
    const e = err(`---\nname: X\n---\n\nBody.`);
    expect(e).toContain("`description`");
    expect(e).toContain("when to use");
  });

  it("rejects an empty body", () => {
    expect(err(`---\nname: X\ndescription: Y\n---\n`)).toContain("empty");
  });

  it("rejects an over-long description, since it is always in context", () => {
    const e = err(`---\nname: X\ndescription: ${"d".repeat(MAX_DESCRIPTION_CHARS + 1)}\n---\n\nBody.`);
    expect(e).toContain("every request");
  });

  it("rejects an over-long body", () => {
    expect(err(`---\nname: X\ndescription: Y\n---\n\n${"b".repeat(MAX_SKILL_BODY_CHARS + 1)}`)).toContain(
      "over the",
    );
  });

  // A typo'd key would otherwise fail the required-field check with a message
  // about a field that looks present in the file.
  it("names an unknown frontmatter key instead of ignoring it", () => {
    const e = err(`---\nname: X\ndescripton: Y\n---\n\nBody.`);
    expect(e).toContain("descripton");
  });

  it("rejects an unparseable frontmatter line", () => {
    expect(err(`---\nname: X\nthis is not a key value\n---\n\nBody.`)).toContain("Could not parse");
  });

  it("rejects a name that cannot produce an id", () => {
    expect(err(`---\nname: "!!!"\ndescription: Y\n---\n\nBody.`)).toContain("id");
  });
});

describe("toSkillMd", () => {
  it("round-trips through the parser unchanged", () => {
    const first = ok(GOOD);
    const second = ok(toSkillMd(first));
    expect(second.name).toBe(first.name);
    expect(second.description).toBe(first.description);
    expect(second.body).toBe(first.body);
    expect(second.allowedTools).toEqual(first.allowedTools);
    expect(second.version).toBe(first.version);
  });

  it("omits optional keys that are not set", () => {
    const md = toSkillMd(ok(`---\nname: X\ndescription: Y\n---\n\nBody.`));
    expect(md).not.toContain("allowed-tools");
    expect(md).not.toContain("version");
  });

  it("round-trips an empty allowed-tools list", () => {
    const s = ok(`---\nname: X\ndescription: Y\nallowed-tools: []\n---\n\nBody.`);
    expect(ok(toSkillMd(s)).allowedTools).toEqual([]);
  });
});
