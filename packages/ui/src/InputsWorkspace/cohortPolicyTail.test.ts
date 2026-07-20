/**
 * applyCohortPolicyTail tests (Brief 62.3 R1 — the cohort batch-wiring path).
 *
 * Proves the path that closes walkthrough I8 for the cohort: a plan's
 * authored tail applies to each row's aggregated premium → the per-row
 * FILED premium + trace, with the IRPM `column` source resolved from each
 * row's own inputs. Proven with hand-set tails (the 62.4 editor authors
 * them later). When no tail is authored, it is a no-op.
 */

import { describe, it, expect } from "vitest";
import type { ConnectorEvaluator, Plan, PolicyAdjustment } from "@openrater/contracts";
import { applyCohortPolicyTail } from "./cohortPolicyTail";
import type { PlanPremiumContext } from "../AnalyticsWorkspace/premium-resolution";

const results = (premiums: number[], col = "final_premium") =>
  premiums.map((p) => ({ outputs: { [col]: p } }));

/** A total-less multi-coverage filing: two towers, no declared total. */
const TOTAL_LESS: PlanPremiumContext = {
  aggregateField: null,
  moneyFields: ["building_premium", "contents_premium"],
};

/** Per-row two-tower outputs — building $195 + contents $72 = $267. */
const towerResults = (
  towers: readonly (readonly [number, number])[],
  rowStatus?: "ok" | "error",
) =>
  towers.map(([b, c]) => ({
    outputs: { building_premium: b, contents_premium: c },
    ...(rowStatus ? { row_status: rowStatus } : {}),
  }));

describe("applyCohortPolicyTail · total-less multi-coverage (93.4)", () => {
  it("⭐ aggregates the dec-page SUM of the towers, not the last one", () => {
    const out = applyCohortPolicyTail({
      plan: {} as Pick<Plan, "policy_tail">,
      rows: [{}, {}],
      results: towerResults([
        [195, 72],
        [400, 100],
      ]),
      // The last-money answer `resolvePremiumColumn` would hand us. It
      // must be IGNORED: this plan declares no premium output at all.
      premiumColumn: "contents_premium",
      planPremium: TOTAL_LESS,
    });
    expect(out.map((t) => t.filed)).toEqual([267, 500]);
    expect(out.map((t) => t.aggregated)).toEqual([267, 500]);
  });

  it("⭐ a tail over a total-less plan is a NAMED refusal — never a tax on the last tower", () => {
    // Law 2, mirroring scoreOne's composition_failed. Taxing contents'
    // $72 by 10% and filing $79 as the policy's price is the exact
    // silently-wrong number this refusal kills.
    const policy_tail: PolicyAdjustment[] = [
      {
        kind: "schedule_rating",
        id: "irpm",
        display_name: "IRPM",
        cap_pct: 25,
        source: { from: "literal", total: 10 },
      },
    ];
    const out = applyCohortPolicyTail({
      plan: { policy_tail },
      rows: [{}],
      results: towerResults([[195, 72]]),
      premiumColumn: "contents_premium",
      planPremium: TOTAL_LESS,
    });
    expect(out[0]!.refusal).toMatch(/prices 2 coverages/);
    expect(out[0]!.refusal).toMatch(/declares no total output/);
    // No number is filed — not the tailed sum, and above all not $79.2.
    expect(Number.isFinite(out[0]!.filed)).toBe(false);
    expect(out[0]!.adjustments).toEqual([]);
  });

  it("a minimum premium over a total-less plan refuses too (a floor is money math)", () => {
    const out = applyCohortPolicyTail({
      plan: { policy_tail: [{ kind: "minimum_premium", id: "min", floor: 500 }] },
      rows: [{}],
      results: towerResults([[195, 72]]),
      premiumColumn: "contents_premium",
      planPremium: TOTAL_LESS,
    });
    expect(out[0]!.refusal).toBeTruthy();
    expect(Number.isFinite(out[0]!.filed)).toBe(false);
  });

  it("Law 2 / G8 — an error row never sums the towers that DID resolve", () => {
    const out = applyCohortPolicyTail({
      plan: {} as Pick<Plan, "policy_tail">,
      rows: [{}],
      // The refused run still carries building's $195 for diagnosis.
      results: [
        {
          outputs: { building_premium: 195 },
          row_status: "error" as const,
        },
      ],
      premiumColumn: "contents_premium",
      planPremium: TOTAL_LESS,
    });
    expect(Number.isFinite(out[0]!.aggregated)).toBe(false);
    expect(Number.isFinite(out[0]!.filed)).toBe(false);
  });

  it("a DECLARED total still tails normally — the refusal is scoped to total-less plans", () => {
    const declared: PlanPremiumContext = {
      aggregateField: "package_premium",
      moneyFields: ["building_premium", "contents_premium", "package_premium"],
    };
    const out = applyCohortPolicyTail({
      plan: {
        policy_tail: [{ kind: "minimum_premium", id: "min", floor: 500 }],
      },
      rows: [{}],
      results: [{ outputs: { package_premium: 267 } }],
      premiumColumn: "package_premium",
      planPremium: declared,
    });
    expect(out[0]!.refusal).toBeUndefined();
    expect(out[0]!.filed).toBe(500); // floored, as authored
  });
});

