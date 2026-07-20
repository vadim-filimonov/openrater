/**
 * P2 G4 + G5 + G8 (ADR-0056) — /score composes the FILED premium,
 * names bad inputs, and withholds money on refusal.
 *
 * G4: a snapshot carrying a frozen policy tail + an authored floor
 * composes subtotal → tail steps → floor, and `views.premium` IS
 * `composed.final` (the filed number an API caller must see — Law 1).
 * The G9 floor applies ONCE, post-tail, at composition (the projection
 * omitted the per-row floor under `minPremiumScope: "policy"`).
 *
 * G5: missing/unknown request fields are NAMED against the plan's
 * consumed inputs (`inputIssues`) — the engine's G8 refusal already
 * guarantees no plausible number, so this is the ergonomics half, not
 * a 4xx (the strict quote contract is P4's api-lab endpoint).
 *
 * G8: an error row carries a STATUS, never a number — including when
 * the plan PARTIALLY executes (some chains resolved, some refused):
 * the partial chain total must never surface as `views.premium`.
 */

import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

import {
  clearSnapshotPlanCache,
} from "../core/apiLabPlans";
import { buildApp } from "../http/server";

const API_LAB = "http://api-lab.test:8001";

/** An authored-substrate snapshot body: base $140 chain + $500 floor
 *  round + a frozen tail with one flat +$25 endorsement. */
const BODY = {
  plan: {},
  stages: [
    {
      stage_id: "chain_1",
      stage_kind: "multiplicative_chain",
      config_json: {
        chains: [
          {
            name: "prem",
            base_input: "ignored",
            base_value: 140,
            factor_lookups: [],
            lcm: { value: 1.0 },
            output_field: "prem_premium",
          },
        ],
        output_total_field: "premium",
      },
    },
    {
      stage_id: "final_round",
      stage_kind: "round",
      config_json: {
        input_path: "chain.total_premium",
        increment_input: "literal:1",
        min_value_input: "literal:500",
        output_field: "total_premium",
      },
    },
  ],
  dimensions: [],
  factor_tables: [],
  // The API envelope shape (ADR-0055) — the reader unwraps `.tail`.
  policy_tail: {
    rating_plan_id: "plan_x",
    tail: [
      {
        kind: "endorsement",
        id: "e_flat",
        form: "E-1",
        effect: { kind: "flat", amount: 25 },
      },
    ],
  },
};

function stubSnapshotFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return new Response(
        JSON.stringify({ snapshot_id: "ps_g4", plan_id: "plan_x", body: BODY }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
}

describe("P2 G4 · /score composes the filed premium (plan_id)", () => {
  beforeEach(() => clearSnapshotPlanCache());
  afterEach(() => vi.unstubAllGlobals());

  it("views.premium = composed.final: subtotal $140 → +$25 endorsement → $500 floor", async () => {
    stubSnapshotFetch();
    const app = buildApp({ apiLabBase: API_LAB });
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_id",
        planId: "plan_x",
        snapshotId: "ps_g4",
        inputs: {},
        trace: "none",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      outputs: Record<string, unknown>;
      views: { premium: number | null };
      composed?: {
        subtotal: number;
        final: number;
        adjustments: readonly { id?: string }[];
      };
      row_status: string;
    };
    // Per-row output is UNFLOORED under policy scope ($140)…
    expect(body.outputs["total_premium"]).toBe(140);
    // …the composition applies the tail then the floor ONCE:
    expect(body.composed?.subtotal).toBe(140);
    expect(body.composed?.final).toBe(500);
    // …and THE premium an API caller reads is the FILED number.
    expect(body.views.premium).toBe(500);
    expect(body.row_status).toBe("ok");
    // The synthetic floor step is auditable in the build-up.
    expect(
      body.composed?.adjustments.some((a) => a.id === "plan_min_premium"),
    ).toBe(true);
    await app.close();
  });
});

