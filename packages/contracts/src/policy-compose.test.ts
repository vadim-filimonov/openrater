/**
 * composePolicy tests (ADR-0034 §2).
 *
 * Proves the composition contract:
 *   - sums line premiums; applies package_credit; floors at minimum
 *   - reads each line's DECLARED premium_output (a field name)
 *   - is GENERIC over products — a bop+auto+wc policy composes via the
 *     identical function as do+cgl (ADR-0033 §0 / ADR-0034 §0)
 *   - works over real multi-node compiled plans, not just passthrough
 *   - fails LOUDLY when premium_output doesn't resolve to a finite number
 *   - is reproducible (engine-contract §6)
 *
 * Uses minimal input/output/mul stub kinds (the runtime special-cases
 * input + output by id) so the test exercises composePolicy + the real
 * runtime without depending on the 18 production kinds.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { compilePlan } from "./runtime";
import { registerBlockKind, _clearRegistryForTests } from "./registry";
import { composePolicy, evaluatePolicyTail } from "./policy-compose";
import { makeIrpmAdjustmentResolver } from "./irpm-source";
import type {
  ResolvedPolicyLine,
  AdjustmentResolver,
  ComposePolicyOptions,
} from "./policy-compose";
import type { BlockKind } from "./block-types";
import type { Plan } from "./plan-types";
import { effectivePolicyTail } from "./policy-types";
import type { Policy, PolicyLine, PolicyResult } from "./policy-types";
import type { PolicyAdjustment } from "./policy-adjustments";
import type { ProductCode } from "./product-types";

const INPUT_KIND: BlockKind = {
  id: "input",
  category: "input",
  label: "Input",
  description: "External input substitution (special-cased by runtime)",
  inputs: [],
  outputs: [{ name: "value", type: "factor" }],
  defaultParams: {},
  defaultSize: "regular",
  execute: () => ({ value: undefined }),
};

const OUTPUT_KIND: BlockKind = {
  id: "output",
  category: "output",
  label: "Output",
  description: "Plan output (special-cased by runtime)",
  inputs: [{ name: "value", type: "factor" }],
  outputs: [],
  defaultParams: {},
  defaultSize: "regular",
  execute: () => ({}),
};

const MUL_KIND: BlockKind = {
  id: "test.mul",
  category: "math",
  label: "Multiply",
  description: "out = x * y",
  inputs: [
    { name: "x", type: "factor" },
    { name: "y", type: "factor" },
  ],
  outputs: [{ name: "result", type: "factor" }],
  defaultParams: {},
  defaultSize: "regular",
  execute: (inputs) => {
    const { x, y } = inputs as { x: number; y: number };
    return { result: x * y };
  },
};

beforeEach(() => {
  _clearRegistryForTests();
  registerBlockKind(INPUT_KIND);
  registerBlockKind(OUTPUT_KIND);
  registerBlockKind(MUL_KIND);
});

/** A plan whose single output equals its single input (premium is fed
 *  in directly — isolates composePolicy from the rating math). */
function passthroughPlan(id: string, inField: string, outField: string): Plan {
  return {
    id,
    version: "0.1.0",
    name: id,
    nodes: [
      { id: "in", kind: "input", params: { fieldName: inField } },
      { id: "out", kind: "output", params: { fieldName: outField } },
    ],
    edges: [
      { from: { node: "in", port: "value" }, to: { node: "out", port: "value" } },
    ],
  };
}

/** A real multi-node plan: out = a * b. */
function mulPlan(
  id: string,
  aField: string,
  bField: string,
  outField: string,
): Plan {
  return {
    id,
    version: "0.1.0",
    name: id,
    nodes: [
      { id: "a", kind: "input", params: { fieldName: aField } },
      { id: "b", kind: "input", params: { fieldName: bField } },
      { id: "m", kind: "test.mul", params: {} },
      { id: "out", kind: "output", params: { fieldName: outField } },
    ],
    edges: [
      { from: { node: "a", port: "value" }, to: { node: "m", port: "x" } },
      { from: { node: "b", port: "value" }, to: { node: "m", port: "y" } },
      { from: { node: "m", port: "result" }, to: { node: "out", port: "value" } },
    ],
  };
}

