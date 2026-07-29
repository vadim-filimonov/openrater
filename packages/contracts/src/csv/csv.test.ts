/**
 * Conformance vectors for @openrater/contracts/csv — ADR-0017.
 *
 * Covers:
 *   - RFC-4180 strict parsing (delimiter, quoting, escapes)
 *   - Encoding normalization (BOM strip, CRLF → LF)
 *   - Header validation (required + canonical names + warnings)
 *   - Per-row schema parse (typed values + structured errors)
 *   - Cross-row uniqueness
 *   - encode → decode → encode round-trip byte-stability
 *   - computeDiff 5 states (added / changed / removed / unchanged / ignored)
 *   - Merge vs replace mode
 *   - Validation helpers (string / number / enum)
 */

import { describe, it, expect } from "vitest";
import {
  encodeCsv,
  decodeCsv,
  quoteIfNeeded,
  formatNumber,
  computeDiff,
  emptyDiff,
  summarizeDiff,
  parseRequiredString,
  parseOptionalString,
  parseRequiredNumber,
  parseOptionalNumber,
  parsePositiveNumber,
  parseNonNegativeNumber,
  parseInteger,
  parseEnum,
  type CsvSchema,
} from "./index";

// ── Test fixture: a factor-table row schema ──────────────────────

interface FtRow {
  readonly key: string;
  readonly factor: number;
  readonly citation_rule: string;
  readonly citation_page: string;
}

const ftSchema: CsvSchema<FtRow> = {
  columns: [
    {
      name: "key",
      required: true,
      parse: parseRequiredString,
      encode: (row) => row.key,
    },
    {
      name: "factor",
      required: true,
      parse: parsePositiveNumber,
      encode: (row) => formatNumber(row.factor),
    },
    {
      name: "citation_rule",
      required: false,
      parse: parseOptionalString,
      encode: (row) => row.citation_rule,
    },
    {
      name: "citation_page",
      required: false,
      parse: parseOptionalString,
      encode: (row) => row.citation_page,
    },
  ],
  keyOf: (row) => row.key,
  assemble: (parsed) => ({
    key: parsed.key as string,
    factor: parsed.factor as number,
    citation_rule: (parsed.citation_rule as string | undefined) ?? "",
    citation_page: (parsed.citation_page as string | undefined) ?? "",
  }),
};

// ── quoteIfNeeded ────────────────────────────────────────────────

describe("quoteIfNeeded", () => {
  it("returns plain field unchanged", () => {
    expect(quoteIfNeeded("hello")).toBe("hello");
  });
  it("returns empty as empty", () => {
    expect(quoteIfNeeded("")).toBe("");
  });
  it("quotes a field with a comma", () => {
    expect(quoteIfNeeded("a,b")).toBe('"a,b"');
  });
  it("quotes a field with a quote and doubles it", () => {
    expect(quoteIfNeeded('say "hi"')).toBe('"say ""hi"""');
  });
  it("quotes a field with a newline", () => {
    expect(quoteIfNeeded("line1\nline2")).toBe('"line1\nline2"');
  });
  it("quotes a field with CR", () => {
    expect(quoteIfNeeded("a\rb")).toBe('"a\rb"');
  });
});

// ── formatNumber ─────────────────────────────────────────────────

describe("formatNumber", () => {
  it("formats integers without decimals", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(123)).toBe("123");
    expect(formatNumber(-42)).toBe("-42");
  });
  it("formats decimals with trailing zeros trimmed", () => {
    expect(formatNumber(1.25)).toBe("1.25");
    expect(formatNumber(-0.05)).toBe("-0.05");
  });
  it("returns empty for non-finite", () => {
    expect(formatNumber(NaN)).toBe("");
    expect(formatNumber(Infinity)).toBe("");
    expect(formatNumber(-Infinity)).toBe("");
  });
});

// ── encodeCsv ────────────────────────────────────────────────────

