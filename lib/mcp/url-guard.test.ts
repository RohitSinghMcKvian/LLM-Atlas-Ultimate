import { describe, it, expect } from "vitest";
import {
  addressesArePublic,
  guardConnectorUrl,
  isBlockedAddressLiteral,
  isPrivateIpv4,
  isPrivateIpv6,
  parseIpv4,
} from "./url-guard";

// The proxy fetches a user-supplied URL from Atlas's server, so these rules are
// the difference between a connector feature and an SSRF primitive. Tested
// harder than anything else in P6 for that reason.

describe("parseIpv4", () => {
  it("parses dotted quads", () => {
    expect(parseIpv4("127.0.0.1")).toBe(0x7f000001);
    expect(parseIpv4("10.0.0.5")).toBe(0x0a000005);
    expect(parseIpv4("8.8.8.8")).toBe(0x08080808);
  });

  // inet_aton accepts all of these, so a naive dotted-quad-only check is bypassable.
  it("parses the obfuscated forms inet_aton accepts", () => {
    expect(parseIpv4("2130706433")).toBe(0x7f000001); // decimal
    expect(parseIpv4("0x7f000001")).toBe(0x7f000001); // hex
    expect(parseIpv4("0177.0.0.1")).toBe(0x7f000001); // octal first octet
    expect(parseIpv4("127.1")).toBe(0x7f000001); // short form
    expect(parseIpv4("127.0.1")).toBe(0x7f000001);
  });

  it("rejects things that are not IPv4 literals", () => {
    expect(parseIpv4("example.com")).toBeNull();
    expect(parseIpv4("")).toBeNull();
    expect(parseIpv4("1.2.3.4.5")).toBeNull();
    expect(parseIpv4("256.0.0.1")).toBeNull();
    expect(parseIpv4("1..2.3")).toBeNull();
    expect(parseIpv4("09.0.0.1")).toBeNull(); // invalid octal
  });
});

describe("isPrivateIpv4", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "cloud metadata"],
    ["0.0.0.0", "this network"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["224.0.0.1", "multicast"],
  ])("blocks %s (%s)", (ip) => {
    expect(isPrivateIpv4(parseIpv4(ip)!)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34"])(
    "allows public %s",
    (ip) => {
      expect(isPrivateIpv4(parseIpv4(ip)!)).toBe(false);
    },
  );
});

describe("isPrivateIpv6", () => {
  it.each(["::1", "::", "fe80::1", "fc00::1", "fd00::1", "ff02::1"])("blocks %s", (ip) => {
    expect(isPrivateIpv6(ip)).toBe(true);
  });

  // Loopback wearing a v6 hat — the check that a string comparison misses.
  it("blocks IPv4-mapped loopback and private addresses", () => {
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpv6("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateIpv6("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows a mapped public address", () => {
    expect(isPrivateIpv6("::ffff:8.8.8.8")).toBe(false);
  });

  it("ignores a zone index", () => {
    expect(isPrivateIpv6("fe80::1%eth0")).toBe(true);
  });
});

describe("isBlockedAddressLiteral", () => {
  it("handles bracketed IPv6", () => {
    expect(isBlockedAddressLiteral("[::1]")).toBe(true);
  });

  it("leaves hostnames alone — they are the DNS layer's problem", () => {
    expect(isBlockedAddressLiteral("example.com")).toBe(false);
  });
});

describe("guardConnectorUrl", () => {
  it("allows a public https URL", () => {
    const r = guardConnectorUrl("https://mcp.example.com/sse");
    expect(r.ok).toBe(true);
    expect(r.url?.hostname).toBe("mcp.example.com");
  });

  // The proxy forwards a bearer token; over http it crosses the network in clear.
  it("refuses http", () => {
    const r = guardConnectorUrl("http://mcp.example.com/");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("https");
  });

  it.each(["ftp://x.com", "file:///etc/passwd", "gopher://x.com", "data:text/plain,hi"])(
    "refuses %s",
    (u) => {
      expect(guardConnectorUrl(u).ok).toBe(false);
    },
  );

  it("refuses credentials in the URL", () => {
    const r = guardConnectorUrl("https://user:pass@mcp.example.com/");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Credentials");
  });

  it.each([
    "https://localhost/",
    "https://foo.localhost/",
    "https://printer.local/",
    "https://db.internal/",
    "https://x.home.arpa/",
    "https://metadata.google.internal/",
  ])("refuses local network name %s", (u) => {
    expect(guardConnectorUrl(u).ok).toBe(false);
  });

  it.each([
    "https://127.0.0.1/",
    "https://10.0.0.5/",
    "https://192.168.0.1/",
    "https://169.254.169.254/",
    "https://[::1]/",
    "https://2130706433/",
    "https://0x7f000001/",
  ])("refuses private target %s", (u) => {
    const r = guardConnectorUrl(u);
    expect(r.ok).toBe(false);
  });

  it("refuses garbage", () => {
    expect(guardConnectorUrl("not a url").ok).toBe(false);
    expect(guardConnectorUrl("").ok).toBe(false);
  });

  it("keeps the path and query, which the endpoint may need", () => {
    const r = guardConnectorUrl("https://mcp.example.com/v1/mcp?tenant=42");
    expect(r.url?.pathname).toBe("/v1/mcp");
    expect(r.url?.searchParams.get("tenant")).toBe("42");
  });
});

describe("addressesArePublic", () => {
  it("allows an all-public record set", () => {
    expect(addressesArePublic(["8.8.8.8", "1.1.1.1"])).toBe(true);
  });

  // A host advertising one public and one private address must be refused, not
  // accepted on the strength of the public one.
  it("refuses when ANY record is private", () => {
    expect(addressesArePublic(["8.8.8.8", "10.0.0.1"])).toBe(false);
  });

  it("refuses an empty result rather than treating it as harmless", () => {
    expect(addressesArePublic([])).toBe(false);
  });

  it("refuses a private IPv6 record", () => {
    expect(addressesArePublic(["::1"])).toBe(false);
  });
});
