import { describe, expect, it } from "vitest";
import { applyProviderHeaders, parseResetAt, parseRetryAfter } from "./headers";
import { laneQuota, type LaneQuota } from "./lanes";

const NOW = Date.parse("2026-09-10T13:47:30.000Z");
const h = (init: Record<string, string>) => new Headers(init);

const requests = (used = 0, limit = 100): LaneQuota =>
  laneQuota("groq", { kind: "minute", unit: "requests", limit }, used, NOW);
const tokens = (used = 0, limit = 10_000): LaneQuota =>
  laneQuota("groq", { kind: "minute", unit: "tokens", limit }, used, NOW);

describe("parseResetAt", () => {
  it("reads the duration spellings providers actually send", () => {
    // Groq sends "2m59.56s"; OpenAI sends "6m0s" and "1s".
    expect(parseResetAt("1s", NOW)).toBe(NOW + 1_000);
    expect(parseResetAt("2m59.56s", NOW)).toBe(NOW + 179_560);
    expect(parseResetAt("6m0s", NOW)).toBe(NOW + 360_000);
    expect(parseResetAt("500ms", NOW)).toBe(NOW + 500);
    expect(parseResetAt("1h30m", NOW)).toBe(NOW + 5_400_000);
  });

  // A bare number is genuinely ambiguous between three meanings, and getting it
  // wrong is silent: a delta read as epoch ms would park the lane in 1970.
  it("disambiguates a bare number by magnitude", () => {
    expect(parseResetAt("60", NOW)).toBe(NOW + 60_000); // delta seconds
    expect(parseResetAt("1789047000", NOW)).toBe(1789047000 * 1000); // epoch seconds
    expect(parseResetAt("1789047000000", NOW)).toBe(1789047000000); // epoch ms
  });

  it("reads Anthropic's RFC 3339 timestamp", () => {
    expect(parseResetAt("2026-09-10T13:50:00Z", NOW)).toBe(Date.parse("2026-09-10T13:50:00Z"));
  });

  it("returns undefined for absent or unparseable values", () => {
    expect(parseResetAt(null, NOW)).toBeUndefined();
    expect(parseResetAt("", NOW)).toBeUndefined();
    expect(parseResetAt("   ", NOW)).toBeUndefined();
    expect(parseResetAt("soon", NOW)).toBeUndefined();
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP-dates", () => {
    expect(parseRetryAfter("30", NOW)).toBe(30_000);
    expect(parseRetryAfter("2026-09-10T13:48:00Z", NOW)).toBe(30_000);
  });

  it("floors a date already in the past at zero", () => {
    expect(parseRetryAfter("2026-09-10T13:00:00Z", NOW)).toBe(0);
  });
});

describe("applyProviderHeaders", () => {
  it("overrides the local estimate with the provider's own count", () => {
    // The whole point: the ledger thought 5 were spent, the provider says 90.
    const [q] = applyProviderHeaders(
      [requests(5, 100)],
      h({ "x-ratelimit-remaining-requests": "10", "x-ratelimit-limit-requests": "100" }),
      NOW,
    );
    expect(q.used).toBe(90);
  });

  it("adopts the provider's limit when the table has gone stale", () => {
    // Free tiers move. Deriving `used` against a stale ceiling would be wrong
    // twice over, so the provider's limit is taken as well as its remainder.
    const [q] = applyProviderHeaders(
      [requests(0, 100)],
      h({ "x-ratelimit-remaining-requests": "5", "x-ratelimit-limit-requests": "20" }),
      NOW,
    );
    expect(q.limit).toBe(20);
    expect(q.used).toBe(15);
  });

  it("reads Anthropic's header family", () => {
    const [q] = applyProviderHeaders(
      [requests(0, 100)],
      h({
        "anthropic-ratelimit-requests-remaining": "40",
        "anthropic-ratelimit-requests-limit": "50",
        "anthropic-ratelimit-requests-reset": "2026-09-10T13:50:00Z",
      }),
      NOW,
    );
    expect(q.used).toBe(10);
    expect(q.resetsAt).toBe(Date.parse("2026-09-10T13:50:00Z"));
  });

  it("reads OpenRouter's unsuffixed headers for request windows", () => {
    const [q] = applyProviderHeaders(
      [requests(0, 100)],
      h({ "x-ratelimit-remaining": "7", "x-ratelimit-limit": "50" }),
      NOW,
    );
    expect(q.used).toBe(43);
  });

  it("does not let OpenRouter's request headers describe a token window", () => {
    // `x-ratelimit-remaining` counts requests. Applying it to a token ceiling
    // would invent a token figure the provider never reported.
    const [q] = applyProviderHeaders(
      [tokens(120, 10_000)],
      h({ "x-ratelimit-remaining": "7", "x-ratelimit-limit": "50" }),
      NOW,
    );
    expect(q.used).toBe(120);
    expect(q.limit).toBe(10_000);
  });

  it("leaves a window the provider said nothing about untouched", () => {
    // Silence is not evidence. Zeroing an unreported window would free a lane
    // the ledger had correctly blocked.
    const before = requests(42, 100);
    const [after] = applyProviderHeaders([before], h({ "content-type": "application/json" }), NOW);
    expect(after).toEqual(before);
  });

  it("treats a bare Retry-After as the lane being spent now", () => {
    // The case where another deployment shares the operator's key: Atlas has
    // counted almost nothing, but the provider is already refusing.
    const [q] = applyProviderHeaders([requests(1, 100)], h({ "retry-after": "45" }), NOW);
    expect(q.used).toBeGreaterThanOrEqual(q.limit);
    expect(q.resetsAt).toBe(NOW + 45_000);
  });

  it("prefers explicit window headers over Retry-After", () => {
    const [q] = applyProviderHeaders(
      [requests(1, 100)],
      h({ "retry-after": "45", "x-ratelimit-remaining-requests": "30" }),
      NOW,
    );
    expect(q.used).toBe(70);
  });

  it("clamps a remainder above the limit rather than reporting negative use", () => {
    const [q] = applyProviderHeaders(
      [requests(0, 100)],
      h({ "x-ratelimit-remaining-requests": "150", "x-ratelimit-limit-requests": "100" }),
      NOW,
    );
    expect(q.used).toBe(0);
  });

  it("does not mutate the quotas it was given", () => {
    const input = [requests(5, 100)];
    const snapshot = JSON.stringify(input);
    applyProviderHeaders(input, h({ "x-ratelimit-remaining-requests": "1" }), NOW);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