describe("encodeCsv", () => {
  it("emits header + sorted rows + trailing newline", () => {
    const rows: FtRow[] = [
      { key: "91342", factor: 1.35, citation_rule: "ISO §5.A.2", citation_page: "p.31" },
      { key: "71641", factor: 0.95, citation_rule: "ISO §5.A.2", citation_page: "p.31" },
    ];
    const out = encodeCsv(rows, ftSchema);
    expect(out).toBe(
      [
        "key,factor,citation_rule,citation_page",
        "71641,0.95,ISO §5.A.2,p.31",
        "91342,1.35,ISO §5.A.2,p.31",
        "",
      ].join("\n"),
    );
  });
  it("quotes fields with commas in citations", () => {
    const rows: FtRow[] = [
      { key: "K1", factor: 1.0, citation_rule: "Rule A, addendum B", citation_page: "p.1" },
    ];
    const out = encodeCsv(rows, ftSchema);
    expect(out).toContain('"Rule A, addendum B"');
  });
  it("produces byte-identical output for the same input", () => {
    const rows: FtRow[] = [
      { key: "B", factor: 1.0, citation_rule: "x", citation_page: "y" },
      { key: "A", factor: 2.0, citation_rule: "u", citation_page: "v" },
    ];
    const a = encodeCsv(rows, ftSchema);
    const b = encodeCsv(rows, ftSchema);
    expect(a).toBe(b);
  });
  it("emits LF (never CRLF) and a trailing newline", () => {
    const rows: FtRow[] = [
      { key: "K1", factor: 1.0, citation_rule: "", citation_page: "" },
    ];
    const out = encodeCsv(rows, ftSchema);
    expect(out.includes("\r")).toBe(false);
    expect(out.endsWith("\n")).toBe(true);
  });
});

// ── decodeCsv ────────────────────────────────────────────────────

describe("decodeCsv", () => {
  it("parses a simple CSV", () => {
    const text =
      "key,factor,citation_rule,citation_page\n" +
      "91342,1.35,ISO §5.A.2,p.31\n";
    const result = decodeCsv(text, ftSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual([
        { key: "91342", factor: 1.35, citation_rule: "ISO §5.A.2", citation_page: "p.31" },
      ]);
      expect(result.warnings).toEqual([]);
    }
  });
  it("strips UTF-8 BOM on read", () => {
    const text =
      "﻿key,factor,citation_rule,citation_page\n" +
      "K1,1.0,,\n";
    const result = decodeCsv(text, ftSchema);
    expect(result.ok).toBe(true);
  });
  it("normalizes CRLF to LF", () => {
    const text =
      "key,factor,citation_rule,citation_page\r\n" +
      "K1,1.0,,\r\n";
    const result = decodeCsv(text, ftSchema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(1);
  });
  it("handles quoted fields with embedded commas + escaped quotes", () => {
    const text =
      "key,factor,citation_rule,citation_page\n" +
      'K1,1.5,"Rule A, with ""quotes""",p.1\n';
    const result = decodeCsv(text, ftSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0]!.citation_rule).toBe('Rule A, with "quotes"');
    }
  });
  it("errors on missing required column", () => {
    const text = "key,factor\nK1,1.0\n"; // missing citation columns (optional; still ok)
    const result = decodeCsv(text, ftSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // optional columns: warnings
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
      expect(result.warnings[0]!.kind).toBe("missing_optional_column");
    }
  });
  it("errors on missing required `key` column", () => {
    const text = "factor,citation_rule,citation_page\n1.0,a,b\n";
    const result = decodeCsv(text, ftSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.kind).toBe("header");
      expect(result.errors[0]!.message).toContain('"key"');
    }
  });
  it("errors on type mismatch with line + column", () => {
    const text =
      "key,factor,citation_rule,citation_page\n" +
      "K1,notanumber,,\n";
    const result = decodeCsv(text, ftSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors[0]!;
      expect(err.kind).toBe("type");
      expect(err.line).toBe(2);
      expect(err.field).toBe("factor");
    }
  });
  it("errors on duplicate key", () => {
    const text =
      "key,factor,citation_rule,citation_page\n" +
      "K1,1.0,a,b\n" +
      "K1,2.0,c,d\n";
    const result = decodeCsv(text, ftSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.kind).toBe("uniqueness");
    }
  });
  it("errors on unterminated quoted field", () => {
    const text =
      "key,factor,citation_rule,citation_page\n" +
      'K1,1.0,"never closes,\n';
    const result = decodeCsv(text, ftSchema);
    expect(result.ok).toBe(false);
  });
  it("warns on unknown columns", () => {
    const text =
      "key,factor,citation_rule,citation_page,bogus\n" +
      "K1,1.0,a,b,whatever\n";
    const result = decodeCsv(text, ftSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const unknown = result.warnings.find(
        (w) => w.kind === "unknown_column",
      );
      expect(unknown).toBeDefined();
      expect(unknown?.field).toBe("bogus");
    }
  });
});

// ── Round-trip byte-stability ────────────────────────────────────