describe("applyCohortPolicyTail", () => {
  it("is a no-op when the plan authors no tail (filed === aggregated)", () => {
    const out = applyCohortPolicyTail({
      plan: {} as Pick<Plan, "policy_tail">,
      rows: [{}, {}],
      results: results([1000, 2000]),
      premiumColumn: "final_premium",
    });
    expect(out).toEqual([
      { aggregated: 1000, filed: 1000, adjustments: [] },
      { aggregated: 2000, filed: 2000, adjustments: [] },
    ]);
  });

  it("resolves a column-sourced IRPM per row → DISTINCT filed premiums (closes I8)", () => {
    const policy_tail: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "irpm", display_name: "IRPM", cap_pct: 25, source: { from: "column", column: "irpm_total_pct" } },
    ];
    const out = applyCohortPolicyTail({
      plan: { policy_tail },
      rows: [{ irpm_total_pct: -7 }, { irpm_total_pct: 10 }],
      results: results([3000, 3000]),
      premiumColumn: "final_premium",
    });
    expect(out[0]!.filed).toBe(2790); // ×0.93
    expect(out[1]!.filed).toBeCloseTo(3300, 6); // ×1.10
    expect(out[0]!.filed).not.toBe(out[1]!.filed); // the I8 fix — was a flat 1.0 before
    expect(out[0]!.adjustments[0]!.provenance).toEqual({ source: "column" });
  });

  it("applies a guarded package_factor per row based on that row's inputs", () => {
    const policy_tail: PolicyAdjustment[] = [
      { kind: "package_factor", id: "first_term_credit", display_name: "First-term credit", factor: 0.9, when: { field: "is_first_term", op: "eq", value: true } },
    ];
    const out = applyCohortPolicyTail({
      plan: { policy_tail },
      rows: [{ is_first_term: true }, { is_first_term: false }],
      results: results([1000, 1000]),
      premiumColumn: "final_premium",
    });
    expect(out[0]!.filed).toBe(900); // first-term credit applies
    expect(out[0]!.adjustments[0]!.applied).toBe(true);
    expect(out[1]!.filed).toBe(1000); // guard miss — visible no-op
    expect(out[1]!.adjustments[0]!.applied).toBe(false);
  });

  it("threads the full ordered tail (IRPM → package → endorsement → floor)", () => {
    const policy_tail: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "irpm", display_name: "IRPM", cap_pct: 25, source: { from: "literal", total: -10 } },
      { kind: "package_factor", id: "first_term_credit", display_name: "First-term credit", factor: 0.9, when: { field: "is_first_term", op: "eq", value: true } },
      { kind: "endorsement", id: "terror", display_name: "Terrorism", effect: { kind: "flat", amount: 18 } },
      { kind: "minimum_premium", id: "min", floor: 500 },
    ];
    const out = applyCohortPolicyTail({
      plan: { policy_tail },
      rows: [{ is_first_term: true }],
      results: results([1000]),
      premiumColumn: "final_premium",
    });
    expect(out[0]!.filed).toBe(828); // 1000 ×0.9 ×0.9 +18, floor clears
    expect(out[0]!.adjustments.map((s) => s.kind)).toEqual([
      "schedule_rating",
      "package_factor",
      "endorsement",
      "minimum_premium",
    ]);
  });

  it("floors a low-premium row at the minimum (binds per row)", () => {
    const policy_tail: PolicyAdjustment[] = [{ kind: "minimum_premium", id: "min", floor: 500 }];
    const out = applyCohortPolicyTail({
      plan: { policy_tail },
      rows: [{}, {}],
      results: results([430, 900]),
      premiumColumn: "final_premium",
    });
    expect(out[0]!.filed).toBe(500); // floored
    expect(out[0]!.adjustments[0]!.applied).toBe(true);
    expect(out[1]!.filed).toBe(900); // clears the floor
    expect(out[1]!.adjustments[0]!.applied).toBe(false);
  });

  it("resolves a connector-sourced IRPM per row via the injected evaluator (62.6 PR3)", () => {
    const policy_tail: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "irpm", display_name: "IRPM", cap_pct: 25, source: { from: "connector", connector_id: "lossnav", version: "v2" } },
    ];
    // The book is pre-fetched: each row's net is looked up by its features
    // (here, by the `risk` field) — the per-row batch the hook builds.
    const netByRisk: Record<string, number> = { hi: 12, lo: -8 };
    const connectorEvaluator: ConnectorEvaluator = (_ref, features) => {
      const risk = String((features as { risk?: unknown }).risk ?? "");
      return { net: netByRisk[risk] ?? 0, version: "v2", snapshot_id: `snap_${risk}`, cost_usd: 0.012 };
    };
    const out = applyCohortPolicyTail({
      plan: { policy_tail },
      rows: [{ risk: "hi" }, { risk: "lo" }],
      results: results([1000, 1000]),
      premiumColumn: "final_premium",
      connectorEvaluator,
    });
    expect(out[0]!.filed).toBeCloseTo(1120, 6); // ×1.12 (hi)
    expect(out[1]!.filed).toBe(920); // ×0.92 (lo)
    expect(out[0]!.filed).not.toBe(out[1]!.filed); // per-row live net
    // provenance carries the connector id + version + the replay snapshot
    expect(out[0]!.adjustments[0]!.provenance).toMatchObject({
      source: "connector",
      connector: "lossnav",
      version: "v2",
      snapshot_id: "snap_hi",
    });
  });

  it("degrades a connector step to a traced fallback (net 0) when the book hasn't run (§3)", () => {
    const policy_tail: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "irpm", display_name: "IRPM", cap_pct: 25, source: { from: "connector", connector_id: "lossnav", version: "v2" } },
    ];
    // The "not run yet" / failed evaluator: net 0 + a reason, never a throw.
    const connectorEvaluator: ConnectorEvaluator = () => ({
      net: 0,
      version: "v2",
      fallback_reason: "book not run yet",
    });
    const out = applyCohortPolicyTail({
      plan: { policy_tail },
      rows: [{}],
      results: results([1000]),
      premiumColumn: "final_premium",
      connectorEvaluator,
    });
    expect(out[0]!.filed).toBe(1000); // net 0 → ×1.0 no-op
    expect(out[0]!.adjustments[0]!.provenance).toMatchObject({
      source: "connector",
      fallback_reason: "book not run yet",
    });
  });

  it("passes through a row whose premium output is not a finite number (declined / knockout)", () => {
    const policy_tail: PolicyAdjustment[] = [{ kind: "minimum_premium", id: "min", floor: 500 }];
    const out = applyCohortPolicyTail({
      plan: { policy_tail },
      rows: [{}],
      results: [{ outputs: { final_premium: undefined } }],
      premiumColumn: "final_premium",
    });
    expect(Number.isNaN(out[0]!.aggregated)).toBe(true);
    expect(Number.isNaN(out[0]!.filed)).toBe(true);
    expect(out[0]!.adjustments).toEqual([]); // no tail applied to a non-premium
  });
});