describe("P2 G5 · /score names missing/unknown inputs", () => {
  beforeEach(() => clearSnapshotPlanCache());
  afterEach(() => vi.unstubAllGlobals());

  it("missing consumed fields + unknown extras are NAMED (engine still refuses honestly)", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan",
        plan: {
          id: "t.g5",
          version: "1.0.0",
          name: "g5",
          effective: "2026-01-01",
          nodes: [
            {
              id: "in_rev",
              kind: "input",
              params: { fieldName: "revenue", fieldType: "number" },
            },
            { id: "k2", kind: "constant", params: { value: 2, type: "number" } },
            { id: "mul", kind: "math.op", params: { op: "mul" } },
            {
              id: "out_p",
              kind: "output",
              params: { fieldName: "premium", fieldType: "money" },
            },
          ],
          edges: [
            { from: { node: "in_rev", port: "value" }, to: { node: "mul", port: "x" } },
            { from: { node: "k2", port: "value" }, to: { node: "mul", port: "y" } },
            { from: { node: "mul", port: "result" }, to: { node: "out_p", port: "value" } },
          ],
        },
        inputs: { revenu: 100 }, // typo'd field
        trace: "none",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      inputIssues?: { missing_inputs: string[]; unknown_inputs: string[] };
      row_status: string;
      rowIssues?: readonly { code: string }[];
      views: { premium: number | null };
    };
    // G5 — the typo is NAMED both ways.
    expect(body.inputIssues?.missing_inputs).toEqual(["revenue"]);
    expect(body.inputIssues?.unknown_inputs).toEqual(["revenu"]);
    // G8 — and the row REFUSED (no plausible number ever left).
    expect(body.row_status).toBe("error");
    expect(body.views.premium).toBeNull();
    //  — no verdict on an unrateable row either: a derived
    // tier would be fabricated from partial state.
    expect(
      (body.views as { tier?: string | null }).tier ?? null,
    ).toBeNull();
    expect(
      body.rowIssues?.some((i) => i.code === "unresolved_output"),
    ).toBe(true);
    await app.close();
  });
});

describe("P2 G8 · /score withholds money on partial chain execution", () => {
  it("a multi-chain plan with SOME rateable chains still refuses whole (premium null, perCoverage empty)", async () => {
    const app = buildApp();
    // Three coverage chains; only the gross_receipts chain's input is
    // supplied, so gr_premium resolves ($1.25M) while tv/lb refuse.
    // Observed live 2026-07-09: the row said "error" yet views.premium
    // carried the gr chain's partial total — the number this test pins
    // to null (Law 2 — a partial book is not a premium).
    const chain = (name: string, base: string) => ({
      name,
      base_input: base,
      factor_lookups: [],
      lcm: { value: 1.0 },
      output_field: `${name}_premium`,
    });
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_stages",
        stages: [
          {
            stage_id: "chain_1",
            stage_kind: "multiplicative_chain",
            config_json: {
              chains: [
                chain("gr", "gross_receipts"),
                chain("tv", "tiv"),
                chain("lb", "liab_exposure_base"),
              ],
              output_total_field: "premium",
            },
          },
        ],
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        inputs: { gross_receipts: 1_250_000 },
        trace: "none",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      outputs: Record<string, unknown>;
      views: { premium: number | null; perCoverage: Record<string, number> };
      row_status: string;
      rowIssues?: readonly { code: string; message: string }[];
    };
    // The row REFUSED (unresolved outputs are named)…
    expect(body.row_status).toBe("error");
    expect(
      body.rowIssues?.some((i) => i.code === "unresolved_output"),
    ).toBe(true);
    // …the chain that DID execute stays diagnosable in raw outputs…
    expect(body.outputs["gr_premium"]).toBe(1_250_000);
    // …but NO money leaves through views: not the partial premium,
    // and no per-coverage partials a caller could re-sum.
    expect(body.views.premium).toBeNull();
    expect(body.views.perCoverage).toEqual({});
    await app.close();
  });
});

