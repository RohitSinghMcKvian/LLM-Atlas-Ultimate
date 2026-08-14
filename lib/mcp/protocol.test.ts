import { describe, it, expect, beforeEach } from "vitest";
import {
  JSONRPC_VERSION,
  MAX_RESULT_CHARS,
  MCP_PROTOCOL_VERSION,
  flattenContent,
  initializeRequest,
  initializeResult,
  isFailure,
  isMcpToolName,
  namespacedToolName,
  parseResponse,
  parseSseBody,
  parseToolName,
  parseTransportBody,
  resetRequestIds,
  toolsCallRequest,
  toolsCallResult,
  toolsListRequest,
  toolsListResult,
} from "./protocol";

beforeEach(() => resetRequestIds());

const envelope = (result: unknown, id = 1) => ({ jsonrpc: JSONRPC_VERSION, id, result });

describe("request builders", () => {
  it("initialize declares the protocol version and client info", () => {
    const r = initializeRequest();
    expect(r.method).toBe("initialize");
    expect(r.params?.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(r.params?.clientInfo).toMatchObject({ name: "atlas-chat" });
  });

  // Atlas consumes tools; declaring capabilities it lacks invites calls it
  // cannot answer.
  it("initialize declares no server-facing capabilities", () => {
    expect(initializeRequest().params?.capabilities).toEqual({});
  });

  it("ids are unique across requests", () => {
    const ids = [initializeRequest().id, toolsListRequest().id, toolsCallRequest("x", {}).id];
    expect(new Set(ids).size).toBe(3);
  });

  it("tools/list omits params unless paginating", () => {
    expect(toolsListRequest().params).toBeUndefined();
    expect(toolsListRequest("abc").params).toEqual({ cursor: "abc" });
  });

  it("tools/call carries name and arguments, defaulting to an empty object", () => {
    expect(toolsCallRequest("send_email", { to: "a@b.c" }).params).toEqual({
      name: "send_email",
      arguments: { to: "a@b.c" },
    });
    expect(toolsCallRequest("ping", null).params?.arguments).toEqual({});
  });
});

describe("parseResponse", () => {
  it("returns the typed result", () => {
    const r = parseResponse(
      envelope({ protocolVersion: "2025-06-18", serverInfo: { name: "S", version: "1" } }),
      initializeResult,
    );
    expect(isFailure(r)).toBe(false);
    if (!isFailure(r)) expect(r.serverInfo.name).toBe("S");
  });

  // A connector is a third party; its response is untrusted input. Three failure
  // modes are kept apart because they mean different things.
  it("reports a non-JSON-RPC payload", () => {
    const r = parseResponse({ hello: "world" }, initializeResult);
    expect(isFailure(r) && r.error).toContain("JSON-RPC");
  });

  it("surfaces a JSON-RPC error with its code", () => {
    const r = parseResponse(
      { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } },
      initializeResult,
    );
    expect(isFailure(r)).toBe(true);
    if (isFailure(r)) {
      expect(r.error).toBe("Method not found");
      expect(r.code).toBe(-32601);
    }
  });

  it("reports an envelope with neither result nor error", () => {
    const r = parseResponse({ jsonrpc: "2.0", id: 1 }, initializeResult);
    expect(isFailure(r) && r.error).toContain("neither");
  });

  it("reports a result whose shape does not match, naming the field", () => {
    const r = parseResponse(envelope({ protocolVersion: 42 }), initializeResult);
    expect(isFailure(r) && r.error).toContain("protocolVersion");
  });

  it("does not throw on a malformed tools list", () => {
    const r = parseResponse(envelope({ tools: [{ description: "no name" }] }), toolsListResult);
    expect(isFailure(r)).toBe(true);
  });

  it("defaults an absent tool description and schema", () => {
    const r = parseResponse(envelope({ tools: [{ name: "t" }] }), toolsListResult);
    expect(isFailure(r)).toBe(false);
    if (!isFailure(r)) {
      expect(r.tools[0].description).toBe("");
      expect(r.tools[0].inputSchema).toEqual({ type: "object" });
    }
  });
});

