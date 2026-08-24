import { describe, expect, it } from "vitest";
import { MCP_PROTOCOL_VERSION } from "./protocol";
import {
  ATLAS_SERVER_INFO,
  ERRORS,
  JSONRPC_VERSION,
  MAX_TOOL_RESULT_CHARS,
  callParamsSchema,
  failure,
  initializeResult,
  isSupportedMethod,
  parseRequest,
  success,
  toolCallResult,
  toolsListResult,
} from "./server-protocol";

describe("parseRequest", () => {
  it("accepts a well-formed call", () => {
    const r = parseRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.method).toBe("tools/list");
      expect(r.isNotification).toBe(false);
    }
  });

  it("recognises a notification, which gets no response at all", () => {
    const r = parseRequest({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.isNotification).toBe(true);
  });

  it("distinguishes a null id from an absent one", () => {
    // `id: null` is a request that wants an answer; no id at all is a
    // notification. Treating them alike is a protocol violation either way.
    const withNull = parseRequest({ jsonrpc: "2.0", id: null, method: "ping" });
    expect(withNull.ok && withNull.isNotification).toBe(false);
  });

  it("rejects a wrong version, a missing method and a non-object", () => {
    for (const bad of [
      { jsonrpc: "1.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 1 },
      "not an object",
      null,
      42,
    ]) {
      const r = parseRequest(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(ERRORS.invalidRequest);
    }
  });

  it("keeps the id from a malformed request, so the client can match the error", () => {
    const r = parseRequest({ jsonrpc: "1.0", id: 7, method: "ping" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.id).toBe(7);
  });

  it("never throws", () => {
    for (const bad of [undefined, [], { jsonrpc: 2 }, { method: 5 }]) {
      expect(() => parseRequest(bad)).not.toThrow();
    }
  });
});

describe("envelopes", () => {
  it("stamps the version on both shapes", () => {
    expect(success(1, { a: 1 })).toEqual({ jsonrpc: JSONRPC_VERSION, id: 1, result: { a: 1 } });
    expect(failure(1, { code: -1, message: "x" })).toMatchObject({ jsonrpc: JSONRPC_VERSION, id: 1 });
  });
});

describe("initializeResult", () => {
  it("agrees with the client half about the protocol version", () => {
    expect(initializeResult().protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it("declares only the capability it implements", () => {
    const caps = initializeResult().capabilities;
    expect(caps).toEqual({ tools: {} });
    // Declaring resources or prompts would have clients calling methods that
    // will always fail.
    expect("resources" in caps).toBe(false);
    expect("prompts" in caps).toBe(false);
  });

  it("tells a client to use the tools rather than recall specifications", () => {
    expect(initializeResult().instructions).toContain("changes weekly");
    expect(ATLAS_SERVER_INFO.name).toBe("llm-atlas");
  });
});

describe("tools/list", () => {
  it("returns no cursor, because there is no second page", () => {
    const r = toolsListResult([{ name: "a", description: "d", inputSchema: { type: "object" } }]);
    expect(r.tools).toHaveLength(1);
    expect("nextCursor" in r).toBe(false);
  });

  it("handles an empty set", () => {
    expect(toolsListResult([]).tools).toEqual([]);
  });
});

describe("toolCallResult", () => {
  it("wraps text in MCP content", () => {
    expect(toolCallResult("hello")).toEqual({
      content: [{ type: "text", text: "hello" }],
      isError: false,
    });
  });

  it("marks a tool failure without making it a protocol failure", () => {
    // The distinction matters: the first is something the model can react to,
    // the second is something the client has to handle.
    expect(toolCallResult("nope", true).isError).toBe(true);
  });

  it("clips a very long result and says it clipped", () => {
    const r = toolCallResult("x".repeat(MAX_TOOL_RESULT_CHARS + 500));
    expect(r.content[0].text.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS + 20);
    expect(r.content[0].text).toContain("(truncated)");
  });
});

describe("method allowlist", () => {
  it("accepts exactly what Atlas implements", () => {
    for (const m of ["initialize", "tools/list", "tools/call", "ping", "notifications/initialized"]) {
      expect(isSupportedMethod(m)).toBe(true);
    }
  });

  it("rejects everything else, rather than succeeding quietly", () => {
    for (const m of ["resources/list", "prompts/get", "sampling/createMessage", "", "TOOLS/LIST"]) {
      expect(isSupportedMethod(m)).toBe(false);
    }
  });
});

describe("callParamsSchema", () => {
  it("requires a tool name", () => {
    expect(callParamsSchema.safeParse({}).success).toBe(false);
    expect(callParamsSchema.safeParse({ name: "atlas_graph" }).success).toBe(true);
  });

  it("accepts arguments as an object, and nothing else", () => {
    expect(callParamsSchema.safeParse({ name: "x", arguments: { a: 1 } }).success).toBe(true);
    expect(callParamsSchema.safeParse({ name: "x", arguments: "no" }).success).toBe(false);
  });
});