function line(
  plan_id: string,
  product: ProductCode,
  premium_output: string,
): PolicyLine {
  return {
    plan_ref: { plan_id, content_hash: "h", product },
    premium_output,
  };
}

describe("composePolicy — composition math", () => {
  it("sums line premiums (no credit, no floor)", () => {
    const doC = compilePlan(passthroughPlan("plan-do", "do_in", "do_premium"));
    const glC = compilePlan(passthroughPlan("plan-gl", "gl_in", "gl_premium"));
    const policy: Policy = {
      policy_id: "P",
      lines: [line("plan-do", "do", "do_premium"), line("plan-gl", "cgl", "gl_premium")],
    };
    const r = composePolicy(policy, (l) =>
      l.plan_ref.plan_id === "plan-do"
        ? { compiled: doC, externalInputs: { do_in: 600 } }
        : { compiled: glC, externalInputs: { gl_in: 300 } },
    );

    expect(r.subtotal).toBe(900);
    expect(r.package_credit).toBe(1);
    expect(r.after_credit).toBe(900);
    expect(r.minimum_premium).toBe(0);
    expect(r.minimum_applied).toBe(false);
    expect(r.total).toBe(900);
    expect(r.lines.map((x) => [x.product, x.plan_id, x.premium])).toEqual([
      ["do", "plan-do", 600],
      ["cgl", "plan-gl", 300],
    ]);
  });

  it("applies a policy-level package_credit", () => {
    const c = compilePlan(passthroughPlan("p", "in", "prem"));
    const policy: Policy = {
      policy_id: "P",
      lines: [line("p", "do", "prem")],
      package_credit: 0.9,
    };
    const r = composePolicy(policy, () => ({ compiled: c, externalInputs: { in: 1000 } }));
    expect(r.subtotal).toBe(1000);
    expect(r.package_credit).toBe(0.9);
    expect(r.after_credit).toBe(900);
    expect(r.total).toBe(900);
    expect(r.minimum_applied).toBe(false);
  });

  it("floors at minimum_premium when the credit drops below it", () => {
    const c = compilePlan(passthroughPlan("p", "in", "prem"));
    const policy: Policy = {
      policy_id: "P",
      lines: [line("p", "do", "prem")],
      package_credit: 0.5,
      minimum_premium: 600,
    };
    const r = composePolicy(policy, () => ({ compiled: c, externalInputs: { in: 1000 } }));
    expect(r.after_credit).toBe(500);
    expect(r.minimum_premium).toBe(600);
    expect(r.minimum_applied).toBe(true);
    expect(r.total).toBe(600);
  });

  it("does NOT floor when the total clears the minimum", () => {
    const c = compilePlan(passthroughPlan("p", "in", "prem"));
    const policy: Policy = {
      policy_id: "P",
      lines: [line("p", "do", "prem")],
      minimum_premium: 500,
    };
    const r = composePolicy(policy, () => ({ compiled: c, externalInputs: { in: 900 } }));
    expect(r.minimum_applied).toBe(false);
    expect(r.total).toBe(900);
  });

  it("reads the output of a real multi-node plan (out = a*b)", () => {
    const c = compilePlan(mulPlan("plan-do", "base", "rate", "do_premium"));
    const policy: Policy = { policy_id: "P", lines: [line("plan-do", "do", "do_premium")] };
    const r = composePolicy(policy, () => ({
      compiled: c,
      externalInputs: { base: 200, rate: 3 },
    }));
    expect(r.total).toBe(600);
    expect(r.lines[0]?.premium).toBe(600);
    // the full outputs map is carried through for the trace exhibit
    expect(r.lines[0]?.outputs.do_premium).toBe(600);
  });
});

