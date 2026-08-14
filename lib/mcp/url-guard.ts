/**
 * SSRF guard for connector URLs (spec §6, security).
 *
 * The MCP proxy takes a URL chosen by the user and fetches it **from Atlas's
 * server**. That is a server-side request forgery primitive by construction: on
 * Oracle Cloud (§1.7) the instance can reach the metadata endpoint, the VPC, and
 * anything else on the private network that the public internet cannot. So the
 * proxy's job is not only to forward — it is to refuse.
 *
 * Two layers, because either alone is insufficient:
 *
 *  1. **These string and literal-IP checks.** Cheap, and they catch the obvious
 *     cases plus the obfuscated ones (`0x7f000001`, `2130706433`, `0177.0.0.1`,
 *     `::ffff:127.0.0.1`) that a naive `hostname === "localhost"` test misses.
 *  2. **DNS resolution at request time** (`assertResolvesPublic`, server-only).
 *     Without it, `evil.example.com` with an A record of `10.0.0.5` sails past
 *     every string check. This is the layer that actually closes the hole; the
 *     first layer just makes the common cases fail fast and legibly.
 *
 * Neither layer defeats a determined DNS-rebinding attacker, who can answer the
 * guard's lookup with a public address and the subsequent fetch with a private
 * one. Mitigating that properly means resolving once and connecting to the
 * resolved address, which Node's `fetch` does not expose. Recorded as a known
 * limitation rather than papered over — see SELF-AUDIT.
 *
 * This module is pure and free of `node:dns` so the rules are testable; the
 * resolution step lives in the route.
 */

export interface UrlGuardResult {
  ok: boolean;
  /** Why it was refused. Safe to show the user; never echoes credentials. */
  reason?: string;
  /** The normalised URL to fetch, when allowed. */
  url?: URL;
}

/**
 * Hostnames that never leave the machine or the local network, regardless of
 * what they resolve to.
 */
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  // Cloud instance metadata. The single highest-value SSRF target on any
  // provider — it hands out credentials to anything that can make a GET.
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/** Parse an IPv4 literal in any of the forms inet_aton accepts. Null if not one. */
export function parseIpv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length === 0 || parts.length > 4) return null;

  const values: number[] = [];
  for (const part of parts) {
    if (part === "") return null;
    let v: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) v = parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) v = parseInt(part.slice(1), 8);
    // Decimal must not carry a leading zero. `09` is not valid octal and not
    // decimal-with-a-zero either; resolvers disagree about such strings, so it is
    // reported as "not an IP literal" and left to the DNS layer rather than
    // guessed at here. Guessing is how a parser and a resolver end up reading the
    // same host differently, which is exactly the gap an SSRF bypass lives in.
    else if (/^(?:0|[1-9]\d*)$/.test(part)) v = parseInt(part, 10);
    else return null;
    if (!Number.isFinite(v) || v < 0) return null;
    values.push(v);
  }

  // inet_aton: a short form packs the final part into the remaining octets, so
  // `127.1` is 127.0.0.1 and `2130706433` is the whole address in one number.
  const last = values[values.length - 1];
  const leading = values.slice(0, -1);
  if (leading.some((v) => v > 255)) return null;
  const maxLast = 2 ** (8 * (4 - leading.length));
  if (last >= maxLast) return null;
  let addr = 0;
  for (const v of leading) addr = (addr << 8) | v;
  addr = ((addr << (8 * (4 - leading.length))) >>> 0) + last;
  return addr >>> 0;
}

/** True when a 32-bit IPv4 address is not routable on the public internet. */
export function isPrivateIpv4(addr: number): boolean {
  const a = (addr >>> 24) & 0xff;
  const b = (addr >>> 16) & 0xff;
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 192 && b === 0) || // 192.0.0.0/24 IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** True when an IPv6 literal (without brackets) is not publicly routable. */
export function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (h === "::" || h === "::1") return true;
  // IPv4-mapped and IPv4-compatible forms smuggle a v4 address through a v6
  // literal: ::ffff:127.0.0.1 is loopback wearing a different hat.
  const mapped = /^::(?:ffff:(?:0{1,4}:)?)?((?:\d{1,3}\.){3}\d{1,3})$/.exec(h);
  if (mapped) {
    const addr = parseIpv4(mapped[1]);
    return addr === null ? true : isPrivateIpv4(addr);
  }
  return (
    h.startsWith("fe80") || // link-local
    h.startsWith("fc") || // unique-local
    h.startsWith("fd") ||
    h.startsWith("ff") // multicast
  );
}

/** True when a hostname string is an IP literal that must be refused. */
export function isBlockedAddressLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host.includes(":")) return isPrivateIpv6(host);
  const v4 = parseIpv4(host);
  return v4 !== null && isPrivateIpv4(v4);
}

/**
 * Validate a connector URL for server-side fetching.
 *
 * **https only.** Not pedantry: the proxy forwards the user's bearer token, and
 * over plain http that token crosses the network in the clear. A local MCP
 * server on `http://localhost` is still usable — the *browser* can reach it
 * directly when the server sends CORS headers — but it must not be reachable
 * through Atlas's server, which is precisely the pivot this guard exists to deny.
 */
export function guardConnectorUrl(raw: string): UrlGuardResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason:
        "Connector URLs must use https. A local server over http can be reached directly by the browser, but not through the Atlas proxy.",
    };
  }

  // Credentials in the URL would be forwarded and could end up in a redirect's
  // Referer. The token belongs in the Authorization header.
  if (url.username || url.password) {
    return { ok: false, reason: "Credentials in the URL are not allowed. Use a token instead." };
  }

  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "URL has no host." };
  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, reason: `${host} is not a reachable connector host.` };
  }
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: `${host} is a local network name.` };
  }
  if (isBlockedAddressLiteral(host)) {
    return { ok: false, reason: "That address is on a private or loopback network." };
  }

  return { ok: true, url };
}

/**
 * Check a set of resolved addresses against the same rules.
 *
 * Called by the route after DNS resolution, and applied to EVERY address the
 * name resolves to — a host with one public and one private A record must be
 * refused, not accepted on the strength of the public one.
 */
export function addressesArePublic(addresses: string[]): boolean {
  if (addresses.length === 0) return false;
  return addresses.every((a) => !isBlockedAddressLiteral(a));
}
