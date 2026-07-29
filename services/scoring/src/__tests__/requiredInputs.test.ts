/**
 * FCA fca-2026-07-25 — the two /score halves of the S0 eligibility-
 * enforcement cluster, end-to-end over the HTTP surface:
 *
 *  · REQUIRED-INPUT-OMITTED REFUSAL: a declared-required, no-default
 *    input that feeds ONLY the eligibility gate used to be silently
 *    skippable — the gate's missing-variable grace fell through to a
 *    confident 'standard' on a risk the filing hard-declines
 *    (vehicle_use / Rule 3.B), with row_status 'ok' and input_issues
 *    null. Spec §12.4: required + no default + absent ⇒ the row
 *    refuses, loudly, naming the field.
 *
 *  · DEFAULT-APPLIED: an authored inputs-sheet default_value was
 *    honored on NO path ('not supplied (no default)' even when the
 *    schema echoed the default). The projector now carries it, so an
 *    omitted defaulted field prices instead of refusing.
 */

import { describe, expect, it } from "vitest";

import { buildApp } from "../http/server";

const GATED_STAGES = [
  {
    stage_id: "input_vehicle_use",
    stage_kind: "input_node",
    config_json: {
      name: "vehicle_use",
      data_type: "string",
      source: "form",
      source_path: "vehicle_use",
      required: true,
      output_field: "value",
    },
  },
  {
    stage_id: "eligibility_gate",
    stage_kind: "eligibility.gate",
    config_json: {
      rules: [
        {
          rule_id: "delivery_livery",
          variable: "vehicle_use",
          op: "in",
          value: ["delivery", "livery"],
          tier: "decline",
          reasoning:
            "Rule 3.B: an auto used for delivery of goods or persons " +
            "for a fee or as a public livery conveyance is not eligible.",
        },
      ],
      default_tier: "standard",
      default_reasoning: "Rule 3.C: all other autos.",
    },
  },
  {
    stage_id: "chain_1",
    stage_kind: "multiplicative_chain",
    config_json: {
      chains: [
        {
          name: "prem",
          base_input: "ignored",
          base_value: 440,
          factor_lookups: [],
          lcm: { value: 1.0 },
          output_field: "prem_premium",
        },
      ],
      output_total_field: "premium",
    },
  },
];

function scorePayload(inputs: Record<string, unknown>): Record<string, unknown> {
  return {
    source: "plan_stages",
    stages: GATED_STAGES,
    dimensions: [],
    factorTables: [],
    factorTableCells: {},
    inputs,
    trace: "none",
    options: { as_of: "2024-01-01" },
  };
}

interface ScoreBody {
  readonly row_status: "ok" | "error";
  readonly views: { premium: number | null; tier: string | null };
  readonly inputIssues?: {
    missing_inputs: readonly string[];
    unknown_inputs: readonly string[];
  };
  readonly rowIssues?: readonly { code?: string; message?: string }[];
  readonly composed?: unknown;
}

describe("/score · required gate-only input (FCA refusal)", () => {
  it("omitting the deciding input REFUSES by name — never a confident 'standard'", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      // Everything EXCEPT vehicle_use — the S5 shape.
      payload: scorePayload({}),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ScoreBody;
    expect(body.row_status).toBe("error");
    // Premium and verdict withheld — no $440, no 'standard'.
    expect(body.views.premium).toBeNull();
    expect(body.views.tier).toBeNull();
    // The refusal NAMES the field (the shipped contract: 'the engine
    // refuses honestly — it never guesses').
    expect(body.inputIssues?.missing_inputs).toEqual(["vehicle_use"]);
    const missing = (body.rowIssues ?? []).find(
      (i) => i.code === "missing_input",
    );
    expect(missing?.message).toMatch(/vehicle_use/);
    // A refused row never hands back a composed build-up either.
    expect(body.composed).toBeUndefined();
    await app.close();
  });

  it("supplied, the same field still works both ways (decline fires; standard rates)", async () => {
    const app = buildApp();
    const livery = (
      await app.inject({
        method: "POST",
        url: "/score",
        payload: scorePayload({ vehicle_use: "livery" }),
      })
    ).json() as ScoreBody;
    expect(livery.row_status).toBe("ok");
    expect(livery.views.tier).toBe("decline");

    const pleasure = (
      await app.inject({
        method: "POST",
        url: "/score",
        payload: scorePayload({ vehicle_use: "pleasure" }),
      })
    ).json() as ScoreBody;
    expect(pleasure.row_status).toBe("ok");
    expect(pleasure.views.tier).toBe("standard");
    expect(pleasure.views.premium).toBe(440);
    await app.close();
  });
});

