/**
 * Turning tabular text into a real spreadsheet.
 *
 * `run_python` with `openpyxl` already produces genuine `.xlsx` bytes, and that
 * is the better path when it is available. This is the path for when it is not:
 * models write CSV readily and without being asked, code execution is off by
 * default, and "here is a table you can open in Excel" should not require the
 * user to have turned on an interpreter first.
 *
 * SheetJS is already a dependency — `lib/chat/attachments.ts` uses it to *read*
 * uploaded workbooks — so this direction costs no bundle size.
 *
 * Parsing is deliberately its own function rather than delegated to papaparse:
 * the only thing needed here is RFC-4180 quoting, the input is model-authored
 * text of known shape, and keeping it local means the number coercion below —
 * which is the difference between a spreadsheet you can sum and one you cannot —
 * is testable without a parser's options in the way.
 */

export interface SheetData {
  name: string;
  rows: (string | number | boolean | null)[][];
}

/** Excel caps a sheet name at 31 characters and forbids these outright. */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || "Sheet1").slice(0, 31);
}

/**
 * Split delimited text into rows, honouring quotes.
 *
 * Handles the three things that break a naive `split(",")` on real model output:
 * a comma inside a quoted field, a newline inside a quoted field, and `""` as an
 * escaped quote.
 */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  // A file with no trailing newline still has a last row.
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Whichever of comma, tab or semicolon appears most consistently per line. */
export function detectDelimiter(text: string): string {
  const sample = text.split("\n").slice(0, 10).join("\n");
  const counts = [",", "\t", ";"].map((d) => ({
    d,
    n: sample.split(d).length - 1,
  }));
  return counts.sort((a, b) => b.n - a.n)[0].n > 0 ? counts[0].d : ",";
}

/**
 * Coerce a cell so the spreadsheet is usable rather than merely accurate.
 *
 * A column of numbers stored as text cannot be summed, charted or sorted, which
 * is most of the reason someone wanted a spreadsheet. But the coercion has to be
 * conservative: leading zeros are significant in identifiers, and turning
 * `007` into `7` or a long digit string into scientific notation silently
 * corrupts data. So a value converts only when its round trip is byte-identical.
 */
export function coerceCell(raw: string): string | number | boolean | null {
  const v = raw.trim();
  if (v === "") return null;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true";

  const n = Number(v);
  if (!Number.isFinite(n)) return raw;
  // `String(n) === v` rejects "007", "1e5" written as "100000", "1.50", and
  // anything past the precision where a round trip stops being exact.
  return String(n) === v ? n : raw;
}

export function sheetFromDelimited(text: string, name = "Sheet1"): SheetData {
  const delimiter = detectDelimiter(text);
  return {
    name: safeSheetName(name),
    rows: parseDelimited(text, delimiter).map((r) => r.map(coerceCell)),
  };
}

/**
 * Build a real `.xlsx`.
 *
 * SheetJS is imported dynamically: it is ~500KB, and a user who never asks for a
 * spreadsheet should not carry it in the chat bundle.
 */
export async function buildXlsx(sheets: SheetData[]): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  for (const sheet of sheets.length ? sheets : [{ name: "Sheet1", rows: [[]] }]) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(book, ws, safeSheetName(sheet.name));
  }
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
}

/** One CSV or TSV file to one single-sheet workbook. */
export async function csvToXlsx(text: string, name = "Sheet1"): Promise<Uint8Array> {
  return buildXlsx([sheetFromDelimited(text, name)]);
}
