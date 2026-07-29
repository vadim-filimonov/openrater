/**
 * Plan-aware premium view — the total-less transcription scores a
 * readable premium (the Rate-sample refusal-banner chip).
 *
 * A filing with MULTIPLE coverage towers and NO total row is legal
 * per the workbook spec (the transcription never invents a total).
 * Before this fix `views.premium` resolved ONLY via the caller's
 * `premiumField` or the single-numeric-output heuristic, so a fully
 * priced multi-coverage risk surfaced as `premium: null` — the Run
 * zone rendered a refusal blaming the risk's limit/exposure inputs,
 * run history showed "—", and /quote returned no premium.
 *
 * Now `views.premium` resolves from the plan's own declarations
 * (`resolvePlanPremiumContext`):
 *   · a declared aggregate — by output-node name (total_premium /
 *     final_premium) or by the authored `round` STAGE's output_field
 *     (the ADR-0044 D8 plan-tail total-rounder) — resolves alone,
 *     never rebuilt from parts;
 *   · one money output → it (numeric debug outputs no longer defeat
 *     the view);
 *   · ≥2 money outputs, no aggregate → the dec-page sum of the
 *     coverage premiums, marked `premiumBasis: "coverage_sum"`.
 * Detection reads STAGES, never the projected graph: exposure-rated
 * towers (ADR-0044 D3) carry per-tip ISO `round` NODES, so a
 * graph-side "round-fed output = total" detector wrongly crowned the
 * LAST TOWER (live repro: $195 + $72 risk headlined "$72").
 * Error rows still derive NO money (Law 2 / G8), and a policy tail
 * over a total-less multi-coverage plan is a NAMED refusal — never a
 * tail silently applied to the last tower.
 */

import { describe, expect, it } from "vitest";

import { buildApp } from "../http/server";

/** Two coverage towers, NO total row — the legal total-less
 *  transcription (mirrors the binding-forms two-tower shape:
 *  building $13 + contents $1,650). */
const TOTALLESS_STAGES = [
  {
    stage_id: "chain_1",
    stage_kind: "multiplicative_chain",
    config_json: {
      chains: [
        {
          name: "building",
          base_input: "ignored",
          base_value: 13,
          factor_lookups: [],
          lcm: { value: 1.0 },
          output_field: "building_premium",
        },
        {
          name: "contents",
          base_input: "ignored",
          base_value: 1650,
          factor_lookups: [],
          lcm: { value: 1.0 },
          output_field: "contents_premium",
        },
      ],
      output_total_field: "all_coverages_subtotal",
    },
  },
];

/** The same two towers + a package round (no minimum) producing the
 *  plan total under `output_field`. */
function withTotalStages(totalField: string): unknown[] {
  return [
    ...TOTALLESS_STAGES,
    {
      stage_id: "final_round",
      stage_kind: "round",
      config_json: {
        input_path: "chain.total_premium",
        increment_input: "literal:1",
        min_value_input: "literal:0",
        output_field: totalField,
      },
    },
  ];
}

function planStagesPayload(
  stages: unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: "plan_stages",
    stages,
    dimensions: [],
    factorTables: [],
    factorTableCells: {},
    inputs: {},
    trace: "none",
    ...extra,
  };
}

interface ScoreBody {
  outputs: Record<string, unknown>;
  views: {
    premium: number | null;
    premiumBasis?: string;
    perCoverage: Record<string, number>;
  };
  row_status: string;
  rowIssues?: readonly { code?: string; message: string }[];
  composed?: { final: number };
}

async function score(payload: Record<string, unknown>): Promise<ScoreBody> {
  const app = buildApp();
  const res = await app.inject({ method: "POST", url: "/score", payload });
  expect(res.statusCode).toBe(200);
  const body = res.json() as ScoreBody;
  await app.close();
  return body;
}