describe("parseSseBody", () => {
  it("reads a single data line", () => {
    const body = `data: ${JSON.stringify(envelope({ tools: [] }))}\n\n`;
    expect(parseSseBody(body)).toMatchObject({ jsonrpc: "2.0" });
  });

  // A server may emit progress notifications first; taking the first data line
  // would hand back a notification as if it were the answer.
  it("takes the LAST JSON-RPC payload, not the first", () => {
    const body = [
      `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}`,
      `data: ${JSON.stringify(envelope({ tools: [{ name: "final" }] }))}`,
      "",
    ].join("\n");
    const parsed = parseSseBody(body) as { result: { tools: { name: string }[] } };
    expect(parsed.result.tools[0].name).toBe("final");
  });

  it("ignores comments, blanks and [DONE]", () => {
    const body = [": keepalive", "data:", "data: [DONE]", ""].join("\n");
    expect(parseSseBody(body)).toBeNull();
  });

  it("survives a partial or non-JSON data line", () => {
    const body = ["data: {broken", `data: ${JSON.stringify(envelope({ tools: [] }))}`].join("\n");
    expect(parseSseBody(body)).toMatchObject({ jsonrpc: "2.0" });
  });
});

describe("parseTransportBody", () => {
  it("parses plain JSON", () => {
    expect(parseTransportBody("application/json", JSON.stringify(envelope({})))).toMatchObject({
      jsonrpc: "2.0",
    });
  });

  it("parses SSE", () => {
    const body = `data: ${JSON.stringify(envelope({}))}\n`;
    expect(parseTransportBody("text/event-stream; charset=utf-8", body)).toMatchObject({
      jsonrpc: "2.0",
    });
  });

  it("returns null for an HTML error page rather than throwing", () => {
    expect(parseTransportBody("text/html", "<html>404</html>")).toBeNull();
  });
});

describe("flattenContent", () => {
  const call = (raw: unknown) => {
    const r = toolsCallResult.parse(raw);
    return flattenContent(r);
  };

  it("joins text blocks", () => {
    expect(call({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe(
      "a\nb",
    );
  });

  // A base64 image inlined into a tool message would blow the context window for
  // a model that mostly cannot read it there anyway.
  it("names binary blocks instead of embedding them", () => {
    const out = call({
      content: [{ type: "image", mimeType: "image/png", data: "AAAA".repeat(5000) }],
    });
    expect(out).toContain("image omitted");
    expect(out).not.toContain("AAAA");
  });

  it("keeps a resource link's URI, which is the actionable part", () => {
    expect(call({ content: [{ type: "resource_link", uri: "file:///x.txt" }] })).toContain(
      "file:///x.txt",
    );
  });

  it("uses embedded resource text when present", () => {
    expect(
      call({ content: [{ type: "resource", resource: { uri: "u", text: "inner" } }] }),
    ).toBe("inner");
  });

  it("keeps an unknown block type as a placeholder rather than dropping it", () => {
    expect(call({ content: [{ type: "video" }] })).toContain("video content omitted");
  });

  it("falls back to structuredContent when content is empty", () => {
    expect(call({ content: [], structuredContent: { ok: true } })).toBe('{"ok":true}');
  });

  it("says so when there is nothing at all", () => {
    expect(call({ content: [] })).toBe("The tool returned no content.");
  });

  it("truncates a huge result", () => {
    const out = call({ content: [{ type: "text", text: "x".repeat(MAX_RESULT_CHARS + 500) }] });
    expect(out.length).toBeLessThan(MAX_RESULT_CHARS + 100);
    expect(out).toContain("truncated");
  });

  it("preserves isError from the server", () => {
    expect(toolsCallResult.parse({ content: [], isError: true }).isError).toBe(true);
  });
});

describe("tool namespacing", () => {
  it("round-trips", () => {
    const n = namespacedToolName("github", "create_issue");
    expect(n).toBe("mcp__github__create_issue");
    expect(parseToolName(n)).toEqual({ connectorId: "github", toolName: "create_issue" });
  });

  // Without namespacing a connector could ship `web_search` and intercept calls
  // the user believes are local.
  it("cannot collide with a built-in tool name", () => {
    expect(isMcpToolName("web_search")).toBe(false);
    expect(isMcpToolName("memory")).toBe(false);
    expect(isMcpToolName("skill")).toBe(false);
  });

  it("keeps a tool name containing the separator intact", () => {
    const n = namespacedToolName("srv", "a__b");
    expect(parseToolName(n)).toEqual({ connectorId: "srv", toolName: "a__b" });
  });

  it.each(["mcp__", "mcp____x", "mcp__nosep", "notmcp__a__b", ""])(
    "rejects malformed name %j",
    (n) => {
      expect(parseToolName(n)).toBeNull();
    },
  );
});
