import { describe, it, expect } from "vitest";
import {
  admitFiles,
  attachmentsToPromptText,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  rejectionAttachment,
} from "./attachments";
import type { Attachment } from "./types";

const file = (name: string, size = 1024) => ({ name, size });

describe("admitFiles", () => {
  it("accepts an ordinary batch", () => {
    const r = admitFiles(0, [file("a.txt"), file("b.csv")]);
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected).toEqual([]);
  });

  it("counts what is already attached", () => {
    const r = admitFiles(MAX_ATTACHMENTS - 1, [file("a.txt"), file("b.txt")]);
    expect(r.accepted.map((f) => f.name)).toEqual(["a.txt"]);
    expect(r.rejected).toHaveLength(1);
  });

  it("turns away an oversized file and says how big it was", () => {
    const r = admitFiles(0, [file("huge.bin", MAX_ATTACHMENT_BYTES + 1)]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0].reason).toContain("MB");
  });

  // The failure this exists to prevent: reading a hundred dropped images into
  // data URLs on the main thread and only then discovering the request is too
  // large.
  it("caps a large drop and reports every file it turned away", () => {
    const batch = Array.from({ length: MAX_ATTACHMENTS + 5 }, (_, i) => file(`f${i}.png`));
    const r = admitFiles(0, batch);
    expect(r.accepted).toHaveLength(MAX_ATTACHMENTS);
    expect(r.rejected).toHaveLength(5);
    expect(r.rejected.every((x) => x.reason.includes(String(MAX_ATTACHMENTS)))).toBe(true);
  });

  // An oversized file must not consume one of the twenty slots on its way to
  // being refused.
  it("does not spend a slot on a file it rejected for size", () => {
    const r = admitFiles(MAX_ATTACHMENTS - 1, [
      file("huge.bin", MAX_ATTACHMENT_BYTES + 1),
      file("small.txt"),
    ]);
    expect(r.accepted.map((f) => f.name)).toEqual(["small.txt"]);
  });

  it("accepts a file exactly at the size limit", () => {
    expect(admitFiles(0, [file("edge.bin", MAX_ATTACHMENT_BYTES)]).accepted).toHaveLength(1);
  });

  it("handles an empty batch", () => {
    expect(admitFiles(0, [])).toEqual({ accepted: [], rejected: [] });
  });
});

describe("rejectionAttachment", () => {
  // Surfaced as a failed chip rather than dropped: a file that silently failed
  // to attach is one the user believes the model can see.
  it("reads as a failed attachment that says why", () => {
    const a = rejectionAttachment("big.zip", "is 40MB — the limit is 30MB per file");
    expect(a.failed).toBe(true);
    expect(a.text).toContain("big.zip");
    expect(a.text).toContain("40MB");
  });
});

describe("attachmentsToPromptText", () => {
  const att = (over: Partial<Attachment>): Attachment => ({
    id: "1",
    name: "a.txt",
    kind: "text",
    mime: "text/plain",
    size: 1,
    ...over,
  });

  it("wraps each textual attachment with its name and kind", () => {
    const out = attachmentsToPromptText([att({ name: "spec.md", kind: "text", text: "body" })]);
    expect(out).toContain('name="spec.md"');
    expect(out).toContain("body");
  });

  // Images travel as `image_url` parts, not as prompt text.
  it("leaves images out", () => {
    expect(attachmentsToPromptText([att({ kind: "image", dataUrl: "data:," })])).toBe("");
  });

  it("returns nothing for an empty list", () => {
    expect(attachmentsToPromptText([])).toBe("");
  });
});
