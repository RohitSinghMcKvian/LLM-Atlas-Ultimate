import { NextRequest } from "next/server";
import {
  contentsUrl,
  describeStatus,
  githubHeaders,
  isGithubError,
  normalizeRepoPath,
  parseContents,
  parseRepoRef,
} from "@/lib/github/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only GitHub proxy.
 *
 * Exists for the same reason as the MCP proxy in P6: the browser cannot send a
 * token to api.github.com without exposing it to every script on the page, and
 * §1.3 permits a thin stateless forwarder. The token arrives per-request in
 * `x-github-token`, is used once, and is never stored, logged or echoed.
 *
 * Unlike the MCP proxy this needs no SSRF guard, because the destination is not
 * user-controlled: the host is always api.github.com and the owner, repo, ref
 * and path are each validated against GitHub's own naming rules before they
 * become URL segments. That is the property to preserve — the moment this route
 * accepts a caller-supplied URL it acquires the same SSRF surface, and would need
 * `lib/mcp/url-guard.ts` with it.
 */

const TIMEOUT_MS = 15_000;

interface Body {
  /** "owner/repo", or a github.com URL. */
  repo?: string;
  /** Path inside the repository. Empty lists the root. */
  path?: string;
  /** Branch, tag or SHA. Overrides one parsed from a URL. */
  ref?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const repoRef = parseRepoRef(String(body.repo ?? ""));
  if (isGithubError(repoRef)) return Response.json(repoRef, { status: 400 });
  if (body.ref) {
    const withRef = parseRepoRef(`${repoRef.owner}/${repoRef.repo}`);
    if (isGithubError(withRef)) return Response.json(withRef, { status: 400 });
    if (!/^[A-Za-z0-9._/-]{1,255}$/.test(body.ref)) {
      return Response.json({ error: "That ref contains characters GitHub does not allow." }, { status: 400 });
    }
    repoRef.ref = body.ref;
  }

  const path = normalizeRepoPath(String(body.path ?? ""));
  if (isGithubError(path)) return Response.json(path, { status: 400 });

  const token = req.headers.get("x-github-token")?.trim() || undefined;

  try {
    const res = await fetch(contentsUrl(repoRef, path), {
      method: "GET",
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // A redirect from api.github.com would be a second URL that never passed
      // the validation above.
      redirect: "manual",
      cache: "no-store",
    });

    if (!res.ok) {
      // GitHub's own status, described — not its error body, which can echo the
      // request and is not something to relay verbatim.
      return Response.json({ error: describeStatus(res.status, repoRef, path) });
    }

    const parsed = parseContents(await res.json(), path);
    if (isGithubError(parsed)) return Response.json(parsed);
    return Response.json(
      Array.isArray(parsed) ? { entries: parsed } : { file: parsed },
    );
  } catch (e) {
    const aborted = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    return Response.json({
      error: aborted ? "GitHub did not respond in time." : "Could not reach GitHub.",
    });
  }
}
