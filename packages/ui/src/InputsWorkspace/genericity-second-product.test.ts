// @vitest-environment node
/**
 * Genericity proof — a SECOND product, end-to-end (ADR-0034 gate 9).
 *
 * THE EXECUTABLE ANSWER TO "NO PATCH JOB" (owner's O-2). This test
 * authors a BOP product the codebase has never special-cased — the
 * canonical shape `base × class × TIV-band × LCM` — and composes a
 * `bop + cgl` policy through the IDENTICAL pipeline the nonprofit D&O+GL
 * book uses:
 *
 *   stagesToRuntimePlan()  → compilePlan()  → runPlan()  → composePolicy()
 *
 * Every one of those is an UNCHANGED import from the same modules. Not a
 * line of engine, projector, or composer code was added to make BOP
 * rate + compose. If this test ever requires such a change to pass, the
 * Genericity invariant (ADR-0033 §0) is violated and the change is wrong.
 *
 * (The composer's product-blindness is also covered by the bop/auto/wc
 * unit tests in contracts; this is the end-to-end, through-the-projector
 * complement.)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { compilePlan, registerBuiltinKinds, composePolicy } from "@openrater/contracts";
import type { Dimension, Policy, CompiledPlan } from "@openrater/contracts";
import { stagesToRuntimePlan } from "./stagesToRuntimePlan";
import type { StageLike, FactorTableLike } from "./deriveRequiredInputs";

// ── compact substrate builders (shapes mirror nonprofit-book.conformance) ──

interface Band {
  id: string;
  lo: number;
  hi: number;
}
interface TableSpec {
  id: string;
  keyDim: string;
  cells: Record<string, number>;
}
interface Lookup {
  tableId: string;
  dimSlug: string;
  rawCol: string;
}

function catDim(slug: string): Dimension {
  return {
    id: slug, slug, display_name: slug, data_type: "string", role: "rating-input",
  } as unknown as Dimension;
}
function bandedDim(slug: string, bands: Band[]): Dimension {
  return {
    id: slug, slug, display_name: slug, data_type: "number", role: "rating-input",
    shape: "banded",
    levels: bands.map((b) => ({ kind: "banded", id: b.id, label: b.id, lo: b.lo, hi: b.hi })),
  } as unknown as Dimension;
}
function table(id: string, keyDim: string, cells: Record<string, number>): TableSpec {
  return { id, keyDim, cells };
}
function factorTableLike(t: TableSpec): FactorTableLike {
  return { id: t.id, display_name: t.id, key_dimension: t.keyDim, slug: t.id } as unknown as FactorTableLike;
}
function chainStage(
  stageId: string,
  chains: Array<{ name: string; baseValue: number; output: string; lookups: Lookup[] }>,
): StageLike {
  return {
    stage_id: stageId,
    stage_kind: "multiplicative_chain",
    config_json: {
      chains: chains.map((c) => ({
        name: c.name,
        base_input: "literal.base_value",
        base_value: c.baseValue,
        factor_lookups: c.lookups.map((l) => ({
          name: l.tableId,
          factor_kind: l.tableId,
          dimensions: { [l.dimSlug]: { source: "form_input", path: `form_input.${l.rawCol}` } },
        })),
        lcm: { input_path: "form_input.lcm" },
        output_field: c.output,
      })),
      output_total_field: "plan_total_premium",
    },
  };
}
function buildPlan(stage: StageLike, dims: Dimension[], tables: TableSpec[]): CompiledPlan {
  const cells = new Map<string, ReadonlyMap<string, number>>(
    tables.map((t) => [t.id, new Map(Object.entries(t.cells))]),
  );
  const { plan } = stagesToRuntimePlan([stage], dims, tables.map(factorTableLike), cells, {
    lcmOverride: LCM,
  });
  return compilePlan(plan);
}

const LCM = 1.5;

// ── BOP product: base × class × TIV-band × LCM (the canonical BOP shape) ──
const TIV_BANDS: Band[] = [
  { id: "low", lo: -Infinity, hi: 500_000 },
  { id: "high", lo: 500_000, hi: Infinity },
];
const BOP_DIMS: Dimension[] = [catDim("bop_class"), bandedDim("tiv_band", TIV_BANDS)];
const BOP_TABLES: TableSpec[] = [
  table("class_bop", "bop_class", { retail: 1.25, office: 0.9 }),
  table("tiv_bop", "tiv_band", { low: 0.8, high: 2.0 }),
];
const BOP_STAGE: StageLike = chainStage("bop_plan", [
  {
    name: "BOP premium", baseValue: 1000, output: "bop_premium",
    lookups: [
      { tableId: "class_bop", dimSlug: "bop_class", rawCol: "class_code" },
      { tableId: "tiv_bop", dimSlug: "tiv_band", rawCol: "tiv" },
    ],
  },
]);

// ── A trivial CGL product to compose the BOP against ──
const CGL_DIMS: Dimension[] = [catDim("cgl_class")];
const CGL_TABLES: TableSpec[] = [table("class_cgl", "cgl_class", { retail: 1.0, office: 1.2 })];
const CGL_STAGE: StageLike = chainStage("cgl_plan", [
  {
    name: "GL premium", baseValue: 500, output: "gl_premium",
    lookups: [{ tableId: "class_cgl", dimSlug: "cgl_class", rawCol: "class_code" }],
  },
]);

const POLICY: Policy = {
  policy_id: "bop-cgl",
  lines: [
    { plan_ref: { plan_id: "plan-bop", content_hash: "bop-v1", product: "bop" }, premium_output: "bop_premium" },
    { plan_ref: { plan_id: "plan-cgl", content_hash: "cgl-v1", product: "cgl" }, premium_output: "gl_premium" },
  ],
};

beforeAll(() => {
  registerBuiltinKinds();
});

describe("genericity — a second product (bop) rates + composes via the same pipeline", () => {
  function compose(inputs: Record<string, unknown>, policy: Policy = POLICY) {
    const bop = buildPlan(BOP_STAGE, BOP_DIMS, BOP_TABLES);
    const cgl = buildPlan(CGL_STAGE, CGL_DIMS, CGL_TABLES);
    return composePolicy(policy, (line) => ({
      compiled: line.plan_ref.product === "bop" ? bop : cgl,
      externalInputs: inputs,
    }));
  }
  const premiumOf = (r: ReturnType<typeof compose>, product: string) =>
    r.lines.find((l) => l.product === product)?.premium;

  it("BOP rates end-to-end (class lookup × TIV band × LCM) and composes with CGL", () => {
    const r = compose({ class_code: "retail", tiv: 250_000 });
    // BOP: 1000 × 1.25 (retail) × 0.8 (low TIV) × 1.5 (LCM) = 1500
    // CGL:  500 × 1.0  (retail)                × 1.5 (LCM) =  750
    expect(premiumOf(r, "bop")).toBe(1500);
    expect(premiumOf(r, "cgl")).toBe(750);
    expect(r.total).toBe(2250);
    expect(r.lines.map((l) => l.product)).toEqual(["bop", "cgl"]);
  });

  it("the high-TIV band lifts the BOP premium (derive.band works for the new product)", () => {
    const r = compose({ class_code: "retail", tiv: 750_000 });
    // BOP: 1000 × 1.25 × 2.0 (high TIV) × 1.5 = 3750
    expect(premiumOf(r, "bop")).toBe(3750);
  });

  it("a different class re-rates BOP (lookup.direct works for the new product)", () => {
    const r = compose({ class_code: "office", tiv: 250_000 });
    // BOP: 1000 × 0.9 (office) × 0.8 × 1.5 = 1080 ; CGL: 500 × 1.2 × 1.5 = 900
    expect(premiumOf(r, "bop")).toBe(1080);
    expect(premiumOf(r, "cgl")).toBe(900);
  });

  it("a cross-product package credit composes for bop+cgl too", () => {
    const credited = compose(
      { class_code: "retail", tiv: 250_000 },
      { ...POLICY, package_credit: 0.9 },
    );
    expect(credited.after_credit).toBeCloseTo(2250 * 0.9, 6); // 2025
    expect(credited.total).toBeCloseTo(2025, 6);
  });
});
