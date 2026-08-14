import { describe, it, expect } from "vitest";
import { createZip, crc32, safeEntryPath } from "./zip";

/**
 * The archive has to be a real ZIP, not something that merely has the extension.
 *
 * There is no unzip library here to check against, so the tests read the bytes:
 * signatures at the right offsets, a CRC that matches a published vector, the
 * entry count in the end-of-central-directory record, and the stored payload
 * recoverable from the local header. Those are the parts a broken writer gets
 * wrong.
 */

const u32 = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);

/** Find every offset where a 4-byte signature occurs. */
function find(bytes: Uint8Array, sig: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 4 <= bytes.length; i++) if (u32(bytes, i) === sig) out.push(i);
  return out;
}

describe("crc32", () => {
  // The published check value for CRC-32/ISO-HDLC over "123456789".
  it("matches the standard test vector", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("is 0 for empty input", () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("safeEntryPath", () => {
  it("strips leading slashes and normalises separators", () => {
    expect(safeEntryPath("/index.html")).toBe("index.html");
    expect(safeEntryPath("src\\App.jsx")).toBe("src/App.jsx");
    expect(safeEntryPath("./a/./b.css")).toBe("a/b.css");
  });

  // Zip slip: an entry that writes outside the extraction directory.
  it.each(["../evil", "a/../../evil", "/../evil"])("refuses %s", (bad) => {
    expect(safeEntryPath(bad)).toBeNull();
  });

  it("refuses an empty path", () => {
    expect(safeEntryPath("")).toBeNull();
    expect(safeEntryPath("   ")).toBeNull();
  });
});

describe("createZip", () => {
  const entries = [
    { path: "index.html", content: "<h1>Coffee</h1>" },
    { path: "styles.css", content: "body{margin:0}" },
  ];

  it("writes one local header per entry and one central record per entry", () => {
    const z = createZip(entries);
    expect(find(z, 0x04034b50)).toHaveLength(2);
    expect(find(z, 0x02014b50)).toHaveLength(2);
    expect(find(z, 0x06054b50)).toHaveLength(1);
  });

  it("records the entry count in the end-of-central-directory record", () => {
    const z = createZip(entries);
    const eocd = find(z, 0x06054b50)[0];
    expect(u16(z, eocd + 8)).toBe(2); // entries on this disk
    expect(u16(z, eocd + 10)).toBe(2); // entries total
  });

  it("stores the payload verbatim and recoverably", () => {
    const z = createZip([{ path: "a.txt", content: "hello zip" }]);
    const lfh = find(z, 0x04034b50)[0];
    const nameLen = u16(z, lfh + 26);
    const extraLen = u16(z, lfh + 28);
    const size = u32(z, lfh + 22);
    const dataAt = lfh + 30 + nameLen + extraLen;
    const data = z.slice(dataAt, dataAt + size);
    expect(new TextDecoder().decode(data)).toBe("hello zip");
  });

  it("writes a CRC that matches the stored bytes", () => {
    const content = "body{margin:0}";
    const z = createZip([{ path: "s.css", content }]);
    const lfh = find(z, 0x04034b50)[0];
    expect(u32(z, lfh + 14)).toBe(crc32(new TextEncoder().encode(content)));
  });

  it("marks entries as stored, not deflated", () => {
    const z = createZip(entries);
    for (const lfh of find(z, 0x04034b50)) {
      expect(u16(z, lfh + 8)).toBe(0); // compression method
    }
  });

  it("points each central record at its local header", () => {
    const z = createZip(entries);
    const locals = find(z, 0x04034b50);
    const centrals = find(z, 0x02014b50);
    centrals.forEach((c, i) => {
      expect(u32(z, c + 42)).toBe(locals[i]);
    });
  });

  it("keeps nested paths, so a project keeps its layout", () => {
    const z = createZip([{ path: "src/components/Nav.jsx", content: "x" }]);
    expect(new TextDecoder().decode(z)).toContain("src/components/Nav.jsx");
  });

  it("skips unusable and duplicate paths rather than emitting a broken archive", () => {
    const z = createZip([
      { path: "a.txt", content: "1" },
      { path: "../evil", content: "2" },
      { path: "a.txt", content: "3" },
    ]);
    const eocd = find(z, 0x06054b50)[0];
    expect(u16(z, eocd + 10)).toBe(1);
  });

  it("produces a valid empty archive", () => {
    const z = createZip([]);
    expect(z).toHaveLength(22); // EOCD only
    expect(u32(z, 0)).toBe(0x06054b50);
  });

  it("handles non-ASCII content by byte length, not character count", () => {
    const content = "héllo — ✓";
    const z = createZip([{ path: "u.txt", content }]);
    const lfh = find(z, 0x04034b50)[0];
    expect(u32(z, lfh + 22)).toBe(new TextEncoder().encode(content).length);
  });
});
