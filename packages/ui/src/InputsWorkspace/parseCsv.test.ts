/**
 * parseCsv tests — Brief 38 PR 38.5.
 *
 * Focus on the failure modes (encoding, unterminated quotes,
 * empty input) + the dtype inference logic + the edge cases the
 * tokenizer has to handle (CRLF, quoted commas, escaped quotes,
 * trailing newline, no trailing newline).
 */

import { describe, it, expect } from "vitest";

import { parseCsv, parseCsvForInputs } from "./parseCsv";

// ─────────────────────────────────────────────────────────────────
// Happy path tokenization
// ─────────────────────────────────────────────────────────────────

describe("parseCsv — basic tokenization", () => {
  it("parses a minimal CSV with one header row + one data row", () => {
    const result = parseCsv("a,b,c\n1,2,3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns).toEqual(["a", "b", "c"]);
    expect(result.rows).toEqual([{ a: "1", b: "2", c: "3" }]);
  });

  it("preserves source column order in `columns`", () => {
    const result = parseCsv("z,a,m\n1,2,3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns).toEqual(["z", "a", "m"]);
  });

  it("handles CRLF line endings (Excel exports)", () => {
    const result = parseCsv("a,b\r\n1,2\r\n3,4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("handles legacy CR line endings (old Mac files)", () => {
    const result = parseCsv("a,b\r1,2\r3,4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
  });

  it("strips UTF-8 BOM at start of file", () => {
    const result = parseCsv("﻿a,b\n1,2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns).toEqual(["a", "b"]);
  });

  it("tolerates a trailing newline (suppresses the empty record)", () => {
    const result = parseCsv("a,b\n1,2\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("tolerates the absence of a trailing newline", () => {
    const result = parseCsv("a,b\n1,2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("trims surrounding whitespace from header names + cell values", () => {
    const result = parseCsv("  a  ,  b  \n  1  ,  2  ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns).toEqual(["a", "b"]);
    expect(result.rows[0]).toEqual({ a: "1", b: "2" });
  });
});

// ─────────────────────────────────────────────────────────────────
// Quoted fields
// ─────────────────────────────────────────────────────────────────

describe("parseCsv — quoted fields", () => {
  it("permits commas inside quoted fields", () => {
    const result = parseCsv('a,b\n"hello, world",2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({ a: "hello, world", b: "2" });
  });

  it("permits newlines inside quoted fields", () => {
    const result = parseCsv('a,b\n"line one\nline two",3');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.a).toBe("line one\nline two");
  });

  it("unescapes doubled-quote inside quoted field", () => {
    const result = parseCsv('a\n"she said ""hi"" today"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.a).toBe('she said "hi" today');
  });
});

// ─────────────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────────────

describe("parseCsv — error cases", () => {
  it("returns 'empty' error on empty string", () => {
    const result = parseCsv("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("empty");
  });

  it("returns 'unterminated_quote' for an unclosed quoted field", () => {
    const result = parseCsv('a,b\n"oops,3');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unterminated_quote");
  });

  it("returns 'row' error for a quote in the middle of a non-quoted field", () => {
    const result = parseCsv('a,b\nfoo"bar,2');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("row");
  });
});

// ─────────────────────────────────────────────────────────────────
// Header issues + warnings
// ─────────────────────────────────────────────────────────────────

describe("parseCsv — header warnings", () => {
  it("renames empty header columns + warns", () => {
    const result = parseCsv("a,,c\n1,2,3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns).toEqual(["a", "column_2", "c"]);
    expect(result.warnings.some((w) => w.kind === "empty_column_name")).toBe(
      true,
    );
  });

  it("renames duplicate header columns + warns", () => {
    const result = parseCsv("a,a,a\n1,2,3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns).toEqual(["a", "a_2", "a_3"]);
    expect(
      result.warnings.filter((w) => w.kind === "duplicate_column").length,
    ).toBe(2);
  });

  it("preserves the values when columns are renamed", () => {
    const result = parseCsv("a,a\n1,2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({ a: "1", a_2: "2" });
  });
});

// ─────────────────────────────────────────────────────────────────
// Short / long rows
// ─────────────────────────────────────────────────────────────────

describe("parseCsv — irregular row widths", () => {
  it("pads short rows with empty strings", () => {
    const result = parseCsv("a,b,c\n1,2\n3,4,5");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  it("drops cells beyond the declared columns (no extra-column data)", () => {
    const result = parseCsv("a,b\n1,2,3,4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // c, d don't appear in columns so their data is silently dropped.
    expect(Object.keys(result.rows[0] ?? {})).toEqual(["a", "b"]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Dtype inference
// ─────────────────────────────────────────────────────────────────

describe("parseCsv — dtype inference", () => {
  it("infers number for purely numeric columns", () => {
    const result = parseCsv("x\n1\n2\n3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dtypes.x).toBe("number");
  });

  it("infers number for thousand-separated numerics", () => {
    const result = parseCsv("tiv\n1,247,438\n8,900,000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ⚠ Quoted parsing — "1,247,438" without quotes would split on comma.
    // Test the safe form:
    const safe = parseCsv('tiv\n"1,247,438"\n"8,900,000"');
    expect(safe.ok).toBe(true);
    if (!safe.ok) return;
    expect(safe.dtypes.tiv).toBe("number");
  });

  it("infers date for ISO 8601 columns", () => {
    const result = parseCsv("d\n2026-07-01\n2026-08-15");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dtypes.d).toBe("date");
  });

  it("infers date for US m/d/yyyy + UK d/m/yyyy variants", () => {
    const result = parseCsv("d\n01/15/2026\n02/01/2026");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dtypes.d).toBe("date");
  });

  it("infers boolean for text-only truthy/falsy columns", () => {
    // "1" / "0" are intentionally numbers (not booleans) — see the
    // precedence rule in parseCsv. A column that uses them is a
    // number-coded boolean, which downstream can re-interpret.
    const result = parseCsv("b\nyes\nno\ntrue\nfalse\nY\nN");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dtypes.b).toBe("boolean");
  });

  it("falls back to string for mixed columns", () => {
    const result = parseCsv("x\n1\n2\nfoo\n3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dtypes.x).toBe("string");
  });

  it("falls back to string for completely empty columns", () => {
    const result = parseCsv("x\n\n\n\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dtypes.x).toBe("string");
  });

  it("respects dtypeInferenceRows option (samples fewer rows)", () => {
    // First 3 rows look numeric; rest are strings. With sample size
    // 3, we'd infer number; with default 20, we'd see strings.
    const rows = ["x", "1", "2", "3", "foo", "bar"].join("\n");
    const allRows = parseCsv(rows, { dtypeInferenceRows: 20 });
    expect(allRows.ok).toBe(true);
    if (!allRows.ok) return;
    expect(allRows.dtypes.x).toBe("string");

    const sampled = parseCsv(rows, { dtypeInferenceRows: 3 });
    expect(sampled.ok).toBe(true);
    if (!sampled.ok) return;
    expect(sampled.dtypes.x).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────
// parseCsvForInputs — SourceSpec adapter
// ─────────────────────────────────────────────────────────────────

describe("parseCsvForInputs", () => {
  it("returns a CsvSourceSnapshot on success", () => {
    const r = parseCsvForInputs("a,b\n1,2\n3,4");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.kind).toBe("csv");
    expect(r.snapshot.columns).toEqual(["a", "b"]);
    expect(r.snapshot.sample_rows).toHaveLength(2);
    expect(r.snapshot.totalRowCount).toBe(2);
  });

  it("caps sample_rows at maxSampleRows", () => {
    const lines = ["a"].concat(
      Array.from({ length: 200 }, (_, i) => `${i}`),
    );
    const r = parseCsvForInputs(lines.join("\n"), { maxSampleRows: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.sample_rows).toHaveLength(10);
    expect(r.snapshot.totalRowCount).toBe(200);
  });

  it("bundles dtypes + warnings in the snapshot", () => {
    const r = parseCsvForInputs("x,y\n1,foo\n2,bar");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.dtypes).toEqual({ x: "number", y: "string" });
    expect(r.snapshot.warnings).toEqual([]);
  });

  it("propagates parse errors", () => {
    const r = parseCsvForInputs("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("empty");
  });
});

// ─────────────────────────────────────────────────────────────────
// Brief 38 fixture-shape regression
// ─────────────────────────────────────────────────────────────────

describe("Brief 38 — realistic submission CSV", () => {
  const submissionsCsv = `policy_id,CLASS_CODE,CONSTR,PROT_CLASS,BUILT,TIV_USD,SPRINK_Y,EFF_DATE
BOP-001,09011,Frame,4,1987,"1,247,438",Y,2026-07-01
BOP-002,07712,Masonry,6,2001,"8,900,000",N,2026-08-15
BOP-003,06811,Non-combustible,3,2015,"2,100,000",Y,2026-09-01
BOP-004,09011,Frame,5,1994,"540,000",N,2026-10-01
BOP-005,07712,WOOD,4,1987,"1,247,438",Y,2026-11-01`;

  it("parses the BOP submission CSV without errors", () => {
    const r = parseCsvForInputs(submissionsCsv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.columns).toEqual([
      "policy_id",
      "CLASS_CODE",
      "CONSTR",
      "PROT_CLASS",
      "BUILT",
      "TIV_USD",
      "SPRINK_Y",
      "EFF_DATE",
    ]);
    expect(r.snapshot.sample_rows).toHaveLength(5);
  });

  it("infers dtypes correctly for typical BOP columns", () => {
    const r = parseCsvForInputs(submissionsCsv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Identifiers are strings; thousands-separated numbers are
    // numbers; ISO dates are dates; SPRINK_Y is Y/N → boolean.
    expect(r.snapshot.dtypes.policy_id).toBe("string");
    expect(r.snapshot.dtypes.CLASS_CODE).toBe("number");
    // ↑ CLASS_CODE values "09011" parse as numbers (leading zero
    //   doesn't disqualify per the regex). Acceptable — the column
    //   ends up mapped as a dim ref anyway and the dim handles
    //   identifier coercion. Tests document the behavior.
    expect(r.snapshot.dtypes.CONSTR).toBe("string");
    expect(r.snapshot.dtypes.TIV_USD).toBe("number");
    expect(r.snapshot.dtypes.EFF_DATE).toBe("date");
    expect(r.snapshot.dtypes.SPRINK_Y).toBe("boolean");
  });
});
