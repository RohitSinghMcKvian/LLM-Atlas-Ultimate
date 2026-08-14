import { NextRequest } from "next/server";
import { lookup } from "node:dns/promises";
import { addressesArePublic, guardConnectorUrl } from "@/lib/mcp/url-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin, stateless proxy for MCP connectors (spec §1.3's CORS escape hatch).
 *
 * Why it exists: MCP servers are third-party origins and almost none of them
 * send CORS headers permitting a browser app, so the browser cannot talk to them
 * directly. §1.3 allows exactly this — "a THIN STATELESS proxy Route Handler
 * that forwards the user's key WITHOUT logging it."
 *
 * The contract, which the rest of this file exists to keep:
 *
 *  - **Stateless.** No session, no cache, no database. One request in, one out.
 *  - **The token is never stored, logged, or echoed.** It is read from the
 *    request header, put on the outbound request, and forgotten. Nothing in this
 *    file writes it anywhere, and errors are constructed from the guard's own
 *    strings rather than from the request.
 *  - **The target is validated before it is fetched**, in two layers — see
 *    lib/mcp/url-guard.ts. This route is a server-side fetch of a user-supplied
 *    URL, which is an SSRF primitive unless it refuses private targets.
 *
 * `nodejs` runtime, not edge, specifically so DNS resolution is available: the
 * string checks alone cannot catch a public hostname whose A record points at
 * 10.0.0.5.
 */

/** Cap the response Atlas will relay. A connector must not be able to OOM us. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** MCP calls are interactive; a connector that hangs must not hold a worker. */
const TIMEOUT_MS = 30_000;

interface ProxyBody {
  /** Connector endpoint. Validated, never trusted. */
  url: string;
  /** A JSON-RPC request object, passed through untouched. */
  body: unknown;
  /** MCP session id from a previous `initialize`, when the server issued one. */
  sessionId?: string;
  /** Protocol version to echo back, as the Streamable HTTP transport requires. */
  protocolVersion?: string;
}

function bad(reason: string, status = 400) {
  return Response.json({ error: reason }, { status });
}

export async function POST(req: NextRequest) {
  let payload: ProxyBody;
  try {
    payload = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }
  if (typeof payload?.url !== "string" || payload.body === undefined) {
    return bad("url and body are required");
  }

  // Layer 1: scheme, credentials, hostname and literal-IP rules.
  const guard = guardConnectorUrl(payload.url);
  if (!guard.ok || !guard.url) return bad(guard.reason ?? "Refused", 400);
  const target = guard.url;

  // Layer 2: what the name actually resolves to, checked across ALL records so a
  // host advertising one public and one private address is still refused.
  try {
    const records = await lookup(target.hostname, { all: true });
    if (!addressesArePublic(records.map((r) => r.address))) {
      return bad("That host resolves to a private or loopback address.", 400);
    }
  } catch {
    return bad("Could not resolve the connector host.", 400);
  }

  const token = req.headers.get("x-connector-token")?.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Both, per the Streamable HTTP transport: a server may answer either
        // with JSON or with an SSE stream, and refusing one closes off servers
        // that only speak the other.
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload.sessionId ? { "mcp-session-id": payload.sessionId } : {}),
        ...(payload.protocolVersion
          ? { "mcp-protocol-version": payload.protocolVersion }
          : {}),
      },
      body: JSON.stringify(payload.body),
      signal: controller.signal,
      // A redirect is a second URL that never passed the guard — the classic way
      // to turn a validated request into an unvalidated one. The client is told
      // rather than followed.
      redirect: "manual",
      cache: "no-store",
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      return bad("Connector redirected; Atlas does not follow redirects for connectors.", 502);
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const text = await upstream.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      return bad("Connector response was too large.", 502);
    }

    // The body is relayed verbatim and parsed by lib/mcp/protocol.ts on the
    // client, so this route never has to understand MCP — which is what keeps it
    // thin, and what keeps a protocol change from becoming a server deploy.
    return Response.json({
      status: upstream.status,
      contentType,
      sessionId: upstream.headers.get("mcp-session-id") ?? undefined,
      body: text,
    });
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    return bad(
      aborted ? `Connector did not respond within ${TIMEOUT_MS / 1000}s.` : "Could not reach the connector.",
      504,
    );
  } finally {
    clearTimeout(timer);
  }
}
