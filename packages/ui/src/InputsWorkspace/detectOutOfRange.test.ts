/**
 * Unit tests for detectOutOfRange (cold-test L22).
 *
 * Locks the score-time out-of-range surface:
 *   - counts rows whose `derive.band` trace flagged out_of_range
 *   - groups by dim, sorts most-impacted first
 *   - reports the projector's `clampToNearest` flag back to the UI
 *   - returns [] when no derive.band node fired out of range
 */

import { describe, it, expect } from "vitest";
import type { Plan, RunResult, TraceEntry } from "@openrater/contracts";
import { detectOutOfRange, hasOutOfRange } from "./detectOutOfRange";

// A minimal plan carrying two banded dims + one non-band node.
const PLAN = {
  id: "p",
  version: "0.1.0",
  name: "test",
  line: "cgl",
  effective: "2026-01-01",
  nodes: [
    {
      id: "band_do_revenue",
      kind: "derive.band",
      params: { dimSlug: "revenue", clampToNearest: true, levels: [] },
    },
    {
      id: "band_gl_payroll",
      kind: "derive.band",
      params: { dimSlug: "payroll", clampToNearest: false, levels: [] },
    },
    { id: "lk_x", kind: "lookup.direct", params: { table: {} } },
  ],
  edges: [],
} as unknown as Plan;

function bandEntry(outOfRange: boolean): TraceEntry {
  return {
    kindId: "derive.band",
    inputs: { value: 1 },
    outputs: { level_id: "x", out_of_range: outOfRange },
  };
}

function row(revenueOOR: boolean, payrollOOR: boolean): RunResult {
  return {
    outputs: {},
    trace: {
      band_do_revenue: bandEntry(revenueOOR),
      band_gl_payroll: bandEntry(payrollOOR),
      lk_x: { kindId: "lookup.direct", inputs: {}, outputs: { value: 1 } },
    },
    startedAt: 0,
    durationMs: 0,
    as_of: "2026-01-01",
    row_status: "ok",
  };
}

describe("detectOutOfRange", () => {
  it("returns [] when no banded value is out of range", () => {
    const results = [row(false, false), row(false, false)];
    expect(detectOutOfRange(PLAN, results)).toEqual([]);
    expect(hasOutOfRange(detectOutOfRange(PLAN, results))).toBe(false);
  });

  it("counts out-of-range rows per banded dim", () => {
    // 3 rows: revenue OOR on 2, payroll OOR on 1.
    const results = [row(true, false), row(true, true), row(false, false)];
    const bands = detectOutOfRange(PLAN, results);
    expect(bands).toHaveLength(2);
    // Most-impacted first → revenue (2) before payroll (1).
    expect(bands[0]?.dimSlug).toBe("revenue");
    expect(bands[0]?.count).toBe(2);
    expect(bands[0]?.total).toBe(3);
    expect(bands[1]?.dimSlug).toBe("payroll");
    expect(bands[1]?.count).toBe(1);
  });

  it("reports the projector's clampToNearest flag per dim", () => {
    const results = [row(true, true)];
    const bands = detectOutOfRange(PLAN, results);
    const revenue = bands.find((b) => b.dimSlug === "revenue");
    const payroll = bands.find((b) => b.dimSlug === "payroll");
    // revenue node has clampToNearest:true; payroll has false.
    expect(revenue?.clamped).toBe(true);
    expect(payroll?.clamped).toBe(false);
  });

  it("returns [] when the plan has no derive.band nodes", () => {
    const noBands = {
      ...PLAN,
      nodes: [{ id: "lk_x", kind: "lookup.direct", params: {} }],
    } as unknown as Plan;
    expect(detectOutOfRange(noBands, [row(true, true)])).toEqual([]);
  });

  it("ignores rows missing the band trace entry (defensive)", () => {
    const partial: RunResult = {
      outputs: {},
      trace: {}, // no band entries at all
      startedAt: 0,
      durationMs: 0,
      as_of: "2026-01-01",
      row_status: "ok",
    };
    expect(detectOutOfRange(PLAN, [partial])).toEqual([]);
  });
});
