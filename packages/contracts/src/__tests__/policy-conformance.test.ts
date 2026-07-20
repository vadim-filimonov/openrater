/**
 * Policy conformance — JSON fixture runner (ADR-0034 gate 9).
 *
 * The composition-layer complement to the engine `V*.json` vectors. Each
 * `P*.json` is a self-contained, portable artifact any third-party
 * composer can run to verify itself: a set of product plans, a policy
 * that references them, the per-line external inputs, and the expected
 * composed build-up.
 *
 * Three assertion tiers per vector (mirrors conformance.test.ts):
 *   1. schema — required shape present
 *   2. correctness — composePolicy(policy, resolve) matches `expected`
 *      to the IEEE-754 dollar
 *   3. reproducibility — two compositions are byte-identical
 *
 * Vectors are imported explicitly (no `import.meta.glob`) so the test
 * runs with stock tsc + vitest. Adding a vector is one import + one push.
 *
 * GENERICITY: the runner builds `resolve` generically from `vector.plans`
 * and never inspects a product. The same runner verifies a bop+auto
 * policy as readily as do+cgl.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { compilePlan } from "../runtime";
import { _clearRegistryForTests } from "../registry";
import { registerBuiltinKinds } from "../kinds";
import { composePolicy } from "../policy-compose";
import { effectivePolicyTail } from "../policy-types";
import { makeIrpmAdjustmentResolver } from "../irpm-source";
import type { ConnectorEvaluator } from "../irpm-source";
import type { Plan } from "../plan-types";
import type { Policy, PolicyResult } from "../policy-types";
import type { PolicyAdjustment } from "../policy-adjustments";

import P1 from "./conformance/P1.policy-compose-do-cgl.json";
import P2 from "./conformance/P2.policy-irpm-package-min.json";
import P3 from "./conformance/P3.policy-irpm-sections.json";
import P4 from "./conformance/P4.policy-minimum-floor-binds.json";
import P5 from "./conformance/P5.policy-package-factor-guarded-miss.json";
import P6 from "./conformance/P6.policy-full-tail-order.json";
// V44–V46 are composer-level IRPM-source vectors (Brief 62.2, R1): the
// schedule_rating tail item resolved per row via the irpm-source resolver.
// They carry the `V` numbers allocated in the brief but run through THIS
// composition harness (the engine V-harness imports vectors explicitly, so
// it does not pick them up).
import V44 from "./conformance/V44.schedule-column-net.json";
import V45 from "./conformance/V45.schedule-column-percategory.json";
import V46 from "./conformance/V46.schedule-column-net-clamped.json";
// P7 (model-sourced IRPM) is retired: the model arm refuses by name;
// scores travel as typed input columns (P2's
// pattern). The refusal itself is pinned in irpm-source.test.ts +
// policy-book-tail.test.ts.
// P8 — connector-sourced IRPM (Brief 62.6): the schedule_rating net comes
// from an API Lab connector, re-derived from a FROZEN snapshot (no network)
// via an injected (fixture) ConnectorEvaluator. Same composition harness;
// the engine stays source-blind; replay determinism + the cap.
import P8 from "./conformance/P8.policy-irpm-connector-snapshot.json";

interface PolicyVector {
  readonly name: string;
  readonly description: string;
  readonly policy: Policy;
  /** Policy-level inputs the `when` guards read (Brief 62.1). Optional. */
  readonly adjustmentInputs?: Record<string, unknown>;
  /** Brief 62.3 — the plan's filed default tail; inherited onto the
   *  policy via `effectivePolicyTail` when the policy authors none. */
  readonly policy_tail?: readonly PolicyAdjustment[];
  /** Brief 62.6 — fixture connector "snapshots" for `source.from ===
   *  "connector"` vectors: the net (+ optional sections) a frozen snapshot
   *  re-derives, keyed by connector_id. The harness builds a deterministic
   *  `ConnectorEvaluator` (no network) — the real API Lab service supplies
   *  the same callback at score time, replaying from the actual snapshot. */
  readonly connectors?: Readonly<
    Record<
      string,
      {
        readonly version: string;
        readonly net: number;
        readonly sections?: Readonly<Record<string, number>>;
        readonly snapshot_id?: string;
        readonly cost_usd?: number;
      }
    >
  >;
  /** Resolution source: plan + per-line externalInputs, keyed by plan_id. */
  readonly plans: Readonly<
    Record<string, { plan: Plan; externalInputs: Record<string, unknown> }>
  >;
  readonly expected: {
    readonly subtotal: number;
    readonly package_credit: number;
    readonly after_credit: number;
    readonly minimum_premium: number;
    readonly minimum_applied: boolean;
    readonly total: number;
    readonly lines: ReadonlyArray<{
      readonly product: string;
      readonly plan_id: string;
      readonly premium: number;
    }>;
    /** Brief 62.1 — the ordered adjustment trace, sans `factor_or_delta`
     *  (the dollar before/after pin the arithmetic; the derived multiplier
     *  carries IEEE-754 noise and is asserted with tolerance in the unit
     *  tests, not over-constrained here). Optional — legacy vectors omit it. */
    readonly adjustments?: ReadonlyArray<Record<string, unknown>>;
  };
}

