/**
 * GitHub reading for Atlas Chat (spec §4, GitHub integration).
 *
 * Scope is deliberately **read-only**. The `gitExport` flag has been declared and
 * unread since before P0, and writing to a user's repositories — opening a PR,
 * pushing a branch — is a side effect on a real account that needs the same
 * per-call approval design connectors got in P6. That is a phase of its own, not
 * a switch to flip, so this ships the half that is complete rather than a write
 * path with no gate.
 *
 * Everything here is pure: URL construction, path validation, and response
 * shaping. Fetching happens in the route, which owns the token — so the parsing
 * of untrusted API responses is testable without a network or a credential.
 */

export const GITHUB_API = "https://api.github.com";

/** Cap on a single file read, so one blob cannot fill the context window. */
export const MAX_FILE_BYTES = 128 * 1024;
/** Cap on a directory listing. */
export const MAX_TREE_ENTRIES = 500;

export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or SHA. Undefined means the repository's default branch. */
  ref?: string;
}

export interface GithubError {
  error: string;
}

export function isGithubError<T>(r: T | GithubError): r is GithubError {
  return typeof r === "object" && r !== null && "error" in r;
}

/**
 * Parse the repository forms a user or model will actually write.
 *
 * Accepts `owner/repo`, a full HTTPS URL, and a URL with a `/tree/<ref>/…`
 * suffix, because those are what people paste. Anything else is rejected rather
 * than guessed at — a misparsed owner would send a token-bearing request to the
 * wrong account.
 */
export function parseRepoRef(input: string): RepoRef | GithubError {
  const raw = input.trim();
  if (!raw) return { error: "No repository given." };

  let owner: string | undefined;
  let repo: string | undefined;
  let ref: string | undefined;

  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { error: "Not a valid GitHub URL." };
    }
    if (url.hostname.toLowerCase().replace(/^www\./, "") !== "github.com") {
      return { error: "Only github.com repositories are supported." };
    }
    const parts = url.pathname.split("/").filter(Boolean);
    [owner, repo] = parts;
    // /owner/repo/tree/<ref>/optional/path
    if (parts[2] === "tree" && parts[3]) ref = parts[3];
  } else {
    const parts = raw.split("/").filter(Boolean);
    if (parts.length < 2) return { error: 'Use "owner/repo".' };
    [owner, repo] = parts;
  }

  if (!owner || !repo) return { error: 'Could not read an "owner/repo" from that.' };
  repo = repo.replace(/\.git$/i, "");

  // GitHub's own rules. Validated because these become path segments in a
  // request that carries the user's token.
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
    return { error: `"${owner}" is not a valid GitHub owner name.` };
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    return { error: `"${repo}" is not a valid repository name.` };
  }
  if (ref && !/^[A-Za-z0-9._\/-]{1,255}$/.test(ref)) {
    return { error: "That ref contains characters GitHub does not allow." };
  }

  return { owner, repo, ...(ref ? { ref } : {}) };
}

/**
 * Validate a path inside a repository.
 *
 * The same confinement reasoning as the memory filesystem in P4: the model
 * chooses these strings, so `../` must not resolve upward, and a leading slash
 * or a protocol-ish prefix must not turn a path segment into a different URL.
 */
export function normalizeRepoPath(input: string): string | GithubError {
  const raw = input.trim().replace(/^\/+/, "");
  if (raw === "") return "";
  if (raw.includes("\\")) return { error: "Use forward slashes in repository paths." };
  // eslint-disable-next-line no-control-regex -- rejecting control chars is the point
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { error: "Path contains control characters." };

  const out: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return { error: "Path escapes the repository." };
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}

/** Build a contents API URL. Path segments are encoded, the ref is a query. */
export function contentsUrl(ref: RepoRef, path: string): string {
  const encoded = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const url = new URL(
    `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${encoded}`,
  );
  if (ref.ref) url.searchParams.set("ref", ref.ref);
  return url.toString();
}

export function repoUrl(ref: RepoRef): string {
  return `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
}

/** Headers for a GitHub API call. The token is a header, never a query param. */
export function githubHeaders(token?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface RepoFile {
  path: string;
  text: string;
  truncated: boolean;
}

export interface TreeEntry {
  path: string;
  type: "file" | "dir";
  size?: number;
}

function decodeBase64(b64: string): string {
  const clean = b64.replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const bytes = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(clean, "base64").toString("utf8");
}

/**
 * Read a contents response, which is either a file object or a directory array.
 *
 * Binary files are named rather than decoded: a PNG rendered as mojibake into a
 * tool result is noise the model cannot use and cannot tell apart from text.
 */
export function parseContents(
  body: unknown,
  path: string,
): RepoFile | TreeEntry[] | GithubError {
  if (Array.isArray(body)) {
    const entries: TreeEntry[] = [];
    for (const row of body.slice(0, MAX_TREE_ENTRIES)) {
      if (typeof row !== "object" || row === null) continue;
      const r = row as Record<string, unknown>;
      const type = r.type === "dir" ? "dir" : r.type === "file" ? "file" : null;
      if (!type || typeof r.path !== "string") continue;
      entries.push({
        path: r.path,
        type,
        ...(typeof r.size === "number" ? { size: r.size } : {}),
      });
    }
    return entries;
  }

  if (typeof body !== "object" || body === null) {
    return { error: "Unexpected response from GitHub." };
  }
  const r = body as Record<string, unknown>;
  if (r.type !== "file") {
    return { error: `"${path}" is not a readable file.` };
  }
  if (typeof r.size === "number" && r.size > MAX_FILE_BYTES) {
    return { error: `"${path}" is ${r.size} bytes, over the ${MAX_FILE_BYTES}-byte read limit.` };
  }
  if (r.encoding !== "base64" || typeof r.content !== "string") {
    // GitHub omits content for large files and points at the blob API instead.
    return { error: `"${path}" could not be read as text.` };
  }

  let text: string;
  try {
    text = decodeBase64(r.content);
  } catch {
    return { error: `"${path}" could not be decoded.` };
  }
  if (text.includes("\u0000")) {
    return { error: `"${path}" looks like a binary file.` };
  }
  const truncated = text.length > MAX_FILE_BYTES;
  return {
    path,
    text: truncated ? `${text.slice(0, MAX_FILE_BYTES)}\n…truncated` : text,
    truncated,
  };
}

/** Turn a GitHub HTTP status into something a model can act on. */
export function describeStatus(status: number, ref: RepoRef, path: string): string {
  switch (status) {
    case 404:
      return (
        `Not found: ${ref.owner}/${ref.repo}${path ? `/${path}` : ""}. ` +
        "The repository may be private — connect a GitHub token to read it — or the path may be wrong."
      );
    case 401:
    case 403:
      return "GitHub rejected the credentials, or the rate limit was reached. Connect a token, or wait and retry.";
    case 451:
      return "GitHub has made that repository unavailable for legal reasons.";
    default:
      return `GitHub returned HTTP ${status}.`;
  }
}
