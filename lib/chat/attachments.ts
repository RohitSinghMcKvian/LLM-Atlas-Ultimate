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

/** Render attachments as a prompt-injectable text block (non-image content). */
export function attachmentsToPromptText(atts: Attachment[]): string {
  const textual = atts.filter((a) => a.kind !== "image" && a.text);
  if (textual.length === 0) return "";
  return textual
    .map((a) => `<attachment name="${a.name}" type="${a.kind}">\n${a.text}\n</attachment>`)
    .join("\n\n");
}