const VECTORS: readonly PolicyVector[] = [
  P1 as PolicyVector,
  P2 as PolicyVector,
  P3 as PolicyVector,
  P4 as PolicyVector,
  P5 as PolicyVector,
  P6 as PolicyVector,
  V44 as PolicyVector,
  V45 as PolicyVector,
  V46 as PolicyVector,
  P8 as PolicyVector,
];

/** Build a deterministic ConnectorEvaluator from a vector's fixture
 *  `connectors` (the net a frozen snapshot re-derives, per connector_id).
 *  No network: this stands in for the API Lab service replaying the
 *  snapshot. Returns undefined when the vector declares no connectors. */
function connectorEvaluatorFor(v: PolicyVector): ConnectorEvaluator | undefined {
  if (!v.connectors) return undefined;
  return (ref) => {
    const c = v.connectors![ref.connector_id];
    if (!c) throw new Error(`${v.name}: no fixture connector "${ref.connector_id}"`);
    return {
      net: c.net,
      ...(c.sections !== undefined ? { sections: c.sections } : {}),
      version: c.version,
      ...(c.snapshot_id !== undefined ? { snapshot_id: c.snapshot_id } : {}),
      ...(c.cost_usd !== undefined ? { cost_usd: c.cost_usd } : {}),
    };
  };
}

/** Run one policy vector through the real composer. The plan's filed
 *  default tail (`policy_tail`) is inherited onto the policy via
 *  `effectivePolicyTail` (Brief 62.3) — exactly the normalization the
 *  batch wiring (62.3 PR3) applies per cohort row. */
function compose(v: PolicyVector): PolicyResult {
  const tail = effectivePolicyTail({ policy_tail: v.policy_tail }, v.policy);
  const policy: Policy = tail ? { ...v.policy, adjustments: tail } : v.policy;
  return composePolicy(
    policy,
    (line) => {
      const entry = v.plans[line.plan_ref.plan_id];
      if (!entry) {
        throw new Error(`${v.name}: no plan entry for "${line.plan_ref.plan_id}"`);
      }
      return {
        compiled: compilePlan(entry.plan),
        externalInputs: entry.externalInputs,
      };
    },
    // Always inject the IRPM resolver — harmless for literal / no-source
    // vectors (composePolicy only calls it for a non-literal source). The
    // fixture ConnectorEvaluator (when the vector declares `connectors`)
    // resolves a connector net; the composer never sees it.
    {
      resolveAdjustment: makeIrpmAdjustmentResolver(connectorEvaluatorFor(v)),
      ...(v.adjustmentInputs ? { adjustmentInputs: v.adjustmentInputs } : {}),
    },
  );
}

/** The trace step minus `factor_or_delta` — the conformance-stable subset. */
function comparableStep(step: PolicyResult["adjustments"][number]): Record<string, unknown> {
  const { factor_or_delta: _drop, ...rest } = step;
  return rest;
}

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

describe("Policy conformance · JSON · discovery", () => {
  it("loads at least one policy vector", () => {
    expect(VECTORS.length).toBeGreaterThan(0);
  });

  it("every vector has the required schema fields", () => {
    for (const v of VECTORS) {
      expect(v.name, "missing name").toBeTruthy();
      expect(v.description, `${v.name}: missing description`).toBeTruthy();
      expect(v.policy, `${v.name}: missing policy`).toBeTruthy();
      expect(v.plans, `${v.name}: missing plans`).toBeTruthy();
      expect(v.expected, `${v.name}: missing expected`).toBeTruthy();
    }
  });

  it("vector names are unique", () => {
    const names = VECTORS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("Policy conformance · JSON · correctness", () => {
  for (const v of VECTORS) {
    it(`${v.name} · ${v.description}`, () => {
      const r = compose(v);
      expect(r.subtotal).toBe(v.expected.subtotal);
      expect(r.package_credit).toBe(v.expected.package_credit);
      expect(r.after_credit).toBe(v.expected.after_credit);
      expect(r.minimum_premium).toBe(v.expected.minimum_premium);
      expect(r.minimum_applied).toBe(v.expected.minimum_applied);
      expect(r.total).toBe(v.expected.total);
      expect(
        r.lines.map((l) => ({
          product: l.product,
          plan_id: l.plan_id,
          premium: l.premium,
        })),
      ).toEqual(v.expected.lines);
      if (v.expected.adjustments) {
        expect(r.adjustments.map(comparableStep)).toEqual(
          v.expected.adjustments,
        );
      }
    });
  }
});

describe("Policy conformance · JSON · reproducibility", () => {
  for (const v of VECTORS) {
    it(`${v.name} · two compositions are identical`, () => {
      const a = compose(v);
      const b = compose(v);
      expect(a.total).toBe(b.total);
      expect(a.lines.map((l) => l.premium)).toEqual(
        b.lines.map((l) => l.premium),
      );
    });
  }
});
