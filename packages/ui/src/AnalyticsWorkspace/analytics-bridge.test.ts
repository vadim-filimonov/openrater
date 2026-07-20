/**
 * Tests for the scored-result persistence bridge — Brief 43 PR 43.6.a.
 *
 * Covers:
 *   · `toScoredBatchResult` — coalesces (rows, results) into the
 *     persisted shape; row count mismatches degrade gracefully
 *   · `persistScoredResult` + `loadScoredResult` — round-trip
 *     through localStorage with light shape validation
 *   · `clearScoredResult` — wipes the per-plan entry
 *   · `resolvePremiumColumn` — picks the plan-TOTAL premium output
 *     (aggregate name match → last money-typed → first output)
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  globalRegistry,
  registerBuiltinKinds,
  type Plan,
} from "@openrater/contracts";
import {
  analyticsScoredCsvFilename,
  buildAnalyticsScoredCsv,
  clearScoredResult,
  loadScoredResult,
  persistScoredResult,
  rerateSnapshotRows,
  runRowsToScoredBatchResult,
  resolveLossColumn,
  resolvePremiumColumn,
  snapshotBodyToProjection,
  snapshotBodyToRuntimePlan,
  toScoredBatchResult,
  computeScoringFingerprint,
} from "./analytics-bridge";
import type { ScoredBatchResult } from "./exhibit-math";

/**
 * Install a fresh, fully-functional localStorage on window for this
 * test file. jsdom ships one, but other tests in this workspace
 * install partial stubs that omit `setItem` / `removeItem` / `clear`
 * — we get a clean Map-backed implementation here so the bridge's
 * round-trip behavior can be tested in isolation.
 */
// Register the builtin block kinds once for this test file so the
// rerateSnapshotRows path can compile a tiny pass-through plan
// against the real engine. Idempotent: registerBuiltinKinds throws
// on duplicate registration, so we check the registry first via
// `get()`.
beforeAll(() => {
  if (!globalRegistry.get("input")) {
    registerBuiltinKinds();
  }
});

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
});

beforeEach(() => {
  window.localStorage.clear();
});

// ──────────────────────────────────────────────────────────────────
// toScoredBatchResult
// ──────────────────────────────────────────────────────────────────

describe("toScoredBatchResult", () => {
  it("zips rows + results into the AnalyticsScoredRow shape", () => {
    const result = toScoredBatchResult({
      rows: [
        { state: "CA", ntee_major: "arts" },
        { state: "TX", ntee_major: "religion" },
      ],
      results: [
        { outputs: { final_premium: 1500 } },
        { outputs: { final_premium: 2200 } },
      ],
      premiumColumn: "final_premium",
      scoredAt: "2026-05-26T10:00:00.000Z",
    });
    expect(result.rowCount).toBe(2);
    expect(result.scoredAt).toBe("2026-05-26T10:00:00.000Z");
    expect(result.premiumColumn).toBe("final_premium");
    expect(result.rows).toEqual([
      {
        inputs: { state: "CA", ntee_major: "arts" },
        outputs: { final_premium: 1500 },
      },
      {
        inputs: { state: "TX", ntee_major: "religion" },
        outputs: { final_premium: 2200 },
      },
    ]);
  });

  it("Brief 55 — surfaces eligibility_tier as an output column when present", () => {
    const result = toScoredBatchResult({
      rows: [{ class_code: "53989" }, { class_code: "62114" }],
      results: [
        { outputs: { final_premium: 3383 }, eligibility_tier: "submit" },
        { outputs: { final_premium: 1326 }, eligibility_tier: "standard" },
      ],
      premiumColumn: "final_premium",
    });
    expect(result.rows[0]?.outputs).toEqual({
      final_premium: 3383,
      eligibility_tier: "submit",
    });
    expect(result.rows[1]?.outputs).toEqual({
      final_premium: 1326,
      eligibility_tier: "standard",
    });
  });

  it("Brief 55 — omits eligibility_tier for a gate-less run (null/absent)", () => {
    const result = toScoredBatchResult({
      rows: [{ x: 1 }, { x: 2 }],
      results: [
        { outputs: { p: 100 }, eligibility_tier: null },
        { outputs: { p: 200 } }, // absent
      ],
      premiumColumn: "p",
    });
    expect("eligibility_tier" in (result.rows[0]?.outputs ?? {})).toBe(false);
    expect("eligibility_tier" in (result.rows[1]?.outputs ?? {})).toBe(false);
  });

  it("includes lossColumn when supplied", () => {
    const result = toScoredBatchResult({
      rows: [{ x: 1 }],
      results: [{ outputs: { p: 100, l: 30 } }],
      premiumColumn: "p",
      lossColumn: "l",
    });
    expect(result.lossColumn).toBe("l");
  });

  it("omits lossColumn when not supplied (exactOptional)", () => {
    const result = toScoredBatchResult({
      rows: [{ x: 1 }],
      results: [{ outputs: { p: 100 } }],
      premiumColumn: "p",
    });
    expect("lossColumn" in result).toBe(false);
  });

  it("degrades to empty outputs when a result is missing", () => {
    const result = toScoredBatchResult({
      rows: [{ a: 1 }, { a: 2 }, { a: 3 }],
      results: [{ outputs: { p: 100 } }], // shorter than rows
      premiumColumn: "p",
    });
    expect(result.rows[0]?.outputs).toEqual({ p: 100 });
    expect(result.rows[1]?.outputs).toEqual({});
    expect(result.rows[2]?.outputs).toEqual({});
  });

  it("defaults scoredAt to the current time when omitted", () => {
    const before = Date.now();
    const result = toScoredBatchResult({
      rows: [],
      results: [],
      premiumColumn: "p",
    });
    const parsedAt = Date.parse(result.scoredAt);
    expect(parsedAt).toBeGreaterThanOrEqual(before);
    expect(parsedAt).toBeLessThanOrEqual(Date.now() + 50);
  });
});