describe("composePolicy — genericity (ADR-0033 §0 / ADR-0034 §0)", () => {
  it("composes an arbitrary product mix via the IDENTICAL function", () => {
    // bop + auto + wc — three products this codebase has never 'special-
    // cased'. They compose through the same composePolicy as do+cgl,
    // proving the composer never branches on a product.
    const bop = compilePlan(passthroughPlan("plan-bop", "bop_in", "bop_premium"));
    const auto = compilePlan(passthroughPlan("plan-auto", "auto_in", "auto_premium"));
    const wc = compilePlan(passthroughPlan("plan-wc", "wc_in", "wc_premium"));

    const byId: Record<string, ResolvedPolicyLine> = {
      "plan-bop": { compiled: bop, externalInputs: { bop_in: 100 } },
      "plan-auto": { compiled: auto, externalInputs: { auto_in: 200 } },
      "plan-wc": { compiled: wc, externalInputs: { wc_in: 300 } },
    };

    const policy: Policy = {
      policy_id: "MIXED",
      lines: [
        line("plan-bop", "bop", "bop_premium"),
        line("plan-auto", "auto", "auto_premium"),
        line("plan-wc", "wc", "wc_premium"),
      ],
    };

    const r = composePolicy(policy, (l) => {
      const resolved = byId[l.plan_ref.plan_id];
      if (!resolved) throw new Error(`no resolution for ${l.plan_ref.plan_id}`);
      return resolved;
    });
    expect(r.total).toBe(600);
    expect(r.lines.map((x) => x.product)).toEqual(["bop", "auto", "wc"]);
  });

  it("composes a bop+auto+wc policy WITH an IRPM + endorsement via the IDENTICAL path", () => {
    // The post-aggregation tail is product-blind too: a three-product
    // policy runs the same adjustment loop as do+cgl (Brief 62.1 §4).
    const bop = compilePlan(passthroughPlan("plan-bop", "bop_in", "bop_premium"));
    const auto = compilePlan(passthroughPlan("plan-auto", "auto_in", "auto_premium"));
    const wc = compilePlan(passthroughPlan("plan-wc", "wc_in", "wc_premium"));
    const byId: Record<string, ResolvedPolicyLine> = {
      "plan-bop": { compiled: bop, externalInputs: { bop_in: 100 } },
      "plan-auto": { compiled: auto, externalInputs: { auto_in: 200 } },
      "plan-wc": { compiled: wc, externalInputs: { wc_in: 300 } },
    };
    const policy: Policy = {
      policy_id: "MIXED-TAIL",
      lines: [
        line("plan-bop", "bop", "bop_premium"),
        line("plan-auto", "auto", "auto_premium"),
        line("plan-wc", "wc", "wc_premium"),
      ],
      adjustments: [
        { kind: "schedule_rating", id: "irpm", display_name: "IRPM", cap_pct: 25, source: { from: "literal", total: -10 } },
        { kind: "endorsement", id: "terror", display_name: "Terrorism", effect: { kind: "flat", amount: 18 } },
        { kind: "minimum_premium", id: "min", floor: 500 },
      ],
    };
    const r = composePolicy(policy, (l) => {
      const resolved = byId[l.plan_ref.plan_id];
      if (!resolved) throw new Error(`no resolution for ${l.plan_ref.plan_id}`);
      return resolved;
    });
    expect(r.subtotal).toBe(600); // 100 + 200 + 300
    expect(r.total).toBe(558); // 600 × 0.9 = 540, + 18 = 558, floor 500 clears
    expect(r.adjustments.map((s) => s.kind)).toEqual([
      "schedule_rating",
      "endorsement",
      "minimum_premium",
    ]);
    expect(r.lines.map((x) => x.product)).toEqual(["bop", "auto", "wc"]);
  });

  it("a bop plan's inherited policy_tail composes via the IDENTICAL path as a tail-less do+cgl policy (Brief 62.3 §5)", () => {
    // effectivePolicyTail inherits the plan's filed default tail; the
    // composer then treats it as any other adjustments[] — no product or
    // plan-vs-policy branch. A `bop` plan WITH a tail and a `do+cgl` policy
    // WITHOUT one run the same composePolicy.
    const c = compilePlan(passthroughPlan("p", "in", "prem"));
    const planTail: PolicyAdjustment[] = [
      { kind: "package_factor", id: "pioneer", display_name: "Pioneer", factor: 0.9 },
      { kind: "minimum_premium", id: "min", floor: 500 },
    ];
    const bopTail = effectivePolicyTail({ policy_tail: planTail }, {}); // inherits planTail
    const bopPolicy: Policy = {
      policy_id: "BOP",
      lines: [line("p", "bop", "prem")],
      ...(bopTail ? { adjustments: bopTail } : {}),
    };
    const withTailResult = composePolicy(bopPolicy, () => ({ compiled: c, externalInputs: { in: 1000 } }));
    expect(withTailResult.total).toBe(900); // 1000 × 0.9 = 900, floor 500 clears
    expect(withTailResult.adjustments.map((s) => s.kind)).toEqual(["package_factor", "minimum_premium"]);

    // The tail-less do+cgl policy: effectivePolicyTail returns undefined, so
    // it authors NO adjustments and composePolicy synthesizes the legacy
    // 2-step tail — same function, same code path, no branch on the missing
    // tail or the products.
    expect(effectivePolicyTail({}, {})).toBeUndefined();
    const doglPolicy: Policy = {
      policy_id: "DOGL",
      lines: [line("a", "do", "prem"), line("b", "cgl", "prem")],
    };
    const tailless = composePolicy(doglPolicy, () => ({ compiled: c, externalInputs: { in: 250 } }));
    expect(tailless.total).toBe(500); // 250 + 250 = 500, no credit, no floor
    expect(tailless.adjustments.map((s) => s.kind)).toEqual(["package_factor", "minimum_premium"]);
  });
});

