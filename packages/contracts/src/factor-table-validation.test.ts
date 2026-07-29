/**
 * Tests for validateFactorTableRows — M5.1.8 (Brief 18 PR #8).
 */

import { describe, it, expect } from "vitest";
import {
  validateFactorTableRows,
  FACTOR_TABLE_DEFAULT_KEY,
  type FactorTableValidationRow,
} from "./factor-table-validation";

const tableId = "class_factor";
const tableDisplayName = "Class factor table";

function rows(...rs: FactorTableValidationRow[]): FactorTableValidationRow[] {
  return rs;
}

const ok = (extra: Partial<FactorTableValidationRow> = {}): FactorTableValidationRow => ({
  key: "91342",
  factor: 1.35,
  citation_rule: "ISO BOP §5.A.2",
  citation_page: "p. 31",
  ...extra,
});

describe("validateFactorTableRows — clean table", () => {
  it("returns no issues for a well-formed table", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(
        {
          key: FACTOR_TABLE_DEFAULT_KEY,
          factor: 1.0,
          citation_rule: "ISO BOP §5.A.1",
          citation_page: "p. 30",
        },
        ok({ key: "09011" }),
        ok({ key: "91342" }),
      ),
    });
    expect(out).toEqual([]);
  });
});

describe("validateFactorTableRows — empty key", () => {
  it("flags rows with empty key as error", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ key: "" })),
    });
    const errs = out.filter((i) => i.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain("empty key");
  });

  it("flags rows with whitespace-only key as error", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ key: "   " })),
    });
    expect(out.find((i) => i.message.includes("empty key"))).toBeDefined();
  });
});

describe("validateFactorTableRows — duplicate keys", () => {
  it("flags duplicate non-default keys", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ key: "91342" }), ok({ key: "73912" }), ok({ key: "91342" })),
    });
    const dup = out.find((i) => i.message.includes("duplicate key"));
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe("error");
    expect(dup!.message).toContain("rows 1 and 3");
  });

  it("only emits one duplicate issue per dup-pair (not N)", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(
        ok({ key: "X" }),
        ok({ key: "X" }),
        ok({ key: "X" }),
      ),
    });
    const dups = out.filter((i) => i.message.includes("duplicate key"));
    // 2 duplicates emitted (row 2 vs 1, row 3 vs 1) — each subsequent
    // occurrence flags against the first-seen.
    expect(dups).toHaveLength(2);
  });
});

describe("validateFactorTableRows — duplicate default row", () => {
  it("flags more than one __default__ row as error", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(
        { key: FACTOR_TABLE_DEFAULT_KEY, factor: 1.0, citation_rule: "x", citation_page: "p1" },
        { key: FACTOR_TABLE_DEFAULT_KEY, factor: 1.1, citation_rule: "y", citation_page: "p2" },
      ),
    });
    expect(
      out.find((i) => i.message.includes("more than one default row")),
    ).toBeDefined();
  });

  it("accepts exactly one __default__ row", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows({
        key: FACTOR_TABLE_DEFAULT_KEY,
        factor: 1.0,
        citation_rule: "x",
        citation_page: "p1",
      }),
    });
    expect(
      out.find((i) => i.message.includes("default row")),
    ).toBeUndefined();
  });
});

describe("validateFactorTableRows — factor must be finite + positive", () => {
  it("flags non-finite factors (NaN)", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ factor: NaN })),
    });
    expect(out.find((i) => i.message.includes("not a finite number"))).toBeDefined();
  });

  it("flags non-finite factors (Infinity)", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ factor: Infinity })),
    });
    expect(out.find((i) => i.message.includes("not a finite number"))).toBeDefined();
  });

  it("flags negative factors", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ factor: -1.5 })),
    });
    expect(out.find((i) => i.message.includes("must be > 0"))).toBeDefined();
  });

  it("flags zero factors", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ factor: 0 })),
    });
    expect(out.find((i) => i.message.includes("must be > 0"))).toBeDefined();
  });
});

describe("validateFactorTableRows — missing citations (warning)", () => {
  it("flags missing rule + page as one warn issue", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows({ key: "X", factor: 1.0 }),
    });
    const warn = out.find((i) => i.severity === "warning" && i.message.includes("no citation"));
    expect(warn).toBeDefined();
  });

  it("flags missing rule (page present) separately", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows({ key: "X", factor: 1.0, citation_page: "p. 1" }),
    });
    expect(
      out.find((i) => i.message.includes("citation page but no rule")),
    ).toBeDefined();
  });

  it("flags missing page (rule present) separately", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows({ key: "X", factor: 1.0, citation_rule: "ISO §1" }),
    });
    expect(
      out.find((i) => i.message.includes("citation rule but no page")),
    ).toBeDefined();
  });
});

describe("validateFactorTableRows — Issue shape", () => {
  it("populates location with section + entity + field", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ factor: -1 })),
    });
    const issue = out[0]!;
    expect(issue.location.section).toBe("factor-tables");
    expect(issue.location.entity).toContain("class_factor");
    expect(issue.location.entity).toContain("91342");
    expect(issue.location.field).toBe("factor");
  });

  it("populates a fix_hint pointing back to the row", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ factor: -1 })),
    });
    expect(out[0]!.fix_hint).toBeDefined();
    expect(out[0]!.fix_hint?.label).toContain("91342");
  });

  it("emits deterministic ids — same input → same id", () => {
    const a = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ factor: -1 })),
    });
    const b = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(ok({ factor: -1 })),
    });
    expect(a[0]!.id).toBe(b[0]!.id);
  });
});

describe("validateFactorTableRows — combined", () => {
  it("returns all issues for a heavily-broken table", () => {
    const out = validateFactorTableRows({
      tableId,
      tableDisplayName,
      rows: rows(
        { key: "", factor: 1.0 }, // empty key
        { key: "X", factor: -1.0 }, // negative factor
        { key: "X", factor: 1.0 }, // duplicate key
        { key: "Y", factor: NaN }, // non-finite + missing citation
        {
          key: FACTOR_TABLE_DEFAULT_KEY,
          factor: 1.0,
          citation_rule: "ok",
          citation_page: "p1",
        },
        {
          key: FACTOR_TABLE_DEFAULT_KEY,
          factor: 1.0,
          citation_rule: "ok",
          citation_page: "p1",
        }, // duplicate default
      ),
    });
    // We expect many issues; just assert the categories.
    const errors = out.filter((i) => i.severity === "error");
    const warnings = out.filter((i) => i.severity === "warning");
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });
});