describe("encode → decode → encode round-trip", () => {
  it("is byte-stable for a 5-row table with citations + quoted fields", () => {
    const rows: FtRow[] = [
      { key: "91342", factor: 1.35, citation_rule: "ISO BOP §5.A.2", citation_page: "p.31" },
      { key: "71641", factor: 0.95, citation_rule: 'ISO BOP §5.A.2, footnote "a"', citation_page: "p.32" },
      { key: "58291", factor: 1.55, citation_rule: "Carrier proprietary", citation_page: "internal" },
      { key: "10101", factor: 0.88, citation_rule: "", citation_page: "" },
      { key: "73912", factor: 1.4, citation_rule: "ISO BOP §5.A.3", citation_page: "p.40" },
    ];
    const csv1 = encodeCsv(rows, ftSchema);
    const decoded = decodeCsv(csv1, ftSchema);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const csv2 = encodeCsv(decoded.rows, ftSchema);
    expect(csv2).toBe(csv1);
  });
});

// ── computeDiff ──────────────────────────────────────────────────

describe("computeDiff", () => {
  const target: FtRow[] = [
    { key: "A", factor: 1.0, citation_rule: "x", citation_page: "p1" },
    { key: "B", factor: 1.2, citation_rule: "y", citation_page: "p2" },
    { key: "C", factor: 1.5, citation_rule: "z", citation_page: "p3" },
  ];

  it("classifies identical sets as all unchanged", () => {
    const csv = [...target];
    const diff = computeDiff({ target, csv, schema: ftSchema });
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged_count).toBe(3);
  });

  it("classifies added rows in merge mode", () => {
    const csv = [
      ...target,
      { key: "D", factor: 2.0, citation_rule: "w", citation_page: "p4" },
    ];
    const diff = computeDiff({ target, csv, schema: ftSchema });
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]!.key).toBe("D");
    expect(diff.removed).toEqual([]); // merge mode does not surface removed
  });

  it("classifies changed rows + records per-field deltas", () => {
    const csv = [
      target[0]!,
      { key: "B", factor: 1.3, citation_rule: "y", citation_page: "p2" }, // factor changed
      target[2]!,
    ];
    const diff = computeDiff({ target, csv, schema: ftSchema });
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]!.key).toBe("B");
    expect(diff.changed[0]!.field_changes).toHaveLength(1);
    expect(diff.changed[0]!.field_changes[0]!.field).toBe("factor");
    expect(diff.changed[0]!.field_changes[0]!.before_value).toBe(1.2);
    expect(diff.changed[0]!.field_changes[0]!.after_value).toBe(1.3);
  });

  it("classifies removed rows only in replace mode", () => {
    const csv = [target[0]!]; // target B, C absent
    const mergeDiff = computeDiff({ target, csv, schema: ftSchema, mode: "merge" });
    const replaceDiff = computeDiff({ target, csv, schema: ftSchema, mode: "replace" });
    expect(mergeDiff.removed).toEqual([]);
    expect(replaceDiff.removed).toHaveLength(2);
    expect(replaceDiff.removed.map((r) => r.key).sort()).toEqual(["B", "C"]);
  });

  it("respects shouldIgnore filter", () => {
    const csv = [
      target[0]!,
      { key: "OUT_OF_STATE", factor: 1.0, citation_rule: "", citation_page: "" },
    ];
    const diff = computeDiff({
      target,
      csv,
      schema: ftSchema,
      shouldIgnore: (row) =>
        row.key.startsWith("OUT_") ? "Out of scope for this plan." : null,
    });
    expect(diff.added).toEqual([]);
    expect(diff.ignored).toHaveLength(1);
    expect(diff.ignored[0]!.reason).toBe("Out of scope for this plan.");
  });

  it("output is deterministic (sorted by key)", () => {
    const csv = [
      { key: "Z", factor: 1.0, citation_rule: "", citation_page: "" },
      { key: "A", factor: 1.0, citation_rule: "", citation_page: "" },
      { key: "M", factor: 1.0, citation_rule: "", citation_page: "" },
    ];
    const a = computeDiff({ target: [], csv, schema: ftSchema });
    const b = computeDiff({ target: [], csv, schema: ftSchema });
    expect(a.added.map((r) => r.key)).toEqual(["A", "M", "Z"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── summarizeDiff ────────────────────────────────────────────────

describe("summarizeDiff", () => {
  it("counts each bucket correctly", () => {
    const csv: FtRow[] = [
      { key: "A", factor: 1.0, citation_rule: "", citation_page: "" },
      { key: "B", factor: 9.9, citation_rule: "", citation_page: "" }, // changed
      { key: "C", factor: 1.0, citation_rule: "", citation_page: "" }, // unchanged
      { key: "D", factor: 5.0, citation_rule: "", citation_page: "" }, // added
    ];
    const target: FtRow[] = [
      { key: "A", factor: 1.0, citation_rule: "", citation_page: "" },
      { key: "B", factor: 1.2, citation_rule: "", citation_page: "" },
      { key: "C", factor: 1.0, citation_rule: "", citation_page: "" },
      { key: "E", factor: 7.0, citation_rule: "", citation_page: "" }, // removed in replace
    ];
    const diff = computeDiff({ target, csv, schema: ftSchema, mode: "replace" });
    const s = summarizeDiff(diff);
    expect(s.added).toBe(1);
    expect(s.changed).toBe(1);
    expect(s.removed).toBe(1);
    expect(s.unchanged).toBe(2);
  });
});

// ── emptyDiff ────────────────────────────────────────────────────

describe("emptyDiff", () => {
  it("returns a zero-state diff with mode set", () => {
    const d = emptyDiff<FtRow>("replace");
    expect(d.added).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged_count).toBe(0);
    expect(d.mode).toBe("replace");
  });
});

// ── Validation helpers ───────────────────────────────────────────

describe("parseRequiredString", () => {
  it("trims + accepts non-empty", () => {
    expect(parseRequiredString("  hi  ", 1)).toEqual({ ok: true, value: "hi" });
  });
  it("rejects empty + whitespace-only", () => {
    expect(parseRequiredString("", 1).ok).toBe(false);
    expect(parseRequiredString("   ", 1).ok).toBe(false);
  });
});

describe("parseOptionalString", () => {
  it("accepts empty", () => {
    expect(parseOptionalString("", 1)).toEqual({ ok: true, value: "" });
  });
  it("trims", () => {
    expect(parseOptionalString("  v  ", 1)).toEqual({ ok: true, value: "v" });
  });
});

describe("parseRequiredNumber", () => {
  it("accepts integers + decimals + negatives", () => {
    expect(parseRequiredNumber("123", 1)).toEqual({ ok: true, value: 123 });
    expect(parseRequiredNumber("1.25", 1)).toEqual({ ok: true, value: 1.25 });
    expect(parseRequiredNumber("-0.5", 1)).toEqual({ ok: true, value: -0.5 });
  });
  it("rejects empty", () => {
    expect(parseRequiredNumber("", 1).ok).toBe(false);
  });
  it("rejects non-numeric", () => {
    expect(parseRequiredNumber("abc", 1).ok).toBe(false);
  });
  it("rejects thousands separators (ADR-0017 anti-pattern #7)", () => {
    const r = parseRequiredNumber("1,000", 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("thousands separators");
  });
  it("rejects NaN + Infinity", () => {
    expect(parseRequiredNumber("NaN", 1).ok).toBe(false);
    expect(parseRequiredNumber("Infinity", 1).ok).toBe(false);
  });
});

describe("parseOptionalNumber", () => {
  it("returns null for empty", () => {
    expect(parseOptionalNumber("", 1)).toEqual({ ok: true, value: null });
  });
  it("parses non-empty", () => {
    expect(parseOptionalNumber("3.14", 1)).toEqual({ ok: true, value: 3.14 });
  });
});

describe("parsePositiveNumber", () => {
  it("rejects zero + negative", () => {
    expect(parsePositiveNumber("0", 1).ok).toBe(false);
    expect(parsePositiveNumber("-1", 1).ok).toBe(false);
  });
  it("accepts positive", () => {
    expect(parsePositiveNumber("0.001", 1).ok).toBe(true);
  });
});

describe("parseNonNegativeNumber", () => {
  it("accepts zero", () => {
    expect(parseNonNegativeNumber("0", 1)).toEqual({ ok: true, value: 0 });
  });
  it("rejects negative", () => {
    expect(parseNonNegativeNumber("-0.5", 1).ok).toBe(false);
  });
});

describe("parseInteger", () => {
  it("accepts integer literals", () => {
    expect(parseInteger("42", 1)).toEqual({ ok: true, value: 42 });
    expect(parseInteger("-7", 1)).toEqual({ ok: true, value: -7 });
  });
  it("rejects decimals", () => {
    expect(parseInteger("1.5", 1).ok).toBe(false);
  });
});

describe("parseEnum", () => {
  const dispParse = parseEnum(["accept", "decline", "refer"] as const);
  it("accepts vocabulary members", () => {
    expect(dispParse("decline", 1)).toEqual({ ok: true, value: "decline" });
  });
  it("rejects non-members with helpful error", () => {
    const r = dispParse("yolo", 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("accept");
      expect(r.error).toContain("decline");
      expect(r.error).toContain("refer");
    }
  });
});