describe("composePolicy — strictness + determinism", () => {
  it("throws when premium_output names a field the plan doesn't output", () => {
    const c = compilePlan(passthroughPlan("p", "in", "prem"));
    const policy: Policy = { policy_id: "P", lines: [line("p", "do", "nonexistent")] };
    expect(() =>
      composePolicy(policy, () => ({ compiled: c, externalInputs: { in: 100 } })),
    ).toThrow(/did not resolve to a finite number/i);
  });

  it("throws when the output is non-numeric (no silent NaN in the book)", () => {
    const c = compilePlan(passthroughPlan("p", "in", "prem"));
    const policy: Policy = { policy_id: "P", lines: [line("p", "do", "prem")] };
    expect(() =>
      composePolicy(policy, () => ({ compiled: c, externalInputs: { in: "oops" } })),
    ).toThrow(/string "oops"/);
  });

  it("calls resolve exactly once per line", () => {
    const c = compilePlan(passthroughPlan("p", "in", "prem"));
    const policy: Policy = {
      policy_id: "P",
      lines: [line("a", "do", "prem"), line("b", "cgl", "prem")],
    };
    const resolve = vi.fn(() => ({ compiled: c, externalInputs: { in: 1 } }));
    composePolicy(policy, resolve);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("is reproducible — same inputs produce identical results", () => {
    const c = compilePlan(mulPlan("p", "base", "rate", "prem"));
    const policy: Policy = {
      policy_id: "P",
      lines: [line("p", "do", "prem")],
      package_credit: 0.97,
      minimum_premium: 250,
    };
    const resolve = () => ({ compiled: c, externalInputs: { base: 1234, rate: 1.1 } });
    const a = composePolicy(policy, resolve, { as_of: "2024-01-01" });
    const b = composePolicy(policy, resolve, { as_of: "2024-01-01" });
    expect(a.total).toBe(b.total);
    expect(a.lines.map((x) => x.premium)).toEqual(b.lines.map((x) => x.premium));
  });
});

// ── Brief 62.1 — the ordered post-aggregation adjustments tail ────────

/** Compose a single-line policy whose line premium IS `premium` (a
 *  passthrough plan), with an authored `adjustments[]`. Isolates the tail
 *  from the rating math. */
function withTail(
  premium: number,
  adjustments: PolicyAdjustment[],
  options?: ComposePolicyOptions,
): PolicyResult {
  const c = compilePlan(passthroughPlan("p", "in", "prem"));
  const policy: Policy = {
    policy_id: "P",
    lines: [line("p", "bop", "prem")],
    adjustments,
  };
  return composePolicy(policy, () => ({ compiled: c, externalInputs: { in: premium } }), options);
}

describe("composePolicy — adjustments tail (Brief 62.1)", () => {
  it("schedule_rating caps on the SUM of sub-sections and stores them", () => {
    const r = withTail(3000, [
      {
        kind: "schedule_rating",
        id: "sr",
        display_name: "IRPM",
        cap_pct: 25,
        source: { from: "literal", sections: { management: -3, location: -4 } },
      },
    ]);
    expect(r.total).toBe(2790); // 3000 × (1 − 0.07)
    const step = r.adjustments[0]!;
    expect(step.applied).toBe(true);
    expect(step.before).toBe(3000);
    expect(step.after).toBe(2790);
    expect(step.factor_or_delta).toBeCloseTo(0.93, 10);
    expect(step.sections).toEqual({ management: -3, location: -4 });
    expect(step.provenance).toEqual({ source: "literal" });
    expect(step.detail).toBe("-7.0% (Σ 2 sections, cap ±25%)");
  });

  it("schedule_rating clamps a net beyond the cap", () => {
    const r = withTail(1000, [
      {
        kind: "schedule_rating",
        id: "sr",
        display_name: "IRPM",
        cap_pct: 25,
        source: { from: "literal", total: -40 },
      },
    ]);
    expect(r.total).toBe(750); // clamped to −25% → ×0.75
    expect(r.adjustments[0]!.detail).toBe("-25.0% (cap ±25%)");
  });

  it("package_factor applies only when its guard matches (visible no-op otherwise)", () => {
    const applied = withTail(
      1000,
      [{ kind: "package_factor", id: "pioneer", display_name: "Pioneer", factor: 0.9, when: { field: "is_first_term", op: "eq", value: true } }],
      { adjustmentInputs: { is_first_term: true } },
    );
    expect(applied.total).toBe(900);
    expect(applied.adjustments[0]!.applied).toBe(true);

    const skipped = withTail(
      1000,
      [{ kind: "package_factor", id: "pioneer", display_name: "Pioneer", factor: 0.9, when: { field: "is_first_term", op: "eq", value: true } }],
      { adjustmentInputs: { is_first_term: false } },
    );
    expect(skipped.total).toBe(1000); // unchanged
    const step = skipped.adjustments[0]!;
    expect(step.applied).toBe(false);
    expect(step.factor_or_delta).toBe(1);
    expect(step.after).toBe(step.before);
  });

  it("endorsement applies a flat charge or a factor", () => {
    const flat = withTail(1000, [
      { kind: "endorsement", id: "terror", display_name: "Terrorism", effect: { kind: "flat", amount: 18 } },
    ]);
    expect(flat.total).toBe(1018);
    expect(flat.adjustments[0]!.factor_or_delta).toBe(18);
    expect(flat.adjustments[0]!.detail).toBe("+ $18");

    const factor = withTail(1000, [
      { kind: "endorsement", id: "e2", display_name: "Factor endt", effect: { kind: "factor", factor: 1.05 } },
    ]);
    expect(factor.total).toBe(1050);
  });

  it("a guarded flat endorsement neutral is +0 (not ×1)", () => {
    const r = withTail(
      1000,
      [{ kind: "endorsement", id: "e", display_name: "E", effect: { kind: "flat", amount: 50 }, when: { field: "elect", op: "eq", value: true } }],
      { adjustmentInputs: { elect: false } },
    );
    expect(r.total).toBe(1000);
    expect(r.adjustments[0]!.factor_or_delta).toBe(0);
  });

  it("minimum_premium floors the running total (binding) or is a no-op", () => {
    const bind = withTail(100, [{ kind: "minimum_premium", id: "min", floor: 500 }]);
    expect(bind.total).toBe(500);
    expect(bind.minimum_applied).toBe(true);
    expect(bind.adjustments[0]!.applied).toBe(true);
    expect(bind.adjustments[0]!.factor_or_delta).toBe(400);
    expect(bind.adjustments[0]!.detail).toBe("floored at $500");

    const clear = withTail(1000, [{ kind: "minimum_premium", id: "min", floor: 500 }]);
    expect(clear.total).toBe(1000);
    expect(clear.minimum_applied).toBe(false);
    expect(clear.adjustments[0]!.applied).toBe(false);
    expect(clear.adjustments[0]!.detail).toBe("floor $500 not binding");
  });

  it("threads the running total through an ordered IRPM → package → endorsement → min tail", () => {
    const r = withTail(
      1000,
      [
        { kind: "schedule_rating", id: "sr", display_name: "IRPM", cap_pct: 25, source: { from: "literal", total: -10 } },
        { kind: "package_factor", id: "pioneer", display_name: "Pioneer", factor: 0.9, when: { field: "is_first_term", op: "eq", value: true } },
        { kind: "endorsement", id: "terror", display_name: "Terrorism", effect: { kind: "flat", amount: 18 } },
        { kind: "minimum_premium", id: "min", floor: 500 },
      ],
      { adjustmentInputs: { is_first_term: true } },
    );
    expect(r.adjustments.map((s) => [s.before, s.after])).toEqual([
      [1000, 900], // ×0.9 IRPM
      [900, 810], //  ×0.9 Pioneer
      [810, 828], //  +18 terrorism
      [828, 828], //  $500 floor not binding
    ]);
    expect(r.total).toBe(828);
    // Derived legacy fields: package_credit is the Π of package_factor steps
    // only; after_credit keeps its ADR-0034 meaning (subtotal × credit).
    expect(r.package_credit).toBe(0.9);
    expect(r.after_credit).toBe(900);
    expect(r.minimum_premium).toBe(500);
    expect(r.minimum_applied).toBe(false);
  });

  it("throws (Validate-early) when a non-literal source has no resolveAdjustment", () => {
    expect(() =>
      withTail(1000, [
        { kind: "schedule_rating", id: "sr", display_name: "IRPM", cap_pct: 25, source: { from: "column", column: "irpm_total_pct" } },
      ]),
    ).toThrow(/resolveAdjustment was provided/i);
  });

  it("resolves a non-literal source through the injected resolver (source-blind)", () => {
    const resolveAdjustment: AdjustmentResolver = (adj) => {
      expect(adj.id).toBe("sr");
      return { kind: "factor", net: -10, provenance: { source: "column" } };
    };
    const r = withTail(
      1000,
      [{ kind: "schedule_rating", id: "sr", display_name: "IRPM", cap_pct: 25, source: { from: "column", column: "irpm_total_pct" } }],
      { resolveAdjustment },
    );
    expect(r.total).toBe(900);
    expect(r.adjustments[0]!.provenance).toEqual({ source: "column" });
  });

  it("the injected resolver receives the computed line results in ctx", () => {
    let seenLines = -1;
    const resolveAdjustment: AdjustmentResolver = (_adj, ctx) => {
      seenLines = ctx.lines.length;
      return { kind: "flat", amount: 25, provenance: { source: "connector", snapshot_id: "snap-1" } };
    };
    const r = withTail(
      1000,
      [{ kind: "endorsement", id: "e", display_name: "E", effect: { kind: "flat", amount: 0 }, source: { from: "connector", connector_id: "c1", version: "v1" } }],
      { resolveAdjustment },
    );
    expect(seenLines).toBe(1);
    expect(r.total).toBe(1025);
    expect(r.adjustments[0]!.provenance).toEqual({ source: "connector", snapshot_id: "snap-1" });
  });

  it("is reproducible across two compositions (the adjustments path)", () => {
    const adjustments: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "sr", display_name: "IRPM", cap_pct: 25, source: { from: "literal", sections: { a: -3, b: -4 } } },
      { kind: "minimum_premium", id: "min", floor: 500 },
    ];
    const a = withTail(3000, adjustments);
    const b = withTail(3000, adjustments);
    expect(a.total).toBe(b.total);
    expect(a.adjustments).toEqual(b.adjustments);
  });
});

