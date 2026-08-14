/**
 * A minimal ZIP writer, so a multi-file build can be downloaded as a project.
 *
 * Until now "Download" handed back one file. That was right when a conversation
 * could only ever hold one artifact; with a real build it means a landing page
 * with a stylesheet and a script is three separate downloads the user has to
 * reassemble into the right directory layout themselves.
 *
 * No dependency. JSZip is ~100KB for a feature that is one archive format used
 * one way, and the repo already makes this trade twice — `lib/chat/idb.ts`
 * hand-rolls the six IndexedDB calls it needs, and `lib/crypto/secret-box.ts`
 * does the same for WebCrypto. The whole writer is below.
 *
 * Entries are **stored, not deflated**. Compression would mean shipping an
 * inflate/deflate implementation as well, and the payload here is a handful of
 * text files: a stored archive is a few hundred KB at worst, opens in every
 * unzip tool, and the code is short enough to read in one sitting.
 *
 * Pure — takes strings, returns bytes — so it is testable in the node suite.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive. Forward slashes; no leading slash. */
  path: string;
  content: string;
}

/**
 * MS-DOS date/time, which is what the format stores.
 *
 * Two 16-bit fields with second precision halved and the year offset from 1980.
 * A fixed epoch would be simpler but produces archives dated 1980, which some
 * tools flag; the real timestamp costs six lines.
 */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

class ByteWriter {
  private parts: Uint8Array[] = [];
  private len = 0;

  get length(): number {
    return this.len;
  }

  push(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.len += bytes.length;
  }

  u16(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }

  u32(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.len);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** Normalise a path so the archive can never contain a traversal entry. */
export function safeEntryPath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!p) return null;
  const segments = p.split("/").filter((s) => s !== "" && s !== ".");
  // `..` in a zip entry is the classic "zip slip" write-outside-the-target bug.
  // We are the writer, not the extractor, but shipping an archive that attacks
  // whoever opens it is not acceptable either.
  if (segments.some((s) => s === "..")) return null;
  return segments.join("/");
}

/** Build a ZIP archive. Entries with an unusable path are skipped. */
export function createZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);

  const body = new ByteWriter();
  const central = new ByteWriter();
  let count = 0;

  const seen = new Set<string>();
  for (const entry of entries) {
    const path = safeEntryPath(entry.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);

    const nameBytes = encoder.encode(path);
    const dataBytes = encoder.encode(entry.content);
    const sum = crc32(dataBytes);
    const offset = body.length;

    // Local file header.
    body.u32(0x04034b50);
    body.u16(20); // version needed
    body.u16(0); // flags
    body.u16(0); // method: stored
    body.u16(time);
    body.u16(date);
    body.u32(sum);
    body.u32(dataBytes.length); // compressed == uncompressed when stored
    body.u32(dataBytes.length);
    body.u16(nameBytes.length);
    body.u16(0); // extra length
    body.push(nameBytes);
    body.push(dataBytes);

    // Central directory entry.
    central.u32(0x02014b50);
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(0);
    central.u16(0);
    central.u16(time);
    central.u16(date);
    central.u32(sum);
    central.u32(dataBytes.length);
    central.u32(dataBytes.length);
    central.u16(nameBytes.length);
    central.u16(0); // extra
    central.u16(0); // comment
    central.u16(0); // disk number
    central.u16(0); // internal attrs
    central.u32(0); // external attrs
    central.u32(offset);
    central.push(nameBytes);
    count++;
  }

  const out = new ByteWriter();
  out.push(body.toUint8Array());
  const centralBytes = central.toUint8Array();
  out.push(centralBytes);

  // End of central directory.
  out.u32(0x06054b50);
  out.u16(0); // this disk
  out.u16(0); // disk with central dir
  out.u16(count);
  out.u16(count);
  out.u32(centralBytes.length);
  out.u32(body.length);
  out.u16(0); // comment length

  return out.toUint8Array();
}

/** Trigger a download of the archive. Browser-only. */
export function downloadZip(entries: ZipEntry[], filename: string): void {
  const bytes = createZip(entries);
  // A fresh ArrayBuffer, because `bytes.buffer` may be a view into a larger one.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".zip") ? filename : `${filename}.zip`;
  a.click();
  // Revoked on the next tick: revoking synchronously can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