// ──────────────────────────────────────────────────────────────────
// persist + load round-trip
// ──────────────────────────────────────────────────────────────────

const SAMPLE_RESULT: ScoredBatchResult = {
  scoredAt: "2026-05-26T10:00:00.000Z",
  rowCount: 1,
  rows: [{ inputs: { x: 1 }, outputs: { p: 100 } }],
  premiumColumn: "p",
};

describe("persistScoredResult + loadScoredResult", () => {
  it("round-trips a result through localStorage", () => {
    persistScoredResult("plan_x", SAMPLE_RESULT);
    const loaded = loadScoredResult("plan_x");
    expect(loaded).toEqual(SAMPLE_RESULT);
  });

  it("scopes by plan id (different planIds don't see each other)", () => {
    persistScoredResult("plan_a", SAMPLE_RESULT);
    expect(loadScoredResult("plan_b")).toBe(null);
    expect(loadScoredResult("plan_a")?.rowCount).toBe(1);
  });

  it("returns null for an unknown plan", () => {
    expect(loadScoredResult("never_persisted")).toBe(null);
  });

  it("returns null when the stored payload is malformed JSON", () => {
    window.localStorage.setItem(
      "raterlabs:analytics:scored-result:plan_x",
      "not json {{",
    );
    expect(loadScoredResult("plan_x")).toBe(null);
  });

  it("returns null when the stored payload fails shape validation", () => {
    // Wrong shape — missing required keys.
    window.localStorage.setItem(
      "raterlabs:analytics:scored-result:plan_x",
      JSON.stringify({ scoredAt: "x", rowCount: 1 }),
    );
    expect(loadScoredResult("plan_x")).toBe(null);
  });

  it("returns null when the stored payload has wrong types", () => {
    window.localStorage.setItem(
      "raterlabs:analytics:scored-result:plan_x",
      JSON.stringify({
        scoredAt: 12345, // should be string
        rowCount: 1,
        premiumColumn: "p",
        rows: [],
      }),
    );
    expect(loadScoredResult("plan_x")).toBe(null);
  });
});

describe("clearScoredResult", () => {
  it("removes the per-plan entry", () => {
    persistScoredResult("plan_x", SAMPLE_RESULT);
    expect(loadScoredResult("plan_x")).not.toBe(null);
    clearScoredResult("plan_x");
    expect(loadScoredResult("plan_x")).toBe(null);
  });

  it("only clears the specified plan", () => {
    persistScoredResult("plan_a", SAMPLE_RESULT);
    persistScoredResult("plan_b", SAMPLE_RESULT);
    clearScoredResult("plan_a");
    expect(loadScoredResult("plan_a")).toBe(null);
    expect(loadScoredResult("plan_b")).not.toBe(null);
  });
});

// ──────────────────────────────────────────────────────────────────
// resolvePremiumColumn
// ──────────────────────────────────────────────────────────────────