/**
 * The model-registry resolution path is retired.
 * A legacy model-sourced tail refuses BY NAME (`composition_failed`
 * carrying the canonical message + the pinned ref), never the pre-tail
 * number served as THE premium (Law 2), and never an identity factor.
 * The supported migration — the score as a typed input read by a
 * `column` source — composes through the same seam.
 */
describe("S1 · legacy model-sourced tails refuse; column-sourced scores compose", () => {
  beforeEach(() => {
    clearSnapshotPlanCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  /** BODY variant: no floor and a model-sourced schedule_rating (the
   *  legacy shape a pre-cut snapshot could still carry). */
  const MODEL_BODY = {
    ...BODY,
    stages: [
      BODY.stages[0],
      {
        stage_id: "final_round",
        stage_kind: "round",
        config_json: {
          input_path: "chain.total_premium",
          increment_input: "literal:1",
          output_field: "total_premium",
        },
      },
    ],
    policy_tail: {
      rating_plan_id: "plan_x",
      tail: [
        {
          kind: "schedule_rating",
          id: "irpm",
          cap_pct: 25,
          source: { from: "model", model_id: "m-irpm", version: "v1" },
        },
      ],
    },
  };

  /** The migration shape: the same 10% credit as a typed input column. */
  const COLUMN_BODY = {
    ...MODEL_BODY,
    policy_tail: {
      rating_plan_id: "plan_x",
      tail: [
        {
          kind: "schedule_rating",
          id: "irpm",
          cap_pct: 25,
          source: { from: "column", column: "irpm_total_pct" },
        },
      ],
    },
  };

  function stubSnapshotWith(body: unknown): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ snapshot_id: "ps_irpm", plan_id: "plan_x", body }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  }

  it("legacy model source → NAMED composition_failed with the S1 message (never the pre-tail number)", async () => {
    stubSnapshotWith(MODEL_BODY);
    const app = buildApp({ apiLabBase: API_LAB });
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_id",
        planId: "plan_x",
        snapshotId: "ps_irpm",
        inputs: {},
        trace: "none",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      outputs: Record<string, unknown>;
      views: { premium: number | null };
      composed?: unknown;
      row_status: string;
      rowIssues?: readonly { code: string; message: string }[];
    };
    // The row itself rated (pre-tail context stays auditable)…
    expect(body.outputs["total_premium"]).toBe(140);
    // …but THE premium is WITHHELD, the verdict is error, and the
    // refusal names both the pinned ref and the migration path.
    expect(body.views.premium).toBeNull();
    expect(body.composed).toBeUndefined();
    expect(body.row_status).toBe("error");
    const issue = body.rowIssues?.find((i) => i.code === "composition_failed");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("m-irpm@v1");
    expect(issue?.message).toMatch(/not supported in OpenRater/);
    expect(issue?.message).toMatch(/typed input/i);
    await app.close();
  });

  it("the migration path composes on /score-policy: $140 subtotal × 0.9 (column-sourced −10%) = $126", async () => {
    // The refusal message's exact recipe: the score is a DECLARED input
    // (`policyInputKeys` lifts it to the tail's context) read by a
    // `{from:"column"}` source — same credit the retired GLM emitted.
    stubSnapshotWith(COLUMN_BODY);
    const app = buildApp({ apiLabBase: API_LAB });
    const res = await app.inject({
      method: "POST",
      url: "/score-policy",
      payload: {
        source: "plan_id",
        planId: "plan_x",
        snapshotId: "ps_irpm",
        locations: [{ irpm_total_pct: -10 }],
        policyInputKeys: ["irpm_total_pct"],
        trace: "none",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      premium: number | null;
      composed?: { subtotal: number; final: number };
      row_status: string;
    };
    expect(body.composed?.subtotal).toBe(140);
    expect(body.composed?.final).toBe(126);
    expect(body.premium).toBe(126);
    expect(body.row_status).toBe("ok");
    await app.close();
  });
});
