import { describe, it, expect } from "vitest";
import {
  buildXlsx,
  coerceCell,
  csvToXlsx,
  detectDelimiter,
  parseDelimited,
  safeSheetName,
  sheetFromDelimited,
} from "./xlsx";

describe("parseDelimited", () => {
  it("splits plain rows", () => {
    expect(parseDelimited("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  // The three things that break a naive split on real model output.
  it("keeps a delimiter inside a quoted field", () => {
    expect(parseDelimited('name,note\n"Smith, J.",ok')).toEqual([
      ["name", "note"],
      ["Smith, J.", "ok"],
    ]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseDelimited('a,b\n"line one\nline two",x')).toEqual([
      ["a", "b"],
      ["line one\nline two", "x"],
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseDelimited('a\n"she said ""hi"""')).toEqual([["a"], ['she said "hi"']]);
  });

  it("keeps the last row when there is no trailing newline", () => {
    expect(parseDelimited("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseDelimited("a,b\n1,2")).toHaveLength(2);
  });

  it("tolerates CRLF", () => {
    expect(parseDelimited("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves empty cells", () => {
    expect(parseDelimited("a,,c")).toEqual([["a", "", "c"]]);
  });

  it("handles an empty input", () => {
    expect(parseDelimited("")).toEqual([]);
  });

  it("splits on tabs when asked", () => {
    expect(parseDelimited("a\tb", "\t")).toEqual([["a", "b"]]);
  });
});

describe("detectDelimiter", () => {
  it("finds the dominant separator", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("falls back to a comma when there is nothing to go on", () => {
    expect(detectDelimiter("single")).toBe(",");
  });
});

/**
 * The difference between a spreadsheet you can sum and one you cannot — and
 * between one that is correct and one that has silently eaten an identifier.
 */
describe("coerceCell", () => {
  it("converts plain numbers so they can be summed", () => {
    expect(coerceCell("42")).toBe(42);
    expect(coerceCell("-3.5")).toBe(-3.5);
    expect(coerceCell(" 7 ")).toBe(7);
  });

  it("converts booleans", () => {
    expect(coerceCell("true")).toBe(true);
    expect(coerceCell("FALSE")).toBe(false);
  });

  // Conservative on purpose: a round trip that is not byte-identical means
  // converting would change what the user sees.
  it("leaves anything whose round trip is lossy as text", () => {
    expect(coerceCell("007")).toBe("007");
    expect(coerceCell("1.50")).toBe("1.50");
    expect(coerceCell("+5")).toBe("+5");
    expect(coerceCell("1e5")).toBe("1e5");
    expect(coerceCell("00123456789012345678")).toBe("00123456789012345678");
  });

  it("leaves ordinary text alone", () => {
    expect(coerceCell("hello")).toBe("hello");
    expect(coerceCell("2026-08-08")).toBe("2026-08-08");
  });

  it("reads an empty cell as blank rather than zero", () => {
    expect(coerceCell("")).toBeNull();
    expect(coerceCell("   ")).toBeNull();
  });
});

describe("safeSheetName", () => {
  it("strips the characters Excel forbids", () => {
    expect(safeSheetName("Q1/Q2: sales[2026]")).not.toMatch(/[\\/?*[\]:]/);
  });

  it("caps at 31 characters", () => {
    expect(safeSheetName("x".repeat(60))).toHaveLength(31);
  });

  it("never produces an empty name", () => {
    expect(safeSheetName("///")).toBe("Sheet1");
    expect(safeSheetName("")).toBe("Sheet1");
  });
});

describe("sheetFromDelimited", () => {
  it("produces coerced rows under a safe name", () => {
    const s = sheetFromDelimited("month,total\nJan,100\nFeb,250", "Sales: 2026");
    expect(s.name).toBe("Sales  2026");
    expect(s.rows).toEqual([
      ["month", "total"],
      ["Jan", 100],
      ["Feb", 250],
    ]);
  });
});

describe("buildXlsx", () => {
  it("writes a real workbook that reads back", async () => {
    const bytes = await csvToXlsx("a,b\n1,2", "Data");
    expect(bytes.byteLength).toBeGreaterThan(0);
    // The zip magic — a genuine xlsx container, not text pretending to be one.
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);

    const XLSX = await import("xlsx");
    const book = XLSX.read(bytes, { type: "array" });
    expect(book.SheetNames).toEqual(["Data"]);
    expect(XLSX.utils.sheet_to_json(book.Sheets.Data, { header: 1 })).toEqual([
      ["a", "b"],
      [1, 2],
    ]);
  });

  it("writes several sheets", async () => {
    const bytes = await buildXlsx([
      { name: "One", rows: [["x"]] },
      { name: "Two", rows: [["y"]] },
    ]);
    const XLSX = await import("xlsx");
    expect(XLSX.read(bytes, { type: "array" }).SheetNames).toEqual(["One", "Two"]);
  });

  it("still produces a valid file from nothing", async () => {
    const bytes = await buildXlsx([]);
    const XLSX = await import("xlsx");
    expect(XLSX.read(bytes, { type: "array" }).SheetNames).toHaveLength(1);
  });
});
