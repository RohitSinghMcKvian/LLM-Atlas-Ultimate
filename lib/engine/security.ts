// Secret scanner (Depth Spec v2 B.6): block API keys, tokens, and private
// keys from being written into workspace files. Pure and unit-tested; the
// agent's executeTool write/edit path invokes scanSecrets and refuses on a
// hit with an explanatory result.

export interface SecretFinding {
  kind: string;
  /** Redacted excerpt — never the full secret. */
  excerpt: string;
}

interface SecretRule {
  kind: string;
  re: RegExp;
}

const RULES: SecretRule[] = [
  { kind: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "AWS secret access key", re: /\baws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+]{40}['"]?/i },
  { kind: "OpenAI / Atlas key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { kind: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { kind: "Stripe secret key", re: /\b[sr]k_live_[0-9A-Za-z]{24,}\b/ },
  { kind: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    kind: "generic assigned secret",
    re: /\b(?:api[_-]?key|secret|password|passwd|token|access[_-]?token)\s*[=:]\s*['"][^'"\s]{16,}['"]/i,
  },
];

function redact(match: string): string {
  if (match.length <= 8) return "****";
  return `${match.slice(0, 4)}…${match.slice(-2)}`;
}

/**
 * Scan file content for secrets. Files that legitimately hold placeholders
 * (e.g. `.env.example`) are exempted by the caller, not here.
 */
export function scanSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    const m = rule.re.exec(content);
    if (m && !seen.has(rule.kind)) {
      seen.add(rule.kind);
      findings.push({ kind: rule.kind, excerpt: redact(m[0]) });
    }
  }
  return findings;
}

/** Paths where secret-like strings are expected and should not be blocked. */
const EXEMPT = /(?:^|[\\/])(?:\.env\.example|\.env\.sample|.*\.md|.*\.mdx|.*\.lock)$/i;

export function shouldScanPath(path: string): boolean {
  return !EXEMPT.test(path);
}

/** Model-facing refusal message when a write is blocked. */
export function describeSecretBlock(path: string, findings: SecretFinding[]): string {
  const list = findings.map((f) => `${f.kind} (${f.excerpt})`).join(", ");
  return `Blocked: writing ${path} would commit ${findings.length} likely secret${
    findings.length === 1 ? "" : "s"
  } — ${list}. Do not hard-code credentials; use an environment variable or a placeholder, or ask the user.`;
}