describe("resolvePremiumColumn", () => {
  it("prefers the aggregate total_premium over per-tower outputs (V4 G1)", () => {
    // Multi-tower plan with a round plan-tail: the aggregate is emitted
    // LAST by stagesToRuntimePlan — it must win over building_premium.
    const plan = {
      nodes: [
        { kind: "input", params: {} },
        { kind: "chain.mult", params: {} },
        { kind: "output", params: { fieldName: "building_premium", fieldType: "money" } },
        { kind: "output", params: { fieldName: "bpp_premium", fieldType: "money" } },
        { kind: "output", params: { fieldName: "total_premium", fieldType: "money" } },
      ],
    };
    expect(resolvePremiumColumn(plan)).toBe("total_premium");
  });

  it("prefers final_premium by name (single-LOB convention)", () => {
    const plan = {
      nodes: [
        { kind: "output", params: { fieldName: "do_premium", fieldType: "money" } },
        { kind: "output", params: { fieldName: "final_premium", fieldType: "money" } },
      ],
    };
    expect(resolvePremiumColumn(plan)).toBe("final_premium");
  });

  it("falls back to the LAST money-typed output, skipping trace outputs", () => {
    // No aggregate name — the last money output is the projector's plan
    // total; the string/number trace outputs after it must not win.
    const plan = {
      nodes: [
        { kind: "output", params: { fieldName: "building_premium", fieldType: "money" } },
        { kind: "output", params: { fieldName: "liability_premium", fieldType: "money" } },
        { kind: "output", params: { fieldName: "glm_factor_used", fieldType: "number" } },
        { kind: "output", params: { fieldName: "glm_fallback_reason", fieldType: "string" } },
      ],
    };
    expect(resolvePremiumColumn(plan)).toBe("liability_premium");
  });

  it("falls back to the first output when nothing is money-typed (echo plans)", () => {
    const plan = {
      nodes: [
        { kind: "input", params: {} },
        { kind: "chain", params: {} },
        {
          kind: "output",
          params: { fieldName: "do_premium" },
        },
        {
          kind: "output",
          params: { fieldName: "gl_premium" },
        },
      ],
    };
    expect(resolvePremiumColumn(plan)).toBe("do_premium");
  });

  it("returns null when the plan has no output nodes", () => {
    expect(resolvePremiumColumn({ nodes: [] })).toBe(null);
    expect(
      resolvePremiumColumn({
        nodes: [{ kind: "input", params: {} }],
      }),
    ).toBe(null);
  });

  it("returns null when output nodes have no fieldName param", () => {
    expect(
      resolvePremiumColumn({
        nodes: [{ kind: "output", params: {} }],
      }),
    ).toBe(null);
  });

  it("returns null when nodes is undefined", () => {
    expect(resolvePremiumColumn({})).toBe(null);
  });
});

// ──────────────────────────────────────────────────────────────────
// resolveLossColumn (G-4)
// ──────────────────────────────────────────────────────────────────

describe("resolveLossColumn (G-4)", () => {
  it("returns null when no columns are supplied", () => {
    expect(resolveLossColumn([])).toBe(null);
  });

  it("returns null when no column matches any pass", () => {
    expect(
      resolveLossColumn(["state", "class_code", "payroll", "premium"]),
    ).toBe(null);
  });

  it("pass 1 — picks the exact canonical name 'loss'", () => {
    expect(resolveLossColumn(["state", "loss", "premium"])).toBe("loss");
  });

  it("pass 1 — picks 'incurred_loss' over a generic 'loss' if listed first", () => {
    // Canonical match is set membership; first-in-the-array wins.
    expect(
      resolveLossColumn(["state", "incurred_loss", "loss"]),
    ).toBe("incurred_loss");
  });

  it("pass 1 — is case-insensitive", () => {
    expect(resolveLossColumn(["INCURRED_LOSS"])).toBe("INCURRED_LOSS");
  });

  it("pass 2 — picks 'loss' + qualifier when not in the canonical set", () => {
    // 'paid_loss_amount' doesn't match the canonical set but does
    // contain both 'loss' and the qualifier 'paid'.
    expect(
      resolveLossColumn(["state", "paid_loss_amount", "premium"]),
    ).toBe("paid_loss_amount");
  });

  it("pass 3 — falls back to any column containing 'loss'", () => {
    expect(resolveLossColumn(["state", "loss_year_2023"])).toBe(
      "loss_year_2023",
    );
  });

  it("prefers canonical (pass 1) over fuzzy (pass 3) even when fuzzy comes first", () => {
    // 'loss_year_2023' matches pass 3; 'incurred_loss' matches pass 1.
    // Canonical wins.
    expect(
      resolveLossColumn(["loss_year_2023", "incurred_loss"]),
    ).toBe("incurred_loss");
  });

  it("preserves original casing in the return value", () => {
    expect(resolveLossColumn(["IncurredLoss"])).toBe("IncurredLoss");
  });
});

// ──────────────────────────────────────────────────────────────────
// rerateSnapshotRows (PR 43.6.d)
// ──────────────────────────────────────────────────────────────────