describe("/score · refusal stays scoped to the declared dictionary (FCA review)", () => {
  it("a projector/caller default SATISFIES a declared-required field — no refusal", async () => {
    // Review-confirmed regression shape: declared required with no
    // workbook default, but the caller supplies the constant via
    // projectorOptions.defaults (PR D2b — 'per-plan constants
    // shouldn't require CSV columns'). The row rates; refusing it
    // would contradict the projected plan's own knowledge.
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_stages",
        stages: [
          {
            stage_id: "input_base_rate",
            stage_kind: "input_node",
            config_json: {
              name: "base_rate",
              data_type: "money",
              source: "form",
              source_path: "base_rate",
              required: true,
              output_field: "value",
            },
          },
          {
            stage_id: "chain_1",
            stage_kind: "multiplicative_chain",
            config_json: {
              chains: [
                {
                  name: "prem",
                  base_input: "form_input.base_rate",
                  factor_lookups: [],
                  lcm: { value: 1.0 },
                  output_field: "prem_premium",
                },
              ],
              output_total_field: "premium",
            },
          },
        ],
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        projectorOptions: { defaults: { base_rate: 100 } },
        inputs: {},
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ScoreBody;
    expect(body.row_status).toBe("ok");
    expect(body.views.premium).toBe(100);
    expect(body.inputIssues?.missing_inputs ?? []).toEqual([]);
    await app.close();
  });

  it("a declared-OPTIONAL gate-only field keeps the grace — no refusal", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_stages",
        stages: [
          {
            stage_id: "input_state",
            stage_kind: "input_node",
            config_json: {
              name: "state",
              data_type: "string",
              source: "form",
              source_path: "state",
              required: false,
              output_field: "value",
            },
          },
          ...GATED_STAGES.filter((s) => s.stage_id !== "input_vehicle_use"),
        ],
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        inputs: {},
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    const body = res.json() as ScoreBody;
    // vehicle_use is UNDECLARED here (its input_node was dropped) and
    // state is declared optional — neither refuses; the gate's grace
    // falls through to the default tier as before the FCA fix.
    expect(body.row_status).toBe("ok");
    expect(body.views.tier).toBe("standard");
    expect(body.views.premium).toBe(440);
    await app.close();
  });
});

describe("/score · gate-only declared default reaches the gate (FCA review)", () => {
  // The workbook default on a field ONLY the gate reads has no input
  // node to ride — it must land in the externalInputs record itself,
  // or a default that decides eligibility is silently ignored. Proof:
  // author the default as 'livery' — the DECLINE spelling — and omit
  // the field: only a default that actually reached the gate can fire
  // the knock-out.
  const DEFAULTED_GATE_STAGES = [
    {
      stage_id: "input_vehicle_use",
      stage_kind: "input_node",
      config_json: {
        name: "vehicle_use",
        data_type: "string",
        source: "form",
        source_path: "vehicle_use",
        required: true,
        default_value: "livery",
        output_field: "value",
      },
    },
    ...GATED_STAGES.filter((s) => s.stage_id !== "input_vehicle_use"),
  ];

  it("an omitted gate-only field takes its declared default at the gate", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_stages",
        stages: DEFAULTED_GATE_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        inputs: {},
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    const body = res.json() as ScoreBody;
    // The default 'livery' reached the gate → Rule 3.B fires. No
    // refusal either — the declared default satisfies the field.
    expect(body.row_status).toBe("ok");
    expect(body.views.tier).toBe("decline");
    expect(body.inputIssues?.missing_inputs ?? []).toEqual([]);
    await app.close();
  });

  it("a supplied value still wins over the gate-only default", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_stages",
        stages: DEFAULTED_GATE_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        inputs: { vehicle_use: "pleasure" },
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    const body = res.json() as ScoreBody;
    expect(body.row_status).toBe("ok");
    expect(body.views.tier).toBe("standard");
    await app.close();
  });
});