describe("composePolicy — back-compat (Brief 62.1 §3, the synthesized tail == an authored tail)", () => {
  const c = () => compilePlan(passthroughPlan("p", "in", "prem"));
  const resolve = (premium: number) => () => ({ compiled: c(), externalInputs: { in: premium } });

  it("a legacy package_credit + minimum_premium policy equals the equivalent authored adjustments policy", () => {
    const legacy: Policy = {
      policy_id: "EQ",
      lines: [line("p", "bop", "prem")],
      package_credit: 0.5,
      minimum_premium: 700,
    };
    const authored: Policy = {
      policy_id: "EQ",
      lines: [line("p", "bop", "prem")],
      adjustments: [
        { kind: "package_factor", id: "pc", display_name: "Package credit", factor: 0.5 },
        { kind: "minimum_premium", id: "min", floor: 700 },
      ],
    };
    const rl = composePolicy(legacy, resolve(1200));
    const ra = composePolicy(authored, resolve(1200));
    // Identical scalar build-up (the ids differ: __legacy_* vs pc/min).
    for (const key of ["subtotal", "package_credit", "after_credit", "minimum_premium", "minimum_applied", "total"] as const) {
      expect(ra[key], key).toBe(rl[key]);
    }
    expect(rl.total).toBe(700); // 1200 × 0.5 = 600, floored at 700
  });

  it("a no-adjustments policy still synthesizes the legacy 2-step trace", () => {
    const legacy: Policy = {
      policy_id: "L",
      lines: [line("p", "bop", "prem")],
      package_credit: 0.9,
      minimum_premium: 0,
    };
    const r = composePolicy(legacy, resolve(1000));
    expect(r.adjustments.map((s) => s.kind)).toEqual(["package_factor", "minimum_premium"]);
    expect(r.total).toBe(900);
  });
});

