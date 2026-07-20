/** Policy-adjustment schema-validation tests. */

import { describe, it, expect } from "vitest";
import { isGuardExpr, isPolicyAdjustment } from "./policy-adjustments";
import type { PolicyAdjustment } from "./policy-adjustments";

describe("isGuardExpr", () => {
  it("accepts each gate-vocabulary operator", () => {
    expect(isGuardExpr({ field: "is_first_term", op: "eq", value: true })).toBe(true);
    expect(isGuardExpr({ field: "years_in_business", op: "lt", value: 3 })).toBe(true);
    expect(isGuardExpr({ field: "state", op: "in", value: ["NE", "IA"] })).toBe(true);
    expect(isGuardExpr({ field: "x", op: "ne", value: null })).toBe(true);
  });

  it("rejects a missing/empty field", () => {
    expect(isGuardExpr({ op: "eq", value: 1 })).toBe(false);
    expect(isGuardExpr({ field: "", op: "eq", value: 1 })).toBe(false);
  });

  it("rejects an operator outside the gate vocabulary", () => {
    expect(isGuardExpr({ field: "x", op: "between", value: 1 })).toBe(false);
    expect(isGuardExpr({ field: "x", op: "===", value: 1 })).toBe(false);
  });

  it("rejects when the value key is absent", () => {
    expect(isGuardExpr({ field: "x", op: "eq" })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isGuardExpr(null)).toBe(false);
    expect(isGuardExpr("eq")).toBe(false);
  });
});

describe("isPolicyAdjustment", () => {
  const schedule: PolicyAdjustment = {
    kind: "schedule_rating",
    id: "sr1",
    display_name: "Schedule rating (IRPM)",
    cap_pct: 25,
    source: { from: "literal", total: -7 },
    citation: "Meridian Rule MS-R4",
  };
  const pkg: PolicyAdjustment = {
    kind: "package_factor",
    id: "first_term_credit",
    display_name: "Meridian first-term credit",
    factor: 0.9,
    when: { field: "is_first_term", op: "eq", value: true },
  };
  const flatEndt: PolicyAdjustment = {
    kind: "endorsement",
    id: "service_fee",
    display_name: "Meridian service endorsement",
    effect: { kind: "flat", amount: 18 },
  };
  const factorEndt: PolicyAdjustment = {
    kind: "endorsement",
    id: "e2",
    display_name: "Some factor endorsement",
    effect: { kind: "factor", factor: 1.05 },
    source: { from: "column", column: "endt_amt" },
  };
  const minimum: PolicyAdjustment = {
    kind: "minimum_premium",
    id: "floor",
    floor: 500,
  };

  it("accepts each valid kind", () => {
    for (const a of [schedule, pkg, flatEndt, factorEndt, minimum]) {
      expect(isPolicyAdjustment(a), a.id).toBe(true);
    }
  });

  it("accepts a package_factor with no guard (always applies)", () => {
    expect(isPolicyAdjustment({ ...pkg, when: undefined })).toBe(true);
  });

  it("rejects a missing or empty id", () => {
    expect(isPolicyAdjustment({ ...schedule, id: "" })).toBe(false);
    const { id: _omit, ...noId } = schedule;
    expect(isPolicyAdjustment(noId)).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(isPolicyAdjustment({ ...schedule, kind: "rounding" })).toBe(false);
  });

  it("rejects schedule_rating with a bad cap or source", () => {
    expect(isPolicyAdjustment({ ...schedule, cap_pct: "25" })).toBe(false);
    expect(isPolicyAdjustment({ ...schedule, source: { from: "literal", total: "x" } })).toBe(false);
    const { source: _s, ...noSource } = schedule;
    expect(isPolicyAdjustment(noSource)).toBe(false);
  });

  it("rejects package_factor with a non-numeric factor or bad guard", () => {
    expect(isPolicyAdjustment({ ...pkg, factor: "0.9" })).toBe(false);
    expect(isPolicyAdjustment({ ...pkg, when: { field: "x", op: "nope", value: 1 } })).toBe(false);
  });

  it("rejects endorsement with a malformed effect", () => {
    expect(isPolicyAdjustment({ ...flatEndt, effect: { kind: "flat" } })).toBe(false);
    expect(isPolicyAdjustment({ ...flatEndt, effect: { kind: "factor", amount: 1 } })).toBe(false);
    expect(isPolicyAdjustment({ ...flatEndt, effect: { kind: "weird", x: 1 } })).toBe(false);
  });

  it("rejects minimum_premium with a non-numeric floor", () => {
    expect(isPolicyAdjustment({ ...minimum, floor: "500" })).toBe(false);
    const { floor: _f, ...noFloor } = minimum;
    expect(isPolicyAdjustment(noFloor)).toBe(false);
  });

  it("rejects a non-string citation", () => {
    expect(isPolicyAdjustment({ ...schedule, citation: 42 })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isPolicyAdjustment(null)).toBe(false);
    expect(isPolicyAdjustment("schedule_rating")).toBe(false);
    expect(isPolicyAdjustment([])).toBe(false);
  });
});
