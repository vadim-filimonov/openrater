/**
 * policy-rollup — multi-location → policy roll-up (E08).
 *
 * The primitive that lets a policy hold multiple location rows and reduce
 * them (default `sum` for premium + TIV) before the policy-level appetite
 * gate (E03) reads the total.
 */

import { describe, it, expect } from "vitest";
import {
  reduceRollup,
  rollUpBook,
  rateAndRollUp,
  type BookRow,
  type RollupField,
  type KeyedRiskRow,
} from "./policy-rollup";
import { compilePlan } from "./runtime";
import { registerBuiltinKinds } from "./kinds";
import type { Plan } from "./plan-types";

registerBuiltinKinds();

describe("reduceRollup", () => {
  it("sum / avg treat null as 0; avg divides by ROW count", () => {
    expect(reduceRollup("sum", [850000, 210000])).toBe(1060000);
    expect(reduceRollup("sum", [100, null, 50])).toBe(150);
    expect(reduceRollup("avg", [100, null, 50])).toBe(50); // 150 / 3 rows
  });

  it("max / min / first ignore null; no finite value → 0", () => {
    expect(reduceRollup("max", [3, null, 9, 1])).toBe(9);
    expect(reduceRollup("min", [3, null, 9, 1])).toBe(1);
    expect(reduceRollup("first", [null, 7])).toBe(0); // first ROW is null → 0
    expect(reduceRollup("first", [7, 9])).toBe(7);
    expect(reduceRollup("max", [null, null])).toBe(0);
  });

  it("count counts rows regardless of value", () => {
    expect(reduceRollup("count", [5, null, 9])).toBe(3);
    expect(reduceRollup("count", [])).toBe(0);
  });

  it("normalizes -0 → 0", () => {
    expect(Object.is(reduceRollup("sum", [-0]), 0)).toBe(true);
  });
});

describe("rollUpBook", () => {
  const FIELDS: readonly RollupField[] = [
    { field: "premium", reducer: "sum" },
    { field: "tiv", reducer: "sum" },
  ];

  it("groups by policy_id and sums premium + TIV (the acceptance scenario)", () => {
    const book: BookRow[] = [
      { policy_id: "P1", location_id: "L1", values: { premium: 1200, tiv: 850000 } },
      { policy_id: "P1", location_id: "L2", values: { premium: 300, tiv: 210000 } },
      { policy_id: "P2", location_id: "L1", values: { premium: 400, tiv: 260000 } },
    ];
    const rolled = rollUpBook(book, FIELDS);
    expect(rolled).toHaveLength(2);

    const p1 = rolled.find((r) => r.policy_id === "P1")!;
    expect(p1.location_count).toBe(2);
    expect(p1.location_ids).toEqual(["L1", "L2"]);
    expect(p1.rolled).toEqual({ premium: 1500, tiv: 1060000 }); // IN appetite ≥ $1M
    // per-location breakdown retained for the trace
    expect(p1.breakdown.tiv).toEqual([
      { location_id: "L1", value: 850000 },
      { location_id: "L2", value: 210000 },
    ]);

    const p2 = rolled.find((r) => r.policy_id === "P2")!;
    expect(p2.location_count).toBe(1);
    expect(p2.rolled.tiv).toBe(260000); // single-location $260k → declines later
  });

  it("preserves first-seen policy order + input row order (deterministic)", () => {
    const book: BookRow[] = [
      { policy_id: "B", location_id: "1", values: { premium: 1 } },
      { policy_id: "A", location_id: "1", values: { premium: 1 } },
      { policy_id: "B", location_id: "2", values: { premium: 1 } },
    ];
    const rolled = rollUpBook(book, [{ field: "premium", reducer: "sum" }]);
    expect(rolled.map((r) => r.policy_id)).toEqual(["B", "A"]);
    expect(rolled[0]!.location_ids).toEqual(["1", "2"]);
  });

  it("supports `as` rename + mixed reducers", () => {
    const book: BookRow[] = [
      { policy_id: "P", location_id: "L1", values: { premium: 100, tiv: 500000, sqft: 4000 } },
      { policy_id: "P", location_id: "L2", values: { premium: 50, tiv: 600000, sqft: 9000 } },
    ];
    const rolled = rollUpBook(book, [
      { field: "premium", reducer: "sum", as: "policy_premium" },
      { field: "tiv", reducer: "sum", as: "policy_tiv" },
      { field: "sqft", reducer: "max", as: "largest_building_sqft" },
      { field: "premium", reducer: "count", as: "location_count" },
    ]);
    expect(rolled[0]!.rolled).toEqual({
      policy_premium: 150,
      policy_tiv: 1100000,
      largest_building_sqft: 9000,
      location_count: 2,
    });
  });

  it("a missing field rolls up to 0 (not NaN)", () => {
    const book: BookRow[] = [
      { policy_id: "P", location_id: "L1", values: { premium: 100 } }, // no tiv
    ];
    const rolled = rollUpBook(book, [{ field: "tiv", reducer: "sum" }]);
    expect(rolled[0]!.rolled.tiv).toBe(0);
  });
});

