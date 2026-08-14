"use client";

import { uuid, type Attachment, type AttachmentKind } from "./types";

/** Max extracted characters injected per attachment (keeps prompts sane). */
const MAX_CHARS = 24_000;

const CODE_EXT = new Set([
  "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp",
  "cs", "php", "swift", "kt", "sh", "sql", "json", "yaml", "yml", "toml",
  "html", "css", "scss", "vue", "svelte", "dart", "lua", "r",
]);

function ext(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function detectKind(file: File): AttachmentKind {
  const e = ext(file.name);
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || e === "pdf") return "pdf";
  if (
    e === "docx" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  if (e === "csv" || file.type === "text/csv") return "csv";
  if (e === "xlsx" || e === "xls" || file.type.includes("spreadsheetml")) return "xlsx";
  if (CODE_EXT.has(e)) return "code";
  return "text";
}

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS)}\n\n…[truncated ${text.length - MAX_CHARS} chars]`;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function parsePdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Bundle the worker as a static asset and point pdf.js at it.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it: any) => it.str).join(" ") + "\n\n";
    if (out.length > MAX_CHARS) break;
  }
  return out.trim();
}

async function parseDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const buf = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return value.trim();
}

async function parseCsv(file: File): Promise<string> {
  const text = await file.text();
  try {
    const Papa = (await import("papaparse")).default;
    const parsed = Papa.parse(text.trim(), { skipEmptyLines: true });
    const rows = parsed.data as string[][];
    return rows.map((r) => r.join("\t")).join("\n");
  } catch {
    return text;
  }
}

async function parseXlsx(file: File): Promise<string> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    return `# ${name}\n${csv}`;
  })
    .join("\n\n")
    .trim();
}

/**
 * Parse a dropped/picked file into an {@link Attachment}: images become data
 * URLs for vision models; everything else is parsed client-side to text that's
 * injected into the prompt. Failures never throw — they attach a note instead.
 */
export async function parseAttachment(file: File): Promise<Attachment> {
  const kind = detectKind(file);
  const base = {
    id: uuid(),
    name: file.name,
    kind,
    mime: file.type || kind,
    size: file.size,
  };

  try {
    if (kind === "image") {
      return { ...base, dataUrl: await readDataUrl(file) };
    }
    let text: string;
    switch (kind) {
      case "pdf":
        text = await parsePdf(file);
        break;
      case "docx":
        text = await parseDocx(file);
        break;
      case "csv":
        text = await parseCsv(file);
        break;
      case "xlsx":
        text = await parseXlsx(file);
        break;
      default:
        text = await file.text();
    }
    return { ...base, text: truncate(text || "(empty file)") };
  } catch (e) {
    return {
      ...base,
      failed: true,
      text: `Couldn't read ${file.name}: ${(e as Error).message}`,
    };
  }
}

/**
 * Attachment limits, matched to what the major assistants accept.
 *
 * There were none. `handleFiles` parsed whatever it was handed, so dropping a
 * folder of a hundred images read every one into a data URL on the main thread
 * and then tried to put them all in one request — a tab that stops responding
 * and then a provider error, when the honest answer was available before any of
 * it started.
 */
export const MAX_ATTACHMENTS = 20;
export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;

export interface AdmissionResult<T> {
  accepted: T[];
  /** What was turned away, with a sentence for the user. */
  rejected: { name: string; reason: string }[];
}

/**
 * Decide which of a dropped batch may be attached.
 *
 * Pure over `{ name, size }` rather than over `File`, so the rules are testable
 * without a DOM. Rejections are returned rather than dropped: a file that
 * silently failed to attach is one the user believes the model can see.
 */
export function admitFiles<T extends { name: string; size: number }>(
  existingCount: number,
  incoming: T[],
): AdmissionResult<T> {
  const accepted: T[] = [];
  const rejected: AdmissionResult<T>["rejected"] = [];
  let count = existingCount;

  for (const file of incoming) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      rejected.push({
        name: file.name,
        reason: `is ${(file.size / 1024 / 1024).toFixed(0)}MB — the limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB per file`,
      });
      continue;
    }
    if (count >= MAX_ATTACHMENTS) {
      rejected.push({
        name: file.name,
        reason: `would be attachment ${count + 1} — the limit is ${MAX_ATTACHMENTS} per message`,
      });
      continue;
    }
    accepted.push(file);
    count++;
  }

  return { accepted, rejected };
}

/** A rejected file, as an attachment chip that says why. */
export function rejectionAttachment(name: string, reason: string): Attachment {
  return {
    id: uuid(),
    name,
    kind: "text",
    mime: "text/plain",
    size: 0,
    failed: true,
    text: `${name} was not attached — it ${reason}.`,
  };
}

/** Render attachments as a prompt-injectable text block (non-image content). */
export function attachmentsToPromptText(atts: Attachment[]): string {
  const textual = atts.filter((a) => a.kind !== "image" && a.text);
  if (textual.length === 0) return "";
  return textual
    .map((a) => `<attachment name="${a.name}" type="${a.kind}">\n${a.text}\n</attachment>`)
    .join("\n\n");
}