describe("rerateSnapshotRows", () => {
  // Minimum-viable real Plan: pass-through the `a` input column as
  // the `premium` output. Tests the real executePlanBatch path
  // without needing any custom node kinds registered. The arg is now
  // a typed runtime `Plan` (callers project a snapshot body into this
  // via `snapshotBodyToRuntimePlan` first).
  const PASSTHROUGH_PLAN = {
    id: "t.rerate.pass",
    version: "0.1.0",
    name: "passthrough",
    nodes: [
      { id: "in_a", kind: "input", params: { fieldName: "a" } },
      { id: "out", kind: "output", params: { fieldName: "premium" } },
    ],
    edges: [
      {
        from: { node: "in_a", port: "value" },
        to: { node: "out", port: "value" },
      },
    ],
  } as unknown as Plan;

  it("returns a ScoredBatchResult with the live rows + snapshot outputs", () => {
    const result = rerateSnapshotRows({
      plan: PASSTHROUGH_PLAN,
      liveRows: [{ a: 100 }, { a: 250 }, { a: 50 }],
      premiumColumn: "premium",
      scoredAt: "2026-05-26T00:00:00Z",
    });
    expect(result.scoredAt).toBe("2026-05-26T00:00:00Z");
    expect(result.rowCount).toBe(3);
    expect(result.premiumColumn).toBe("premium");
    expect(result.rows.map((r) => r.outputs.premium)).toEqual([100, 250, 50]);
    expect(result.rows.map((r) => r.inputs.a)).toEqual([100, 250, 50]);
  });

  it("threads lossColumn through when provided", () => {
    const result = rerateSnapshotRows({
      plan: PASSTHROUGH_PLAN,
      liveRows: [{ a: 100 }],
      premiumColumn: "premium",
      lossColumn: "incurred_loss",
    });
    expect(result.lossColumn).toBe("incurred_loss");
  });

  it("omits lossColumn from output when not provided", () => {
    const result = rerateSnapshotRows({
      plan: PASSTHROUGH_PLAN,
      liveRows: [{ a: 100 }],
      premiumColumn: "premium",
    });
    expect("lossColumn" in result).toBe(false);
  });

  it("defaults scoredAt to a fresh ISO timestamp", () => {
    const before = new Date().toISOString();
    const result = rerateSnapshotRows({
      plan: PASSTHROUGH_PLAN,
      liveRows: [{ a: 100 }],
      premiumColumn: "premium",
    });
    expect(result.scoredAt >= before).toBe(true);
    // ISO 8601 sanity check
    expect(result.scoredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("preserves row order 1-to-1 with liveRows", () => {
    const result = rerateSnapshotRows({
      plan: PASSTHROUGH_PLAN,
      liveRows: [{ a: 7 }, { a: 11 }, { a: 13 }, { a: 17 }],
      premiumColumn: "premium",
    });
    expect(result.rows.length).toBe(4);
    expect(result.rows[0]!.outputs.premium).toBe(7);
    expect(result.rows[1]!.outputs.premium).toBe(11);
    expect(result.rows[2]!.outputs.premium).toBe(13);
    expect(result.rows[3]!.outputs.premium).toBe(17);
  });

  it("throws when the plan is malformed", () => {
    expect(() =>
      rerateSnapshotRows({
        plan: { not: "a plan" } as unknown as Plan,
        liveRows: [{ a: 1 }],
        premiumColumn: "premium",
      }),
    ).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────
// snapshotBodyToRuntimePlan — substrate body → runtime Plan
// ──────────────────────────────────────────────────────────────────

describe("snapshotBodyToRuntimePlan", () => {
  // A frozen substrate snapshot body, shaped exactly like api-lab's
  // `_compose_body` output: { plan, stages, dimensions, factor_tables,
  // input_mapping }. The single D&O chain references a base rate + an
  // NTEE factor table (cells inlined on the FT, keyed by `table_id`).
  const SUBSTRATE_BODY: Record<string, unknown> = {
    plan: {
      rating_plan_id: "p1",
      display_name: "Nonprofit 990",
      line_of_business: "cgl",
    },
    stages: [
      {
        stage_id: "do_chain",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "do_premium",
              base_input: "form_input.do_base_rate",
              factor_lookups: [
                {
                  name: "ntee_factor_do",
                  factor_kind: "ntee_factor_do",
                  dimensions: {
                    ntee_major: {
                      source: "form_input",
                      path: "form_input.ntee_major",
                    },
                  },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              output_field: "do_premium",
            },
          ],
          output_total_field: "premium",
        },
        inputs: [],
        outputs: [],
      },
    ],
    dimensions: [
      {
        id: "ntee_major",
        slug: "ntee_major",
        display_name: "NTEE major",
        data_type: "string",
        role: "rating-input",
      },
    ],
    factor_tables: [
      {
        rating_plan_id: "p1",
        table_id: "ft1",
        display_name: "NTEE D&O",
        slug: "ntee_factor_do",
        key_dimensions: ["ntee_major"],
        cells: { religion: 1.2, philanthropy: 0.85 },
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ],
    input_mapping: null,
  };

  // Same projection options the live Inputs path feeds for
  // nonprofit_990 (LCM + base-rate default not carried in substrate).
  const PROJ_OPTS = {
    lcmOverride: 1.35,
    defaults: { do_base_rate: 600 },
  };

  it("projects a substrate body into a runnable Plan (has chain.mult + output)", () => {
    const plan = snapshotBodyToRuntimePlan(SUBSTRATE_BODY, PROJ_OPTS);
    expect(plan).not.toBeNull();
    const kinds = plan!.nodes.map((n) => n.kind);
    expect(kinds).toContain("input");
    expect(kinds).toContain("lookup.direct");
    expect(kinds).toContain("chain.mult");
    expect(kinds).toContain("output");
  });

  it("re-rates live rows against the projected baseline (real premiums)", () => {
    const plan = snapshotBodyToRuntimePlan(SUBSTRATE_BODY, PROJ_OPTS)!;
    const result = rerateSnapshotRows({
      plan,
      liveRows: [{ ntee_major: "religion" }, { ntee_major: "philanthropy" }],
      premiumColumn: "do_premium",
    });
    // 600 × 1.20 × 1.35 = 972 ; 600 × 0.85 × 1.35 = 688.5
    expect(result.rows[0]!.outputs.do_premium).toBeCloseTo(972, 6);
    expect(result.rows[1]!.outputs.do_premium).toBeCloseTo(688.5, 6);
  });

  it("returns null when the body has no stages", () => {
    expect(snapshotBodyToRuntimePlan({ stages: [] })).toBeNull();
    expect(snapshotBodyToRuntimePlan({})).toBeNull();
  });

  it("returns null when stages carry no rating chain", () => {
    const noChain: Record<string, unknown> = {
      ...SUBSTRATE_BODY,
      stages: [
        { stage_id: "f", stage_kind: "flat_factor", config_json: {} },
      ],
    };
    expect(snapshotBodyToRuntimePlan(noChain, PROJ_OPTS)).toBeNull();
  });

  it("still projects with missing factor_tables — but the rows REFUSE instead of pricing 1.0 (ADR-0056)", () => {
    const sparse: Record<string, unknown> = {
      stages: SUBSTRATE_BODY.stages,
    };
    // Projection succeeds (a runnable chain exists) and names the
    // authoring cause…
    const projection = snapshotBodyToProjection(sparse, PROJ_OPTS);
    expect(projection).not.toBeNull();
    expect(
      projection!.issues.some((i) => i.code === "factor_table_missing"),
    ).toBe(true);
    // …and at score time the row refuses — pre-ADR-0056 this silently
    // priced 600 × 1.0 × 1.35 = 810 with no cells at all.
    const result = rerateSnapshotRows({
      plan: projection!.plan,
      liveRows: [{ ntee_major: "religion" }],
      premiumColumn: "do_premium",
    });
    expect(result.rows[0]!.outputs).not.toHaveProperty("do_premium");
  });
});

// ──────────────────────────────────────────────────────────────────
// buildAnalyticsScoredCsv + analyticsScoredCsvFilename (PR 43.7)
// ──────────────────────────────────────────────────────────────────

describe("buildAnalyticsScoredCsv", () => {
  it("emits header + one row per scored row, inputs first then outputs", () => {
    const csv = buildAnalyticsScoredCsv({
      scoredAt: "2026-05-26T00:00:00Z",
      rowCount: 2,
      premiumColumn: "premium",
      rows: [
        {
          inputs: { state: "CA", tiv: 100 },
          outputs: { premium: 1250.5, loss: 300 },
        },
        {
          inputs: { state: "TX", tiv: 200 },
          outputs: { premium: 2100, loss: 400 },
        },
      ],
    });
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toBe("state,tiv,premium,loss");
    expect(lines[1]).toBe("CA,100,1250.5,300");
    expect(lines[2]).toBe("TX,200,2100,400");
  });

  it("RFC-4180 escapes commas, quotes, newlines", () => {
    const csv = buildAnalyticsScoredCsv({
      scoredAt: "2026-05-26T00:00:00Z",
      rowCount: 1,
      premiumColumn: "premium",
      rows: [
        {
          inputs: { name: 'Acme, "the" co.' },
          outputs: { premium: 100 },
        },
      ],
    });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("name,premium");
    expect(lines[1]).toBe(`"Acme, ""the"" co.",100`);
  });

  it("renders empty cells for missing keys (sparse rows)", () => {
    const csv = buildAnalyticsScoredCsv({
      scoredAt: "2026-05-26T00:00:00Z",
      rowCount: 2,
      premiumColumn: "premium",
      rows: [
        { inputs: { a: 1 }, outputs: { premium: 10 } },
        { inputs: { b: 2 }, outputs: { loss: 5 } },
      ],
    });
    const lines = csv.split("\n");
    // Union: a, b in inputs; premium, loss in outputs (encounter order)
    expect(lines[0]).toBe("a,b,premium,loss");
    expect(lines[1]).toBe("1,,10,");
    expect(lines[2]).toBe(",2,,5");
  });

  it("returns header-only when rows is empty", () => {
    const csv = buildAnalyticsScoredCsv({
      scoredAt: "2026-05-26T00:00:00Z",
      rowCount: 0,
      premiumColumn: "premium",
      rows: [],
    });
    expect(csv).toBe("");
  });
});

describe("buildAnalyticsScoredCsv — G-6 side-by-side mode", () => {
  const DRAFT: ScoredBatchResult = {
    scoredAt: "2026-05-27T00:00:00Z",
    rowCount: 2,
    premiumColumn: "premium",
    rows: [
      { inputs: { state: "CA", tiv: 100 }, outputs: { premium: 1100 } },
      { inputs: { state: "TX", tiv: 200 }, outputs: { premium: 2310 } },
    ],
  };
  const BASELINE: ScoredBatchResult = {
    scoredAt: "2026-05-20T00:00:00Z",
    rowCount: 2,
    premiumColumn: "premium",
    rows: [
      { inputs: { state: "CA", tiv: 100 }, outputs: { premium: 1000 } },
      { inputs: { state: "TX", tiv: 200 }, outputs: { premium: 2100 } },
    ],
  };

  it("emits inputs | baseline | draft | delta when baselineResult is supplied", () => {
    const csv = buildAnalyticsScoredCsv(DRAFT, { baselineResult: BASELINE });
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toBe(
      "state,tiv,baseline_premium,draft_premium,delta_pct_premium",
    );
    // (1100 - 1000) / 1000 = 0.10
    expect(lines[1]).toBe("CA,100,1000,1100,0.1");
    // (2310 - 2100) / 2100 ≈ 0.1
    expect(lines[2]).toBe("TX,200,2100,2310,0.1");
  });

  it("emits empty delta when baseline value is missing or zero", () => {
    const draft: ScoredBatchResult = {
      scoredAt: "2026-05-27T00:00:00Z",
      rowCount: 2,
      premiumColumn: "premium",
      rows: [
        { inputs: { state: "CA" }, outputs: { premium: 1100 } },
        { inputs: { state: "TX" }, outputs: { premium: 2310 } },
      ],
    };
    const baseline: ScoredBatchResult = {
      scoredAt: "2026-05-20T00:00:00Z",
      rowCount: 2,
      premiumColumn: "premium",
      rows: [
        { inputs: { state: "CA" }, outputs: { premium: 0 } }, // zero baseline → empty delta
        { inputs: { state: "TX" }, outputs: {} }, // missing baseline → empty delta
      ],
    };
    const csv = buildAnalyticsScoredCsv(draft, { baselineResult: baseline });
    const lines = csv.split("\n");
    expect(lines[1]?.endsWith(",")).toBe(true); // empty delta cell
    expect(lines[2]?.endsWith(",")).toBe(true);
  });

  it("includes baseline-only output columns in the union", () => {
    const draft: ScoredBatchResult = {
      scoredAt: "2026-05-27T00:00:00Z",
      rowCount: 1,
      premiumColumn: "premium",
      rows: [{ inputs: { id: 1 }, outputs: { premium: 100 } }],
    };
    const baseline: ScoredBatchResult = {
      scoredAt: "2026-05-20T00:00:00Z",
      rowCount: 1,
      premiumColumn: "premium",
      rows: [{ inputs: { id: 1 }, outputs: { premium: 90, retired_col: "x" } }],
    };
    const csv = buildAnalyticsScoredCsv(draft, { baselineResult: baseline });
    const lines = csv.split("\n");
    // Header should include retired_col on all three sides
    expect(lines[0]).toContain("baseline_retired_col");
    expect(lines[0]).toContain("draft_retired_col");
    expect(lines[0]).toContain("delta_pct_retired_col");
  });

  it("falls back to single-side when baseline rowCount mismatches", () => {
    const baselineShort: ScoredBatchResult = {
      ...BASELINE,
      rowCount: 1,
      rows: BASELINE.rows.slice(0, 1),
    };
    const csv = buildAnalyticsScoredCsv(DRAFT, {
      baselineResult: baselineShort,
    });
    // Single-side header (no baseline_/draft_ prefixes)
    expect(csv.split("\n")[0]).toBe("state,tiv,premium");
  });

  it("honors custom side prefixes", () => {
    const csv = buildAnalyticsScoredCsv(DRAFT, {
      baselineResult: BASELINE,
      sidePrefixes: { baseline: "filed_", draft: "proposed_", delta: "Δ_" },
    });
    const header = csv.split("\n")[0];
    expect(header).toContain("filed_premium");
    expect(header).toContain("proposed_premium");
    expect(header).toContain("Δ_premium");
  });

  it("rounds delta to 4 decimal places", () => {
    const draft: ScoredBatchResult = {
      scoredAt: "x",
      rowCount: 1,
      premiumColumn: "premium",
      rows: [{ inputs: {}, outputs: { premium: 1.234567 } }],
    };
    const baseline: ScoredBatchResult = {
      scoredAt: "y",
      rowCount: 1,
      premiumColumn: "premium",
      rows: [{ inputs: {}, outputs: { premium: 1.0 } }],
    };
    const csv = buildAnalyticsScoredCsv(draft, { baselineResult: baseline });
    // delta = 0.234567 → rounded to 0.2346
    expect(csv.split("\n")[1]).toContain("0.2346");
  });
});

describe("analyticsScoredCsvFilename", () => {
  it("formats {slug}_scored_{ISO}.csv per Q6 lock", () => {
    expect(
      analyticsScoredCsvFilename(
        "nonprofit_990_d_and_o",
        "2026-05-26T14:32:00Z",
      ),
    ).toBe("nonprofit_990_d_and_o_scored_2026-05-26T14-32-00Z.csv");
  });

  it("falls back to 'plan' when slug is empty", () => {
    expect(analyticsScoredCsvFilename("", "2026-05-26T00:00:00Z")).toBe(
      "plan_scored_2026-05-26T00-00-00Z.csv",
    );
    expect(
      analyticsScoredCsvFilename(null, "2026-05-26T00:00:00Z"),
    ).toBe("plan_scored_2026-05-26T00-00-00Z.csv");
    expect(
      analyticsScoredCsvFilename(undefined, "2026-05-26T00:00:00Z"),
    ).toBe("plan_scored_2026-05-26T00-00-00Z.csv");
  });

  it("strips sub-second precision so filenames stay short", () => {
    expect(
      analyticsScoredCsvFilename("p", "2026-05-26T00:00:00.123Z"),
    ).toBe("p_scored_2026-05-26T00-00-00Z.csv");
  });
});

// ──────────────────────────────────────────────────────────────────
// computeScoringFingerprint (Brief 43 §6.1 / ADR-0041 Phase 2)
// ──────────────────────────────────────────────────────────────────

describe("computeScoringFingerprint", () => {
  const stages = [
    { stage_id: "base", stage_kind: "input_node", config_json: { source_path: "x" } },
    { stage_id: "tower", stage_kind: "multiplicative_chain", config_json: { lcm: 1.4 } },
  ];
  const dims = [{ slug: "territory", levels: [{ id: "t1" }, { id: "t2" }] }];
  const cells = new Map([["ft1", new Map([["t1", 0.4], ["t2", 0.41]])]]);

  it("is deterministic for the same inputs", () => {
    expect(computeScoringFingerprint(stages, dims, cells)).toBe(
      computeScoringFingerprint(stages, dims, cells),
    );
  });

  it("is order-independent (stages / dims / cells reordered)", () => {
    const a = computeScoringFingerprint(stages, dims, cells);
    const b = computeScoringFingerprint(
      [stages[1]!, stages[0]!],
      dims,
      new Map([["ft1", new Map([["t2", 0.41], ["t1", 0.4]])]]),
    );
    expect(a).toBe(b);
  });

  it("changes when a stage config changes", () => {
    const a = computeScoringFingerprint(stages, dims, cells);
    const edited = [stages[0]!, { ...stages[1]!, config_json: { lcm: 1.5 } }];
    expect(computeScoringFingerprint(edited, dims, cells)).not.toBe(a);
  });

  it("changes when a factor cell value changes", () => {
    const a = computeScoringFingerprint(stages, dims, cells);
    const edited = new Map([["ft1", new Map([["t1", 0.5], ["t2", 0.41]])]]);
    expect(computeScoringFingerprint(stages, dims, edited)).not.toBe(a);
  });

  it("changes when a dimension level is added", () => {
    const a = computeScoringFingerprint(stages, dims, cells);
    const edited = [{ slug: "territory", levels: [{ id: "t1" }, { id: "t2" }, { id: "t3" }] }];
    expect(computeScoringFingerprint(stages, edited, cells)).not.toBe(a);
  });

  it("tolerates undefined cells", () => {
    expect(typeof computeScoringFingerprint(stages, dims, undefined)).toBe("string");
  });

  // ── G21 — the tail, grouping/roll-up, and geo transformers change
  //    premiums, so each must flip the fingerprint. ──
  describe("G21 extras", () => {
    const TAIL = [{ kind: "minimum_premium", id: "min", floor: 500 }];

    it("empty extras hash byte-identically to the 3-arg call (no upgrade invalidation)", () => {
      const bare = computeScoringFingerprint(stages, dims, cells);
      expect(
        computeScoringFingerprint(stages, dims, cells, {
          policyTail: [],
          rollupFields: [],
          geoTransformers: {},
        }),
      ).toBe(bare);
      expect(computeScoringFingerprint(stages, dims, cells, {})).toBe(bare);
    });

    it("a policy-tail edit flips the fingerprint", () => {
      const a = computeScoringFingerprint(stages, dims, cells, { policyTail: TAIL });
      expect(a).not.toBe(computeScoringFingerprint(stages, dims, cells));
      expect(
        computeScoringFingerprint(stages, dims, cells, {
          policyTail: [{ kind: "minimum_premium", id: "min", floor: 750 }],
        }),
      ).not.toBe(a);
    });

    it("grouping-config and roll-up edits flip the fingerprint", () => {
      const grouped = computeScoringFingerprint(stages, dims, cells, {
        groupingConfig: { policy_id_column: "policy_id" },
      });
      expect(grouped).not.toBe(computeScoringFingerprint(stages, dims, cells));
      const rolled = computeScoringFingerprint(stages, dims, cells, {
        groupingConfig: { policy_id_column: "policy_id" },
        rollupFields: [{ fieldName: "premium", reducer: "sum" }],
      });
      expect(rolled).not.toBe(grouped);
    });

    it("a geo-transformer change flips the fingerprint", () => {
      const a = computeScoringFingerprint(stages, dims, cells, {
        geoTransformers: { zip: "zip5_to_state" },
      });
      expect(a).not.toBe(computeScoringFingerprint(stages, dims, cells));
      expect(
        computeScoringFingerprint(stages, dims, cells, {
          geoTransformers: { zip: "identity" },
        }),
      ).not.toBe(a);
    });

    it("extras are key-order independent (stable stringify)", () => {
      const a = computeScoringFingerprint(stages, dims, cells, {
        groupingConfig: { policy_id_column: "p", location_id_column: "l" },
      });
      const b = computeScoringFingerprint(stages, dims, cells, {
        groupingConfig: { location_id_column: "l", policy_id_column: "p" },
      });
      expect(a).toBe(b);
    });
  });
});

describe("runRowsToScoredBatchResult (Brief 75 phase 4)", () => {
  it("folds the verdict + error facet into outputs exactly like the browser feed", () => {
    const out = runRowsToScoredBatchResult({
      rows: [
        {
          inputs: { class_code: "0912", state: "KS" },
          outputs: { total_premium: 140 },
          views: { premium: 140, tier: "standard" },
          row_status: "ok",
        },
        {
          inputs: { class_code: "9999" },
          outputs: {},
          row_status: "error",
          eligibility_tier: "decline",
        },
      ],
      premiumColumn: "total_premium",
      scoredAt: "2026-07-06T00:00:00Z",
    });
    expect(out.rowCount).toBe(2);
    expect(out.premiumColumn).toBe("total_premium");
    // Row 1: verdict from views.tier rides outputs (sliceable);
    expect(out.rows[0]?.outputs).toEqual({
      total_premium: 140,
      eligibility_tier: "standard",
    });
    expect(out.rows[0]?.inputs).toEqual({ class_code: "0912", state: "KS" });
    // Row 2: explicit eligibility_tier wins; the error facet is named.
    expect(out.rows[1]?.outputs).toEqual({
      eligibility_tier: "decline",
      row_status: "error",
    });
    // No fingerprint — run staleness is content-hash-judged by the mount.
    expect(out.planFingerprint).toBeUndefined();
  });

  it("materializes the synthesized coverage-sum column from views.premium (total-less plans)", () => {
    // A total-less run's summary advertises `coverage_sum_premium` —
    // no engine output carries it; each clean row's service-derived
    // views.premium becomes the column (never re-summed client-side).
    const out = runRowsToScoredBatchResult({
      rows: [
        {
          inputs: { state: "KS" },
          outputs: { building_premium: 13, contents_premium: 1650 },
          views: { premium: 1663, premiumBasis: "coverage_sum" },
          row_status: "ok",
        },
        {
          // Law 2 / G8 — an error row's views withhold the premium; the
          // synthesized column must stay absent (no partial sums).
          inputs: { state: "MO" },
          outputs: { building_premium: 13 },
          views: { premium: null },
          row_status: "error",
        },
      ],
      premiumColumn: "coverage_sum_premium",
      scoredAt: "2026-07-15T00:00:00Z",
    });
    expect(out.rows[0]?.outputs).toEqual({
      building_premium: 13,
      contents_premium: 1650,
      coverage_sum_premium: 1663,
    });
    expect(out.rows[1]?.outputs).toEqual({
      building_premium: 13,
      row_status: "error",
    });
  });

  it("never overwrites a REAL output column with views.premium", () => {
    const out = runRowsToScoredBatchResult({
      rows: [
        {
          inputs: {},
          outputs: { total_premium: 500 },
          // e.g. a composed view diverging from the raw output — the
          // engine's own column stays authoritative for the column feed.
          views: { premium: 525 },
          row_status: "ok",
        },
      ],
      premiumColumn: "total_premium",
      scoredAt: "2026-07-15T00:00:00Z",
    });
    expect(out.rows[0]?.outputs["total_premium"]).toBe(500);
  });
});