describe("/score · authored default_value applied (FCA default-applied)", () => {
  // A required-but-DEFAULTED input consumed by the chain: omitting it
  // must price with the filed default, not refuse.
  const DEFAULTED_STAGES = [
    {
      stage_id: "input_base_rate",
      stage_kind: "input_node",
      config_json: {
        name: "base_rate",
        data_type: "money",
        source: "form",
        source_path: "base_rate",
        required: true,
        default_value: 600,
        output_field: "value",
      },
    },
    {
      stage_id: "chain_1",
      stage_kind: "multiplicative_chain",
      config_json: {
        chains: [
          {
            name: "prem",
            base_input: "form_input.base_rate",
            factor_lookups: [],
            lcm: { value: 1.0 },
            output_field: "prem_premium",
          },
        ],
        output_total_field: "premium",
      },
    },
  ];

  it("an omitted defaulted input prices with the authored default", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_stages",
        stages: DEFAULTED_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        inputs: {},
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ScoreBody;
    expect(body.row_status).toBe("ok");
    expect(body.views.premium).toBe(600);
    // No missing-input demand — the default satisfies the field.
    expect(body.inputIssues?.missing_inputs ?? []).toEqual([]);
    await app.close();
  });

  it("a supplied value still wins over the default", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_stages",
        stages: DEFAULTED_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        inputs: { base_rate: 1000 },
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    const body = res.json() as ScoreBody;
    expect(body.row_status).toBe("ok");
    expect(body.views.premium).toBe(1000);
    await app.close();
  });
});

describe("/score · JSON null supplies no value (FCA #10 wire sample)", () => {
  // The Ship try-it's honest placeholder: a required field nothing can
  // answer rides the wire as `"vehicle_use": null`. That must earn the
  // SAME refusal as the omission — null used to count as supplied, the
  // gate's grace only covers `undefined`, and the row rated a risk
  // whose one eligibility answer was never given.
  it("a null'd declared-required field refuses by name — never a confident 'standard'", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: scorePayload({ vehicle_use: null }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ScoreBody;
    expect(body.row_status).toBe("error");
    expect(body.views.premium).toBeNull();
    expect(body.views.tier).toBeNull();
    const missing = (body.rowIssues ?? []).find(
      (i) => i.code === "missing_input",
    );
    expect(missing?.message).toMatch(/vehicle_use/);
    await app.close();
  });

  it("a null'd gate-only field WITH a declared default takes the default at the gate", async () => {
    // Same proof shape as the omission case: the default is the
    // DECLINE spelling, so only a default that filled the null can
    // fire the knock-out.
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_stages",
        stages: [
          {
            stage_id: "input_vehicle_use",
            stage_kind: "input_node",
            config_json: {
              name: "vehicle_use",
              data_type: "string",
              source: "form",
              source_path: "vehicle_use",
              required: true,
              default_value: "livery",
              output_field: "value",
            },
          },
          ...GATED_STAGES.filter((s) => s.stage_id !== "input_vehicle_use"),
        ],
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        inputs: { vehicle_use: null },
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    const body = res.json() as ScoreBody;
    expect(body.row_status).toBe("ok");
    expect(body.views.tier).toBe("decline");
    expect(body.inputIssues?.missing_inputs ?? []).toEqual([]);
    await app.close();
  });
});
