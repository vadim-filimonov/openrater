/**
 * serverRunTrace tests — §14 (audit P4-01).
 *
 * The adapter is exercised against a REAL engine run: the same
 * projector → compile → run pipeline the platform uses (two coverage
 * towers over a shared territory×coverage table), with the run result
 * wrapped in the SERVER envelope (summary-stripped trace, exactly what
 * `projectTrace(…, "summary")` keeps and `plan_runs.result_json`
 * persists). No hand-rolled trace shapes — a drift in the projector's
 * id scheme or the runtime's trace contract breaks these tests.
 */

import { describe, it, expect } from "vitest";
import {
  compilePlan,
  runPlan,
  registerBuiltinKinds,
} from "@openrater/contracts";
import type { Dimension, RunResult, TraceEntry } from "@openrater/contracts";

import { stagesToRuntimePlan } from "../InputsWorkspace/stagesToRuntimePlan";
import type {
  StageLike,
  FactorTableLike,
} from "../InputsWorkspace/deriveRequiredInputs";
import { buildServerRunTraceView } from "./serverRunTrace";
import type { ServerRunResultLike } from "./serverRunTrace";

// Module scope, not beforeAll — the fixtures below run at collection
// time (describe-body consts), which precedes every beforeAll hook.
registerBuiltinKinds();

// ── The fixture plan: two coverage towers over one 2-D table ──────

const TERRITORY_DIM: Dimension = {
  id: "territory",
  slug: "territory",
  display_name: "Territory",
  data_type: "string",
  role: "rating-input",
} as Dimension;

const BASE_LC_TABLE: FactorTableLike[] = [
  {
    id: "ft_base_lc",
    display_name: "Meridian base factor",
    key_dimensions: ["territory", "coverage"],
    slug: "base_lc_property",
  } as unknown as FactorTableLike,
];

const BASE_LC_CELLS = new Map<string, ReadonlyMap<string, number>>([
  [
    "ft_base_lc",
    new Map([
      ["t1::building", 0.4],
      ["t1::bpp", 0.199],
      ["t2::building", 0.4],
      ["t2::bpp", 0.18],
    ]),
  ],
]);

function fixtureStages(): StageLike[] {
  const lookup = {
    name: "Base loss cost",
    factor_kind: "base_lc_property",
    lookup_method: "direct",
    // ADR-0056 — an unknown territory REFUSES (drives the withheld path).
    unknown_key_policy: { mode: "error" },
    dimensions: {
      territory: { source: "form_input", path: "form_input.territory" },
      coverage: { source: "literal", path: "coverage" },
    },
  };
  return [
    {
      stage_id: "in_territory_stage",
      stage_kind: "input_node",
      display_name: "Territory",
      config_json: { field_name: "territory", data_type: "string" },
    },
    {
      stage_id: "property_towers",
      stage_kind: "multiplicative_chain",
      config_json: {
        rating_dimension: "coverage",
        output_total_field: "total_premium",
        chains: [
          {
            name: "building",
            base_value: 1000,
            base_input: "literal.base_value",
            coverage_value: "building",
            factor_lookups: [lookup],
            lcm: { input_path: "form_input.lcm" },
            output_field: "building_premium",
          },
          {
            name: "bpp",
            base_value: 1000,
            base_input: "literal.base_value",
            coverage_value: "bpp",
            factor_lookups: [lookup],
            lcm: { input_path: "form_input.lcm" },
            output_field: "bpp_premium",
          },
        ],
      },
    },
  ] as unknown as StageLike[];
}

/** Mirror `projectTrace(…, "summary")` — what the server persists. */
function summaryStrip(
  trace: Record<string, TraceEntry>,
): Record<string, TraceEntry> {
  const out: Record<string, TraceEntry> = {};
  for (const [id, entry] of Object.entries(trace)) {
    out[id] = {
      kindId: entry.kindId,
      inputs: {},
      outputs: entry.outputs,
      ...(entry.citation ? { citation: entry.citation } : {}),
      ...(entry.explanation ? { explanation: entry.explanation } : {}),
      ...(entry.error ? { error: entry.error } : {}),
    } as TraceEntry;
  }
  return out;
}