describe("plan-aware premium view · total-less multi-coverage plans", () => {
  it("sums the coverage premiums when the plan declares no total", async () => {
    const body = await score(planStagesPayload(TOTALLESS_STAGES));
    expect(body.row_status).toBe("ok");
    expect(body.outputs["building_premium"]).toBe(13);
    expect(body.outputs["contents_premium"]).toBe(1650);
    // THE premium is the dec-page sum — and says so.
    expect(body.views.premium).toBe(1663);
    expect(body.views.premiumBasis).toBe("coverage_sum");
  });

  it("EXPOSURE-RATED total-less towers sum too — per-tip ISO rounds are not a total", async () => {
    // The workbook-built shape (apply_exposure + divisor): each tower
    // tip carries its own ISO round NODE. The aggregate detector must
    // not mistake those tips for a plan total (the live bug's shape).
    const stages = [
      {
        stage_id: "chain_1",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "building premium",
              coverage_value: "building",
              apply_exposure: true,
              base_input: "literal.base_value",
              base_value: 0.15,
              exposure_input: "form_input.tiv",
              exposure_unit_divisor: 100.0,
              factor_lookups: [],
              lcm: { value: 1.3 },
              output_field: "building_premium",
            },
            {
              name: "contents premium",
              coverage_value: "contents",
              apply_exposure: true,
              base_input: "literal.base_value",
              base_value: 0.055,
              exposure_input: "form_input.bpp",
              exposure_unit_divisor: 100.0,
              factor_lookups: [],
              lcm: { value: 1.3 },
              output_field: "contents_premium",
            },
          ],
          output_total_field: "all_coverages_subtotal",
        },
      },
    ];
    const body = await score(
      planStagesPayload(stages, { inputs: { tiv: 200000, bpp: 100000 } }),
    );
    expect(body.row_status).toBe("ok");
    // 0.150 × (200000/100) × 1.3 = 390 ; 0.055 × (100000/100) × 1.3 = 71.5 → $72 tip-round.
    expect(body.outputs["building_premium"]).toBe(390);
    expect(body.outputs["contents_premium"]).toBe(72);
    // The sum of BOTH towers — not the last tip's $72.
    expect(body.views.premium).toBe(462);
    expect(body.views.premiumBasis).toBe("coverage_sum");
  });

  it("a declared total_premium resolves alone — never double-counted", async () => {
    const body = await score(planStagesPayload(withTotalStages("total_premium")));
    expect(body.row_status).toBe("ok");
    expect(body.outputs["total_premium"]).toBe(1663);
    // 1663, NOT 13 + 1650 + 1663 = 3326.
    expect(body.views.premium).toBe(1663);
    expect(body.views.premiumBasis).toBe("aggregate_output");
  });

  it("a CUSTOM-named round total is found by structure, not name", async () => {
    const body = await score(
      planStagesPayload(withTotalStages("package_premium")),
    );
    expect(body.row_status).toBe("ok");
    expect(body.outputs["package_premium"]).toBe(1663);
    expect(body.views.premium).toBe(1663);
    expect(body.views.premiumBasis).toBe("aggregate_output");
  });

  it("an explicit views.premiumField still wins over the sum", async () => {
    const body = await score(
      planStagesPayload(TOTALLESS_STAGES, {
        views: { premiumField: "contents_premium" },
      }),
    );
    expect(body.views.premium).toBe(1650);
    expect(body.views.premiumBasis).toBe("premium_field");
  });

  it("Law 2 / G8 — an error row never sums the surviving towers", async () => {
    const stages = [
      {
        stage_id: "chain_1",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "building",
              base_input: "ignored",
              base_value: 13,
              factor_lookups: [],
              lcm: { value: 1.0 },
              output_field: "building_premium",
            },
            {
              // No base_value and no input provided — this tower refuses.
              name: "contents",
              base_input: "bpp_rate",
              factor_lookups: [],
              lcm: { value: 1.0 },
              output_field: "contents_premium",
            },
          ],
          output_total_field: "all_coverages_subtotal",
        },
      },
    ];
    const body = await score(planStagesPayload(stages));
    expect(body.row_status).toBe("error");
    // The partial ($13) must not surface as a premium.
    expect(body.views.premium).toBeNull();
    expect(body.views.premiumBasis).toBeUndefined();
    expect(body.views.perCoverage).toEqual({});
  });

  it("a policy tail over a total-less plan is a NAMED refusal, not a tax on the last tower", async () => {
    const body = await score(
      planStagesPayload(TOTALLESS_STAGES, {
        policyTail: [
          {
            kind: "endorsement",
            id: "e_flat",
            form: "E-1",
            effect: { kind: "flat", amount: 25 },
          },
        ],
      }),
    );
    expect(body.row_status).toBe("error");
    expect(body.views.premium).toBeNull();
    const issue = (body.rowIssues ?? []).find(
      (i) => i.code === "composition_failed",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/declares no total output/);
  });

  it("one money output resolves even beside numeric debug outputs", async () => {
    // Raw runtime plan: a $140 money output + a 0.8 `number` debug
    // output. The old single-NUMERIC heuristic saw two numbers and
    // gave up; the money typing now names the premium.
    const plan = {
      id: "raw.single-money",
      version: "1.0.0",
      name: "single money + debug number",
      nodes: [
        { id: "c_prem", kind: "constant", params: { value: 140, type: "money" } },
        {
          id: "out_prem",
          kind: "output",
          params: { fieldName: "prem_premium", fieldType: "money" },
        },
        {
          id: "c_dbg",
          kind: "constant",
          params: { value: 0.8, type: "number" },
        },
        {
          id: "out_dbg",
          kind: "output",
          params: { fieldName: "model_factor_used", fieldType: "number" },
        },
      ],
      edges: [
        { from: { node: "c_prem", port: "value" }, to: { node: "out_prem", port: "value" } },
        { from: { node: "c_dbg", port: "value" }, to: { node: "out_dbg", port: "value" } },
      ],
    };
    const body = await score({
      source: "plan",
      plan,
      inputs: {},
      trace: "none",
    });
    expect(body.row_status).toBe("ok");
    expect(body.views.premium).toBe(140);
    expect(body.views.premiumBasis).toBe("single_output");
  });
});
