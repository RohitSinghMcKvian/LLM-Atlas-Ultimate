import { describe, expect, it } from "vitest";
import { activeFeeds, NEWS_FEEDS } from "../feeds";
import { fetchText } from "./fetch";
import { parseFeed } from "./parse";

// Liveness checks against the real feeds.
//
// OFF BY DEFAULT. CI must not depend on three dozen third parties being up, and
// a red build caused by someone else's CDN teaches nobody anything.
//
// Run it deliberately, when adding a feed or when the warnings strip starts
// naming a source:
//
//   ATLAS_LIVE_TESTS=1 npx vitest run lib/news/sync/live.test.ts
//
// Mirrors `lib/catalog/sync/live.test.ts`, which exists for the same reason.
//
// Feed rot is the single most likely way this feature degrades: URLs move, blogs
// migrate platforms, and a feed that silently starts serving an HTML landing
// page looks healthy at the HTTP layer. This is what catches that.

const live = process.env.ATLAS_LIVE_TESTS === "1";

describe.skipIf(!live)("live feeds", () => {
  for (const feed of activeFeeds()) {
    it(
      `${feed.id} serves a parseable feed`,
      async () => {
        const response = await fetchText(feed.url, { timeoutMs: 20_000, retries: 1 });
        expect(response.status, `${feed.id} returned ${response.httpStatus}`).toBe("ok");

        const parsed = parseFeed(response.body);
        expect(parsed.items.length, `${feed.id} parsed zero items`).toBeGreaterThan(0);

        // A feed whose items have no links is unusable: the reader could not
        // verify anything and we could not give the items stable ids.
        expect(parsed.items.filter((i) => i.link).length).toBeGreaterThan(0);
      },
      45_000,
    );
  }

  // Disabled entries are kept in the registry with a dated reason rather than
  // deleted. This reports when one starts working again, so it can be re-enabled
  // rather than quietly forgotten.
  for (const feed of NEWS_FEEDS.filter((f) => f.enabled === false)) {
    it.skip(`${feed.id} is disabled — recheck whether it serves a feed again`, async () => {
      const response = await fetchText(feed.url, { timeoutMs: 20_000, retries: 0 });
      expect(parseFeed(response.body).items.length).toBe(0);
    });
  }
});
