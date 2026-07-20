/**
 * parseCsv2D tests — Brief 33 PR 33.5.
 */

import { describe, expect, it } from "vitest";
import { parseCsv2D } from "./parseCsv2D";

describe("parseCsv2D", () => {
  it("parses a simple 2-D CSV", () => {
    const raw = [
      "construction,owner,tenant",
      "frame,1.05,1.15",
      "joisted_masonry,0.97,1.07",
    ].join("\n");
    const parsed = parseCsv2D(raw, { fileName: "x.csv" });
    expect(parsed.colLabels).toEqual(["owner", "tenant"]);
    expect(parsed.rows).toEqual([
      { keyLabel: "frame", cells: { owner: 1.05, tenant: 1.15 } },
      {
        keyLabel: "joisted_masonry",
        cells: { owner: 0.97, tenant: 1.07 },
      },
    ]);
  });

  it("handles CRLF line endings", () => {
    const raw = "key,a\r\nfoo,1.5\r\nbar,2.5\r\n";
    const parsed = parseCsv2D(raw, { fileName: "x.csv" });
    expect(parsed.rows.length).toBe(2);
    expect(parsed.rows[0]!.cells.a).toBe(1.5);
  });

  it("strips blank lines", () => {
    const raw = "key,a\n\nfoo,1.5\n\n\nbar,2.5";
    const parsed = parseCsv2D(raw, { fileName: "x.csv" });
    expect(parsed.rows.length).toBe(2);
  });

  it("treats empty cells as null", () => {
    const raw = "key,a,b\nfoo,1.5,";
    const parsed = parseCsv2D(raw, { fileName: "x.csv" });
    expect(parsed.rows[0]!.cells.b).toBe(null);
  });

  it("treats non-numeric cells as null", () => {
    const raw = "key,a\nfoo,N/A";
    const parsed = parseCsv2D(raw, { fileName: "x.csv" });
    expect(parsed.rows[0]!.cells.a).toBe(null);
  });

  it("respects double-quoted fields with commas inside", () => {
    const raw = 'key,a,b\n"frame, type A",1.0,2.0';
    const parsed = parseCsv2D(raw, { fileName: "x.csv" });
    expect(parsed.rows[0]!.keyLabel).toBe("frame, type A");
  });

  it("respects escaped double-quotes inside quoted fields", () => {
    const raw = 'key,a\n"He said ""hi""",1.0';
    const parsed = parseCsv2D(raw, { fileName: "x.csv" });
    expect(parsed.rows[0]!.keyLabel).toBe('He said "hi"');
  });

  it("throws on empty CSV", () => {
    expect(() => parseCsv2D("", { fileName: "x.csv" })).toThrow();
  });

  it("throws on header-only CSV", () => {
    expect(() => parseCsv2D("key,a", { fileName: "x.csv" })).toThrow();
  });

  it("throws when header has no value columns", () => {
    expect(() =>
      parseCsv2D("key\nfoo", { fileName: "x.csv" }),
    ).toThrow();
  });
});