describe("evaluatePolicyTail — the pure tail core (Brief 62.3, the cohort-path API)", () => {
  it("applies the ordered tail to an already-computed subtotal WITHOUT running a plan", () => {
    const tail = evaluatePolicyTail(
      1000,
      [
        { kind: "schedule_rating", id: "irpm", display_name: "IRPM", cap_pct: 25, source: { from: "literal", total: -10 } },
        { kind: "package_factor", id: "pioneer", display_name: "Pioneer", factor: 0.9, when: { field: "is_first_term", op: "eq", value: true } },
        { kind: "endorsement", id: "terror", display_name: "Terrorism", effect: { kind: "flat", amount: 18 } },
        { kind: "minimum_premium", id: "min", floor: 500 },
      ],
      { externalInputs: { is_first_term: true }, lines: [] },
    );
    expect(tail.total).toBe(828); // 1000 ×0.9 ×0.9 +18, floor 500 clears
    expect(tail.package_credit).toBe(0.9);
    expect(tail.adjustments.map((s) => [s.before, s.after])).toEqual([
      [1000, 900],
      [900, 810],
      [810, 828],
      [828, 828],
    ]);
  });

  it("resolves a column-sourced schedule_rating per row via an injected resolver", () => {
    const adjustments: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "irpm", display_name: "IRPM", cap_pct: 25, source: { from: "column", column: "irpm_total_pct" } },
    ];
    const resolveAdjustment = makeIrpmAdjustmentResolver();
    const rowA = evaluatePolicyTail(3000, adjustments, { externalInputs: { irpm_total_pct: -7 }, lines: [] }, resolveAdjustment);
    const rowB = evaluatePolicyTail(3000, adjustments, { externalInputs: { irpm_total_pct: 10 }, lines: [] }, resolveAdjustment);
    expect(rowA.total).toBe(2790); // ×0.93
    expect(rowB.total).toBeCloseTo(3300, 6); // ×1.10
    expect(rowB.total).not.toBe(rowA.total); // DISTINCT per row — the I8 fix
    expect(rowA.adjustments[0]!.provenance).toEqual({ source: "column" });
  });

  it("a no-tail row (synthesized legacy 2-step) is a no-op on the subtotal", () => {
    const tail = evaluatePolicyTail(
      1234,
      [
        { kind: "package_factor", id: "pc", display_name: "Package credit", factor: 1 },
        { kind: "minimum_premium", id: "min", floor: 0 },
      ],
      { externalInputs: {}, lines: [] },
    );
    expect(tail.total).toBe(1234);
  });
});