describe("rateAndRollUp — rate each location, then reduce to the policy", () => {
  // A trivial plan: premium = building_limit (input) × 0.001 + bpp_limit × 0.0005,
  // and it echoes tiv = building_limit + bpp_limit as an output. Built from
  // primitive kinds so the test exercises the real runtime.
  const plan: Plan = {
    id: "loc-rate",
    version: "1.0.0",
    name: "Location rater",
    nodes: [
      { id: "bldg", kind: "input.source", params: { fieldName: "building_limit", fieldType: "money", sourceType: "form" } },
      { id: "bpp", kind: "input.source", params: { fieldName: "bpp_limit", fieldType: "money", sourceType: "form" } },
      { id: "tiv", kind: "math.op", params: { op: "add" } },
      { id: "tiv_out", kind: "output", params: { fieldName: "tiv", fieldType: "money" } },
      { id: "prem", kind: "math.op", params: { op: "mul" } },
      { id: "rate", kind: "constant", params: { value: 0.001, type: "factor" } },
      { id: "prem_out", kind: "output", params: { fieldName: "premium", fieldType: "money" } },
    ],
    edges: [
      { from: { node: "bldg", port: "value" }, to: { node: "tiv", port: "x" } },
      { from: { node: "bpp", port: "value" }, to: { node: "tiv", port: "y" } },
      { from: { node: "tiv", port: "result" }, to: { node: "tiv_out", port: "value" } },
      { from: { node: "tiv", port: "result" }, to: { node: "prem", port: "x" } },
      { from: { node: "rate", port: "value" }, to: { node: "prem", port: "y" } },
      { from: { node: "prem", port: "result" }, to: { node: "prem_out", port: "value" } },
    ],
  };

  it("sums per-location premium + TIV across a policy's locations", () => {
    const compiled = compilePlan(plan);
    const rows: KeyedRiskRow[] = [
      { policy_id: "P1", location_id: "L1", inputs: { building_limit: 800000, bpp_limit: 50000 } },
      { policy_id: "P1", location_id: "L2", inputs: { building_limit: 180000, bpp_limit: 30000 } },
      { policy_id: "P2", location_id: "L1", inputs: { building_limit: 240000, bpp_limit: 20000 } },
    ];
    const rolled = rateAndRollUp(compiled, rows, [
      { field: "premium", reducer: "sum" },
      { field: "tiv", reducer: "sum" },
    ]);
    const p1 = rolled.find((r) => r.policy_id === "P1")!;
    // tiv: (800k+50k) + (180k+30k) = 1,060,000  → IN appetite
    expect(p1.rolled.tiv).toBe(1060000);
    // premium: 850000·0.001 + 210000·0.001 = 1060
    expect(p1.rolled.premium).toBeCloseTo(1060, 6);
    const p2 = rolled.find((r) => r.policy_id === "P2")!;
    expect(p2.rolled.tiv).toBe(260000); // < $1M
  });
});

describe("rollUpBook — raw numeric-string inputs coerce (enriched-input roll-up)", () => {
  it("sums a numeric-STRING field to its value, not a silent 0", () => {
    // A raw enriched INPUT (e.g. total_floor_area_sqft) projects as a string in
    // the book path (no dtype coercion before the roll-up). It must still sum,
    // else the policy GLM feature would silently be 0.
    const book: BookRow[] = [
      { policy_id: "P-001", location_id: "L1", values: { total_floor_area_sqft: "18000" } },
      { policy_id: "P-001", location_id: "L2", values: { total_floor_area_sqft: "5000" } },
    ];
    const rolled = rollUpBook(book, [{ field: "total_floor_area_sqft", reducer: "sum" }]);
    expect(rolled[0]!.rolled.total_floor_area_sqft).toBe(23000);
  });

  it("strips thousands commas like coerceNumber", () => {
    const book: BookRow[] = [
      { policy_id: "P", location_id: "L1", values: { x: "1,060,000" } },
    ];
    const rolled = rollUpBook(book, [{ field: "x", reducer: "sum" }]);
    expect(rolled[0]!.rolled.x).toBe(1_060_000);
  });

  it("a non-numeric string still rolls to 0 (unchanged)", () => {
    const book: BookRow[] = [{ policy_id: "P", location_id: "L1", values: { x: "n/a" } }];
    const rolled = rollUpBook(book, [{ field: "x", reducer: "sum" }]);
    expect(rolled[0]!.rolled.x).toBe(0);
  });
});
