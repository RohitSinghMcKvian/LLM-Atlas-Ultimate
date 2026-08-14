import { describe, it, expect } from "vitest";
import {
  expireNegatives,
  NEGATIVE_TTL_MS,
  rejectsTools,
  shouldOfferTools,
  toolSupportFor,
} from "./tool-support";
import type { CatalogModel } from "@/lib/catalog/types";

const model = (id: string, toolUse: boolean): CatalogModel =>
  ({
    id,
    name: id,
    capabilities: { toolUse, structuredOutput: false, reasoning: false, caching: false },
  }) as CatalogModel;

describe("toolSupportFor", () => {
  it("trusts a catalog claim of support", () => {
    expect(toolSupportFor(model("a", true))).toBe("yes");
  });

  // The bug this module exists for. `lib/catalog/sync/nvidia.ts` reconstructs a
  // model from its id and cannot confirm tool calling, so a `false` there means
  // "nobody checked" — not "this model has none". Reading it as the latter ran
  // the whole free NIM catalog with the agent loop switched off.
  it("reads an unclaimed capability as unknown, not as a refusal", () => {
    expect(toolSupportFor(model("a", false))).toBe("unknown");
  });

  it("reads a missing model as unknown", () => {
    expect(toolSupportFor(undefined)).toBe("unknown");
  });

  // Only an observed rejection is evidence, and it outranks the catalog in both
  // directions: it describes the route that actually served the user.
  it("lets a learned negative override a catalog claim of support", () => {
    expect(toolSupportFor(model("a", true), { a: Date.now() })).toBe("no");
  });

  it("ignores a negative past its TTL, so a provider can add support later", () => {
    const stale = Date.now() - NEGATIVE_TTL_MS - 1;
    expect(toolSupportFor(model("a", true), { a: stale })).toBe("yes");
    expect(toolSupportFor(model("a", false), { a: stale })).toBe("unknown");
  });

  it("does not confuse one model's negative with another's", () => {
    expect(toolSupportFor(model("b", false), { a: Date.now() })).toBe("unknown");
  });
});

describe("shouldOfferTools", () => {
  it("fails open: only a learned refusal withholds tools", () => {
    expect(shouldOfferTools("yes")).toBe(true);
    expect(shouldOfferTools("unknown")).toBe(true);
    expect(shouldOfferTools("no")).toBe(false);
  });
});

describe("rejectsTools", () => {
  // Bodies in the shape real providers return them.
  const NIM_EXTRA_INPUTS = JSON.stringify({
    detail: [{ loc: ["body", "tools"], msg: "Extra inputs are not permitted" }],
  });
  const OPENROUTER = JSON.stringify({
    error: { message: "No endpoints found that support tool use.", code: 404 },
  });
  const GROQ = JSON.stringify({
    error: { message: "tool_choice is not supported for this model", type: "invalid_request_error" },
  });
  const GOOGLE = JSON.stringify({
    error: { message: "Unknown field: tools", status: "INVALID_ARGUMENT" },
  });
  const NIM_UNSUPPORTED = JSON.stringify({
    object: "error",
    message: "This model does not support function calling.",
  });

  it("matches a provider refusing the field", () => {
    expect(rejectsTools(422, NIM_EXTRA_INPUTS)).toBe(true);
    expect(rejectsTools(400, GROQ)).toBe(true);
    expect(rejectsTools(400, GOOGLE)).toBe(true);
    expect(rejectsTools(400, NIM_UNSUPPORTED)).toBe(true);
  });

  it("only fires on the two statuses a compatibility refusal uses", () => {
    // 404 is a dead route, not a downgradeable request; retrying without tools
    // would waste a second call on a model that is simply gone.
    expect(rejectsTools(404, OPENROUTER)).toBe(false);
    expect(rejectsTools(500, NIM_UNSUPPORTED)).toBe(false);
    expect(rejectsTools(429, NIM_UNSUPPORTED)).toBe(false);
  });

  // The reason this matcher is stricter than `rejectsStreamOptions`: "tool"
  // appears throughout ordinary error prose, and treating any of these as "this
  // endpoint has no tool calling" would strip tools from a model that has them
  // AND write a 30-day negative off a single malformed request.
  it("ignores ordinary tool errors that are not a capability refusal", () => {
    const cases = [
      JSON.stringify({ error: { message: "Invalid tool_call_id: call_abc" } }),
      JSON.stringify({ error: { message: "tool call arguments were not valid JSON" } }),
      JSON.stringify({ error: { message: "messages with role 'tool' must follow a tool call" } }),
      JSON.stringify({ error: { message: "Unknown function name: get_wather" } }),
      JSON.stringify({ error: { message: "context length exceeded" } }),
    ];
    for (const body of cases) expect(rejectsTools(400, body)).toBe(false);
  });

  it("does not fire on a body that never mentions tools", () => {
    expect(rejectsTools(400, JSON.stringify({ error: "temperature must be <= 2" }))).toBe(false);
    expect(rejectsTools(400, "")).toBe(false);
  });
});

describe("expireNegatives", () => {
  it("drops entries past the TTL and keeps the rest", () => {
    const now = 1_000_000_000_000;
    const out = expireNegatives({ fresh: now - 1000, stale: now - NEGATIVE_TTL_MS - 1 }, now);
    expect(Object.keys(out)).toEqual(["fresh"]);
  });

  // Identity is the signal the store's rehydrate hook uses to decide whether to
  // write anything back, so it has to be stable when nothing changed.
  it("returns the same object when nothing expired", () => {
    const input = { a: Date.now() };
    expect(expireNegatives(input)).toBe(input);
  });

  it("handles an empty map", () => {
    const input = {};
    expect(expireNegatives(input)).toBe(input);
  });
});
