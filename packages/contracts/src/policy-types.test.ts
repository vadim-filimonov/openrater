/**
 * Policy shape tests (ADR-0034 §1/§2).
 *
 * Verifies the isPolicy structural guard. The composePolicy ALGORITHM
 * (and its result-math invariants) is tested separately once it lands in
 * policy-compose.ts (gate 7).
 */

import { describe, it, expect } from "vitest";
import { isPolicy, effectivePolicyTail } from "./policy-types";
import type { Policy, PolicyLine } from "./policy-types";
import type { PolicyAdjustment } from "./policy-adjustments";

const doGlPolicy: Policy = {
  policy_id: "POL-1",
  lines: [
    {
      plan_ref: { plan_id: "plan-do", content_hash: "h1", product: "do" },
      premium_output: "do_premium",
    },
    {
      plan_ref: { plan_id: "plan-gl", content_hash: "h2", product: "cgl" },
      premium_output: "gl_premium",
      coverage_ids: ["premises_liability"],
    },
  ],
  package_credit: 0.95,
  minimum_premium: 500,
  account_key: "ACME-HOLDINGS",
};

describe("isPolicy type guard", () => {
  it("accepts a well-formed multi-product policy", () => {
    expect(isPolicy(doGlPolicy)).toBe(true);
  });

  it("accepts a minimal single-line policy (no optional fields)", () => {
    const minimal: Policy = {
      policy_id: "POL-2",
      lines: [
        {
          plan_ref: { plan_id: "p", content_hash: "h", product: "bop" },
          premium_output: "premium",
        },
      ],
    };
    expect(isPolicy(minimal)).toBe(true);
  });

  it("the SAME shape composes any product mix (genericity)", () => {
    // bop + auto + wc validates identically to do + cgl — no shape
    // depends on which products are referenced (ADR-0034 §0).
    const mixed: Policy = {
      policy_id: "POL-3",
      lines: [
        { plan_ref: { plan_id: "a", content_hash: "h", product: "bop" }, premium_output: "p1" },
        { plan_ref: { plan_id: "b", content_hash: "h", product: "auto" }, premium_output: "p2" },
        { plan_ref: { plan_id: "c", content_hash: "h", product: "wc" }, premium_output: "p3" },
      ],
    };
    expect(isPolicy(mixed)).toBe(true);
  });

  it("rejects an empty / missing policy_id", () => {
    expect(isPolicy({ ...doGlPolicy, policy_id: "" })).toBe(false);
    const { policy_id: _omit, ...noId } = doGlPolicy;
    expect(isPolicy(noId)).toBe(false);
  });

  it("rejects non-array lines", () => {
    expect(isPolicy({ ...doGlPolicy, lines: "nope" })).toBe(false);
  });

  it("rejects a line missing premium_output", () => {
    expect(
      isPolicy({
        policy_id: "P",
        lines: [{ plan_ref: { plan_id: "p", content_hash: "h", product: "do" } }],
      }),
    ).toBe(false);
  });

  it("rejects a line whose plan_ref.product is not a ProductCode", () => {
    expect(
      isPolicy({
        policy_id: "P",
        lines: [
          {
            plan_ref: { plan_id: "p", content_hash: "h", product: "professional" },
            premium_output: "premium",
          },
        ],
      }),
    ).toBe(false);
  });

  it("rejects a malformed plan_ref", () => {
    expect(
      isPolicy({
        policy_id: "P",
        lines: [{ plan_ref: { plan_id: "p" }, premium_output: "premium" }],
      }),
    ).toBe(false);
  });

  it("rejects wrong types on optional numeric fields", () => {
    expect(isPolicy({ ...doGlPolicy, package_credit: "0.95" })).toBe(false);
    expect(isPolicy({ ...doGlPolicy, minimum_premium: "500" })).toBe(false);
    expect(isPolicy({ ...doGlPolicy, account_key: 42 })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isPolicy(null)).toBe(false);
    expect(isPolicy(undefined)).toBe(false);
    expect(isPolicy("POL-1")).toBe(false);
    expect(isPolicy([])).toBe(false);
  });
});

describe("isPolicy — adjustments[] (Brief 62.1)", () => {
  const bopLine: PolicyLine = {
    plan_ref: { plan_id: "p", content_hash: "h", product: "bop" },
    premium_output: "premium",
  };
  const adjustmentsPolicy: Policy = {
    policy_id: "POL-ADJ",
    lines: [bopLine],
    adjustments: [
      {
        kind: "schedule_rating",
        id: "sr",
        display_name: "IRPM",
        cap_pct: 25,
        source: { from: "literal", total: 0 },
      },
      {
        kind: "package_factor",
        id: "pioneer",
        display_name: "Pioneer",
        factor: 0.9,
        when: { field: "is_first_term", op: "eq", value: true },
      },
      { kind: "minimum_premium", id: "floor", floor: 500 },
    ],
  };

  it("accepts a policy with a valid ordered tail (no legacy fields)", () => {
    expect(isPolicy(adjustmentsPolicy)).toBe(true);
  });

  it("accepts an empty adjustments array", () => {
    expect(isPolicy({ policy_id: "P", lines: [bopLine], adjustments: [] })).toBe(true);
  });

  it("rejects a non-array adjustments", () => {
    expect(isPolicy({ policy_id: "P", lines: [bopLine], adjustments: "nope" })).toBe(false);
  });

  it("rejects an invalid adjustment element", () => {
    expect(
      isPolicy({
        policy_id: "P",
        lines: [bopLine],
        adjustments: [{ kind: "schedule_rating", id: "x" }],
      }),
    ).toBe(false);
  });

  it("rejects setting BOTH adjustments and a legacy scalar (mutual exclusion)", () => {
    expect(isPolicy({ ...adjustmentsPolicy, package_credit: 0.9 })).toBe(false);
    expect(isPolicy({ ...adjustmentsPolicy, minimum_premium: 500 })).toBe(false);
  });
});

describe("effectivePolicyTail — inherit/override (Brief 62.3 §2a)", () => {
  const planTail: PolicyAdjustment[] = [
    { kind: "package_factor", id: "pioneer", display_name: "Pioneer", factor: 0.9 },
    { kind: "minimum_premium", id: "min", floor: 500 },
  ];
  const policyOverride: PolicyAdjustment[] = [
    { kind: "minimum_premium", id: "min", floor: 750 },
  ];

  it("the Policy's own adjustments[] WIN over the plan's filed default tail", () => {
    expect(
      effectivePolicyTail({ policy_tail: planTail }, { adjustments: policyOverride }),
    ).toBe(policyOverride);
  });

  it("inherits the plan's policy_tail when the policy authors no adjustments", () => {
    expect(effectivePolicyTail({ policy_tail: planTail }, {})).toBe(planTail);
    expect(effectivePolicyTail({ policy_tail: planTail })).toBe(planTail);
  });

  it("returns undefined when neither is set (composePolicy then synthesizes the legacy tail)", () => {
    expect(effectivePolicyTail({})).toBeUndefined();
    expect(effectivePolicyTail({}, {})).toBeUndefined();
  });
});
