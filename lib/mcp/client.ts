"use client";

import {
  MCP_PROTOCOL_VERSION,
  flattenContent,
  initializeRequest,
  initializeResult,
  isFailure,
  parseResponse,
  parseTransportBody,
  toolsCallRequest,
  toolsCallResult,
  toolsListRequest,
  toolsListResult,
  type JsonRpcRequest,
  type McpFailure,
  type McpTool,
} from "./protocol";
import { connectorToken, updateConnector, type Connector } from "./registry";

/**
 * MCP client over the stateless proxy (`/api/v1/mcp`).
 *
 * The browser cannot reach most MCP servers directly — they are third-party
 * origins without CORS — so every request goes through the proxy, which validates
 * the target and forwards the token without storing it. This module is the client
 * half: it decides *what* to send and interprets what comes back, and knows
 * nothing about how the proxy protects itself.
 *
 * Deliberately not a persistent SSE session. The Streamable HTTP transport allows
 * a long-lived stream for server-initiated messages; Atlas uses the
 * request/response half only. A held-open connection per connector would burn a
 * server worker each on the free tier (§1.7) to receive notifications Atlas has
 * nothing to do with — it consumes tools, and tools are request/response.
 */

const PROXY_URL = "/api/v1/mcp";

interface ProxyResponse {
  status: number;
  contentType: string;
  sessionId?: string;
  body: string;
}

/** Send one JSON-RPC request through the proxy and return the parsed envelope. */
async function send(
  connector: Pick<Connector, "id" | "url" | "sessionId" | "protocolVersion">,
  request: JsonRpcRequest,
  opts: { token?: string; signal?: AbortSignal } = {},
): Promise<{ raw: unknown; sessionId?: string } | McpFailure> {
  let res: Response;
  try {
    res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The token rides in a header, never in the JSON body — a body is the
        // kind of thing that ends up in a log line by accident.
        ...(opts.token ? { "x-connector-token": opts.token } : {}),
      },
      body: JSON.stringify({
        url: connector.url,
        body: request,
        sessionId: connector.sessionId,
        protocolVersion: connector.protocolVersion ?? MCP_PROTOCOL_VERSION,
      }),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { error: "Could not reach the Atlas connector proxy." };
  }

  if (!res.ok) {
    // The proxy's refusals (SSRF guard, timeout) are already user-safe strings.
    const detail = await res.json().catch(() => ({ error: `Proxy error ${res.status}` }));
    return { error: String((detail as { error?: string }).error ?? `Proxy error ${res.status}`) };
  }

  const payload = (await res.json()) as ProxyResponse;
  if (payload.status === 401 || payload.status === 403) {
    return { error: "The connector rejected the credentials. Reconnect it to re-authorise." };
  }
  if (payload.status >= 400) {
    return { error: `Connector returned HTTP ${payload.status}.` };
  }

  const raw = parseTransportBody(payload.contentType, payload.body);
  if (raw === null) {
    return { error: "Connector response was not JSON-RPC. Is that URL an MCP endpoint?" };
  }
  return { raw, sessionId: payload.sessionId };
}

/**
 * Handshake with a connector.
 *
 * Records the negotiated protocol version and any session id, both of which the
 * transport requires on subsequent requests.
 */
export async function initializeConnector(
  connector: Connector,
  opts: { signal?: AbortSignal } = {},
): Promise<{ serverName: string; protocolVersion: string } | McpFailure> {
  const token = await connectorToken(connector.id);
  const sent = await send(connector, initializeRequest(), { token, signal: opts.signal });
  if (isFailure(sent)) return sent;

  const result = parseResponse(sent.raw, initializeResult);
  if (isFailure(result)) return result;

  await updateConnector(connector.id, {
    protocolVersion: result.protocolVersion,
    sessionId: sent.sessionId,
    lastError: undefined,
  });
  return {
    serverName: result.serverInfo.name || connector.name,
    protocolVersion: result.protocolVersion,
  };
}

/** Cap on pagination, so a misbehaving server cannot loop forever. */
const MAX_TOOL_PAGES = 10;

/** Discover a connector's tools, following cursors, and cache them. */
export async function discoverTools(
  connector: Connector,
  opts: { signal?: AbortSignal } = {},
): Promise<McpTool[] | McpFailure> {
  const token = await connectorToken(connector.id);
  const tools: McpTool[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const sent = await send(connector, toolsListRequest(cursor), { token, signal: opts.signal });
    if (isFailure(sent)) return sent;
    const result = parseResponse(sent.raw, toolsListResult);
    if (isFailure(result)) return result;
    tools.push(...result.tools);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }

  await updateConnector(connector.id, { tools, lastError: undefined });
  return tools;
}

/**
 * Call one tool.
 *
 * Two failure modes are kept apart because they mean different things to the
 * model: a protocol/transport failure (the connector is unreachable or refused)
 * and `isError` on an otherwise valid result (the tool ran and reported failure).
 * The second is something the model can reason about and retry differently; the
 * first is not.
 */
export async function callConnectorTool(
  connector: Connector,
  toolName: string,
  args: unknown,
  opts: { signal?: AbortSignal } = {},
): Promise<{ content: string; isError: boolean }> {
  const token = await connectorToken(connector.id);
  const sent = await send(connector, toolsCallRequest(toolName, args), {
    token,
    signal: opts.signal,
  });
  if (isFailure(sent)) {
    void updateConnector(connector.id, { lastError: sent.error });
    return { content: sent.error, isError: true };
  }

  const result = parseResponse(sent.raw, toolsCallResult);
  if (isFailure(result)) {
    void updateConnector(connector.id, { lastError: result.error });
    return { content: result.error, isError: true };
  }

  return { content: flattenContent(result), isError: result.isError };
}

/** Connect and discover in one step, for the "Add connector" flow. */
export async function connectAndDiscover(
  connector: Connector,
  opts: { signal?: AbortSignal } = {},
): Promise<{ serverName: string; tools: McpTool[] } | McpFailure> {
  const init = await initializeConnector(connector, opts);
  if (isFailure(init)) {
    await updateConnector(connector.id, { lastError: init.error });
    return init;
  }
  // Re-read so the session id recorded by `initialize` is on the object used for
  // the tools/list request; servers that issue one reject requests without it.
  const { getConnector } = await import("./registry");
  const fresh = (await getConnector(connector.id)) ?? connector;
  const tools = await discoverTools(fresh, opts);
  if (isFailure(tools)) {
    await updateConnector(connector.id, { lastError: tools.error });
    return tools;
  }
  return { serverName: init.serverName, tools };
}