/** Run the fixture plan for one risk and wrap it as the server would. */
function serverEnvelopeFor(risk: Record<string, unknown>): {
  run: RunResult;
  envelope: ServerRunResultLike;
} {
  const { plan } = stagesToRuntimePlan(
    fixtureStages(),
    [TERRITORY_DIM],
    BASE_LC_TABLE,
    BASE_LC_CELLS,
    { lcmOverride: 1.0 },
  );
  const run = runPlan(compilePlan(plan), risk);
  const envelope: ServerRunResultLike = {
    outputs: run.outputs,
    trace: summaryStrip(run.trace),
    as_of: run.as_of,
    durationMs: run.durationMs,
    row_status: run.row_status,
  };
  return { run, envelope };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("buildServerRunTraceView — a clean run", () => {
  const { run, envelope } = serverEnvelopeFor({ territory: "t1" });
  const view = buildServerRunTraceView({
    result: envelope,
    stages: fixtureStages(),
    dimensions: [TERRITORY_DIM],
  });

  it("order is the persisted trace's own key order (execution order)", () => {
    expect(view.nodeOrder).toEqual(Object.keys(envelope.trace ?? {}));
    // …which is the runtime's execution order, verbatim.
    expect(view.nodeOrder).toEqual(Object.keys(run.trace));
  });

  it("groups: Inputs → per-coverage Build-ups → Outputs, nothing dropped", () => {
    const titles = view.groups.map((g) => g.title);
    expect(titles).toContain("Inputs");
    expect(titles).toContain("Build-up — building");
    expect(titles).toContain("Build-up — bpp");
    expect(titles).toContain("Outputs");
    // Inputs precede build-ups precede Outputs.
    expect(titles.indexOf("Inputs")).toBeLessThan(
      titles.indexOf("Build-up — building"),
    );
    expect(titles.indexOf("Build-up — bpp")).toBeLessThan(
      titles.indexOf("Outputs"),
    );
    // Every grouped id exists in the trace; the groups never invent ids.
    const traceIds = new Set(view.nodeOrder);
    for (const g of view.groups) {
      for (const id of g.nodeIds) expect(traceIds.has(id)).toBe(true);
    }
  });

  it("the projector's per-chain PLUMBING is claimed by its chain (live-walk fix)", () => {
    // rate3_building / mulexp_building / prem_building etc. carry the
    // chain token; out_* stays in Outputs by kindId even though its id
    // carries the chain's name inside the field name.
    const building = view.groups.find(
      (g) => g.title === "Build-up — building",
    )!;
    for (const id of view.nodeOrder) {
      const entry = (envelope.trace ?? {})[id]!;
      if (entry.kindId === "output") {
        expect(building.nodeIds).not.toContain(id);
      }
      if (
        (id.endsWith("_building") || id.includes("_building_")) &&
        entry.kindId !== "output" &&
        entry.kindId !== "input" &&
        !entry.kindId.startsWith("derive.")
      ) {
        expect(building.nodeIds).toContain(id);
      }
    }
  });

  it("the building tower's lookup + chain land in ITS group (identity, not order)", () => {
    const building = view.groups.find(
      (g) => g.title === "Build-up — building",
    )!;
    expect(building.nodeIds).toContain("chain_building");
    expect(
      building.nodeIds.some((id) => id.startsWith("lk_building_")),
    ).toBe(true);
    // …and none of bpp's nodes leaked in.
    expect(
      building.nodeIds.some(
        (id) => id.startsWith("lk_bpp_") || id === "chain_bpp",
      ),
    ).toBe(false);
  });

  it("labels mine the authored names (input, lookup, chain)", () => {
    expect(view.nodeLabels["in_territory"]).toBe("Territory");
    expect(view.nodeLabels["lk_building_base_lc_property"]).toBe(
      "Base loss cost",
    );
    expect(view.nodeLabels["chain_building"]).toBe("building — build-up");
  });

  it("a clean run withholds nothing and keeps the premium visible", () => {
    expect(view.withheldOutputs).toEqual([]);
    expect(view.run.row_status).toBe("ok");
    expect(view.run.outputs["building_premium"]).toBeCloseTo(400, 6);
  });

  it("as_of + durationMs ride through from the envelope", () => {
    expect(view.run.as_of).toBe(run.as_of);
    expect(view.run.durationMs).toBe(run.durationMs);
  });
});

describe("buildServerRunTraceView — a refused run (ADR-0056)", () => {
  const { envelope } = serverEnvelopeFor({ territory: "999" });
  const view = buildServerRunTraceView({
    result: envelope,
    stages: fixtureStages(),
    dimensions: [TERRITORY_DIM],
  });

  it("the engine refused (precondition for the withheld contract)", () => {
    expect(envelope.row_status).toBe("error");
  });

  it("names every declared-but-unresolved output as withheld", () => {
    expect(view.withheldOutputs).toContain("building_premium");
    expect(view.withheldOutputs).toContain("bpp_premium");
    expect(view.withheldOutputs).toContain("total_premium");
    // …and never lists a field that DID resolve.
    for (const field of view.withheldOutputs) {
      expect(field in (envelope.outputs ?? {})).toBe(false);
    }
  });

  it("the trace still renders — the failing steps are the diagnosis", () => {
    expect(view.nodeOrder.length).toBeGreaterThan(0);
  });
});

describe("buildServerRunTraceView — envelope edges", () => {
  it("defaults timing when the wire omits it (the panel hides a 0)", () => {
    const view = buildServerRunTraceView({
      result: { outputs: {}, trace: {}, row_status: "ok" },
    });
    expect(view.run.durationMs).toBe(0);
    expect(view.run.as_of).toBe("");
  });

  it("passes `composed` through untouched (the G4 build-up)", () => {
    const composed = {
      subtotal: 2127,
      final: 2430,
      adjustments: [
        {
          id: "irpm",
          kind: "schedule_rating",
          applied: true,
          before: 2127,
          factor_or_delta: 1.1424,
          after: 2430,
          detail: "+14.2% (Σ 3 sections, cap ±25%)",
        },
      ],
    };
    const view = buildServerRunTraceView({
      result: { outputs: {}, trace: {}, row_status: "ok", composed },
    });
    expect(view.composed).toEqual(composed);
  });

  it("an empty envelope yields an empty, render-safe view", () => {
    const view = buildServerRunTraceView({ result: {} });
    expect(view.nodeOrder).toEqual([]);
    expect(view.groups).toEqual([]);
    expect(view.withheldOutputs).toEqual([]);
    expect(view.composed).toBeUndefined();
  });
});
