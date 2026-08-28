import { describe, expect, it } from "vitest";
import { needsProviderBanner } from "./dock-errors";

describe("needsProviderBanner", () => {
  it("is true for the two codes that mean no route exists yet", () => {
    expect(needsProviderBanner("no_provider_configured")).toBe(true);
    expect(needsProviderBanner("key_required")).toBe(true);
  });

  it("is false for a route that existed and then failed", () => {
    expect(needsProviderBanner("rate_limited")).toBe(false);
    expect(needsProviderBanner("route_dead")).toBe(false);
    expect(needsProviderBanner("provider_key_invalid")).toBe(false);
    expect(needsProviderBanner("all_routes_timed_out")).toBe(false);
  });

  it("is false with no code at all", () => {
    expect(needsProviderBanner(undefined)).toBe(false);
  });
});
