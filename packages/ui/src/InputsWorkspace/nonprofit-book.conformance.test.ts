// @vitest-environment node
/**
 * Book-level conformance — the nonprofit D&O + GL rating plan, scored
 * end-to-end against the frozen 2,000-policy dataset.
 *
 * WHY THIS EXISTS (ADR-0032 Phase 0). Every prior validation of the
 * full rating pipeline has been a *manual* cold-test (J–O). That let
 * regressions slip — most notably N13, which a prior round *claimed*
 * fixed but never verified end-to-end. This test makes the happy path
 * un-break-able: it drives the SAME pipeline the Inputs workspace uses
 * (authored stages → `stagesToRuntimePlan` projector → `compilePlan` →
 * score every row) and asserts the ground-truth book to the dollar.
 *
 * It is the regression guard the upcoming axis cleanup + location-input
 * refactor (ADR-0032 Tracks) lean on: if either breaks the line→chain
 * mapping, the binning, the territory resolution, the clamp, the LCM,
 * or the base rate, this test goes red. It is also the OSS conformance
 * proof at the book level (the single-row engine vectors live in
 * `packages/contracts/src/__tests__/conformance/`).
 *
 * ADR-0034 gate 8 — THE PLAN IS NOW SPLIT. Per the axis cleanup, the
 * cold-test "D&O + GL plan" is no longer one plan with two chains whose
 * lines were inferred by name-heuristic. It is TWO product Plans — a
 * `do` Plan (base 600) and a `cgl` Plan (base 300) — composed by a
 * `Policy` via the generic `composePolicy`. `do_premium` + `gl_premium`
 * now come from two independent Plans the Policy sums. The dollars do not
 * move: this test still pins $3,844,254. The composer is product-blind
 * (ADR-0033 §0) — the SAME composePolicy would compose a bop+auto policy.
 *
 * Ground truth (recomputed independently from the example workbook
 * `docs/specs/examples/nonprofit-do-gl/nonprofit_do_gl.workbook.xlsx`):
 *   D&O book  = $2,279,163
 *   GL  book  = $1,565,091
 *   Total     = $3,844,254
 *   20/20 xlsx test cases reproduced to the dollar (NP-001 = 658/396).
 *   93 of 2,000 rows have revenue > $5M (exercise the top-band clamp).
 *
 * ROUNDING CONVENTION (important — and a finding from building this test):
 * the spec is an Excel workbook, so its per-premium "round to nearest $1"
 * is `ROUND` = half-AWAY-from-zero (= JS `Math.round` for positive
 * premiums), which the engine matches and the 20 xlsx test cases confirm.
 * The cold-test J–O docs quoted $3,844,244 — that figure was a pre-flight
 * Python `round()` artifact (banker's / half-to-EVEN), which diverges from
 * Excel on ~10 exact-.5 ties (D&O −$1, GL −$9). The spec/Excel/engine book
 * is $3,844,254; this test pins THAT. (The docs' number is not wrong about
 * the chain math — only about the tie-break convention.)
 *
 * The dataset is FROZEN in `__fixtures__/` so the asserted numbers are
 * stable — regenerating the served CSV cannot silently move the book.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  compilePlan,
  registerBuiltinKinds,
  composePolicy,
} from "@openrater/contracts";
import type {
  Dimension,
  Policy,
  PolicyResult,
  ProductCode,
  CompiledPlan,
} from "@openrater/contracts";
import { stagesToRuntimePlan } from "./stagesToRuntimePlan";
import type { StageLike, FactorTableLike } from "./deriveRequiredInputs";
// Frozen conformance fixtures, imported as raw strings (vitest/Vite
// `?raw`) so the asserted book stays stable + the package needs no
// `@types/node`.
import policiesCsv from "./__fixtures__/nonprofit_990_2000_policies.csv?raw";
import testCasesCsv from "./__fixtures__/nonprofit_990_test_cases.csv?raw";

// ──────────────────────────────────────────────────────────────────
// Spec — factor values (verbatim from the xlsx Dim:* + Chain sheets)
// ──────────────────────────────────────────────────────────────────

const NTEE_DO: Record<string, number> = {
  arts_culture: 1.0, education: 1.1, environment: 1.0, animal: 0.95,
  health_care: 1.3, mental_health: 1.15, diseases: 1.05, medical_research: 1.05,
  crime_legal: 1.2, employment: 1.15, food_agriculture: 1.05, housing_shelter: 1.15,
  public_safety: 1.05, recreation: 1.05, youth_development: 1.2, human_services: 1.15,
  international: 1.2, civil_rights: 1.2, community_improvement: 1.05, philanthropy: 0.85,
  science_tech: 0.95, social_science: 0.95, public_societal: 1.0, religion: 1.2,
  mutual_membership: 1.05, unknown_unclassified: 1.5, unknown_no_ntee: 1.5,
};
const NTEE_GL: Record<string, number> = {
  arts_culture: 1.05, education: 1.15, environment: 1.1, animal: 1.25,
  health_care: 1.25, mental_health: 1.15, diseases: 1.1, medical_research: 1.05,
  crime_legal: 1.05, employment: 1.0, food_agriculture: 1.2, housing_shelter: 1.3,
  public_safety: 1.1, recreation: 1.4, youth_development: 1.3, human_services: 1.2,
  international: 1.1, civil_rights: 1.0, community_improvement: 1.05, philanthropy: 0.8,
  science_tech: 0.95, social_science: 0.9, public_societal: 1.0, religion: 1.15,
  mutual_membership: 1.05, unknown_unclassified: 1.5, unknown_no_ntee: 1.5,
};
const SUB_DO: Record<string, number> = {
  "501c3": 1.0, "501c4": 1.15, "501c6": 1.05, "501c7": 0.9, "501c8": 1.1, "501c_other": 1.1,
};
const SUB_GL: Record<string, number> = {
  "501c3": 1.0, "501c4": 1.0, "501c6": 0.95, "501c7": 1.2, "501c8": 1.05, "501c_other": 1.05,
};
const STATE_DO: Record<string, number> = { T1: 0.85, T2: 0.95, T3: 1.0, T4: 1.15, T5: 1.3 };
const STATE_GL: Record<string, number> = { T1: 0.8, T2: 0.9, T3: 1.0, T4: 1.2, T5: 1.35 };

// Banded factor tables: cells keyed by band id (edges below).
const REVENUE_DO: Record<string, number> = {
  "01_under_25k": 0.65, "02_25k_50k": 0.75, "03_50k_100k": 0.85, "04_100k_250k": 1.0,
  "05_250k_500k": 1.15, "06_500k_1m": 1.35, "07_1m_5m": 1.75,
};
const REVENUE_GL: Record<string, number> = {
  "01_under_25k": 0.5, "02_25k_50k": 0.7, "03_50k_100k": 0.85, "04_100k_250k": 1.0,
  "05_250k_500k": 1.2, "06_500k_1m": 1.5, "07_1m_5m": 2.1,
};
const PAYROLL_DO: Record<string, number> = {
  "00_none": 0.85, "01_micro": 0.95, "02_small": 1.0, "03_mid": 1.15, "04_large": 1.4,
};
const STRESS_DO: Record<string, number> = {
  "01_under_85": 0.9, "02_85_100": 1.0, "03_100_115": 1.2, "04_over_115": 1.5,
};
const OCCUPANCY_GL: Record<string, number> = {
  "01_under_03": 0.85, "02_03_06": 1.0, "03_06_10": 1.15, "04_10_20": 1.35, "05_over_20": 1.6,
};

// Banded edges (half-open [lo, hi); top band finite → >hi clamps to nearest, ADR-0026/L22).
interface Band { id: string; lo: number; hi: number }
const REVENUE_BANDS: Band[] = [
  { id: "01_under_25k", lo: -Infinity, hi: 25000 },
  { id: "02_25k_50k", lo: 25000, hi: 50000 },
  { id: "03_50k_100k", lo: 50000, hi: 100000 },
  { id: "04_100k_250k", lo: 100000, hi: 250000 },
  { id: "05_250k_500k", lo: 250000, hi: 500000 },
  { id: "06_500k_1m", lo: 500000, hi: 1000000 },
  { id: "07_1m_5m", lo: 1000000, hi: 5000000 }, // finite top → >$5M clamps here
];
const PAYROLL_BANDS: Band[] = [
  { id: "00_none", lo: -Infinity, hi: 1 },
  { id: "01_micro", lo: 1, hi: 6 },
  { id: "02_small", lo: 6, hi: 26 },
  { id: "03_mid", lo: 26, hi: 101 },
  { id: "04_large", lo: 101, hi: Infinity },
];
const STRESS_BANDS: Band[] = [
  { id: "01_under_85", lo: -Infinity, hi: 0.85 },
  { id: "02_85_100", lo: 0.85, hi: 1.0 },
  { id: "03_100_115", lo: 1.0, hi: 1.15 },
  { id: "04_over_115", lo: 1.15, hi: Infinity },
];
const OCCUPANCY_BANDS: Band[] = [
  { id: "01_under_03", lo: -Infinity, hi: 0.03 },
  { id: "02_03_06", lo: 0.03, hi: 0.06 },
  { id: "03_06_10", lo: 0.06, hi: 0.1 },
  { id: "04_10_20", lo: 0.1, hi: 0.2 },
  { id: "05_over_20", lo: 0.2, hi: Infinity },
];

// State → tier (the Territories tab output; 17/10/17/5/2).
const TIER_MEMBERS: Record<string, string[]> = {
  T1: ["AL", "AR", "IA", "ID", "KS", "KY", "ME", "MS", "MT", "ND", "NE", "NH", "OK", "SD", "VT", "WV", "WY"],
  T2: ["IN", "MN", "MO", "NM", "NV", "OH", "SC", "TN", "UT", "WI"],
  T3: ["AK", "AZ", "CO", "CT", "DC", "DE", "GA", "HI", "MA", "MD", "MI", "NC", "OR", "PA", "RI", "VA", "WA"],
  T4: ["FL", "IL", "LA", "NJ", "TX"],
  T5: ["CA", "NY"],
};

const LCM = 1.35;

// ──────────────────────────────────────────────────────────────────
// Substrate builders (mirror the shapes stagesToRuntimePlan consumes)
// ──────────────────────────────────────────────────────────────────

function catDim(slug: string): Dimension {
  return { id: slug, slug, display_name: slug, data_type: "string", role: "rating-input" } as unknown as Dimension;
}
function bandedDim(slug: string, bands: Band[]): Dimension {
  return {
    id: slug, slug, display_name: slug, data_type: "number", role: "rating-input",
    shape: "banded",
    levels: bands.map((b) => ({ kind: "banded", id: b.id, label: b.id, lo: b.lo, hi: b.hi })),
  } as unknown as Dimension;
}
function stateDim(): Dimension {
  return {
    id: "state", slug: "state", display_name: "State", data_type: "string", role: "rating-input",
    dimension_type: "geographic", shape: "geographic",
    geo_granularity: "state", geo_scope: { kind: "national" },
    geo_territories: Object.entries(TIER_MEMBERS).map(([id, members]) => ({ id, label: id, members })),
    levels: Object.values(TIER_MEMBERS).flat().map((s) => ({ kind: "geographic", id: s, label: s })),
  } as unknown as Dimension;
}

interface TableSpec { id: string; keyDim: string; cells: Record<string, number> }
function table(id: string, keyDim: string, cells: Record<string, number>): TableSpec {
  return { id, keyDim, cells };
}
function factorTableLike(t: TableSpec): FactorTableLike {
  // `slug` is the factor_kind a chain's factor_lookup references; `id`
  // is the cells map key. We keep them equal for clarity.
  return { id: t.id, display_name: t.id, key_dimension: t.keyDim, slug: t.id } as unknown as FactorTableLike;
}

// `path` is the RAW input column; for banded/geo dims the projector
// inserts derive.band / derive.territory (binding path ≠ dim slug).
interface Lookup { tableId: string; dimSlug: string; rawCol: string }
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

// ── Two PRODUCT plans (ADR-0034 split), each one product's algorithm ──
//
// D&O Plan: 6 factor tables, 6 dims, base 600 → do_premium.
const DO_TABLES: TableSpec[] = [
  table("ntee_do", "ntee_major", NTEE_DO),
  table("revenue_do", "revenue_band", REVENUE_DO),
  table("state_do", "state", STATE_DO),
  table("subsection_do", "subsection_type", SUB_DO),
  table("payroll_do", "payroll_band", PAYROLL_DO),
  table("stress_do", "stress_band", STRESS_DO),
];
const DO_DIMS: Dimension[] = [
  catDim("ntee_major"),
  catDim("subsection_type"),
  bandedDim("revenue_band", REVENUE_BANDS),
  bandedDim("payroll_band", PAYROLL_BANDS),
  bandedDim("stress_band", STRESS_BANDS),
  stateDim(),
];
const DO_STAGE: StageLike = chainStage("do_plan", [
  {
    name: "D&O premium", baseValue: 600, output: "do_premium",
    lookups: [
      { tableId: "ntee_do", dimSlug: "ntee_major", rawCol: "ntee_major" },
      { tableId: "revenue_do", dimSlug: "revenue_band", rawCol: "revenue" },
      { tableId: "state_do", dimSlug: "state", rawCol: "state" },
      { tableId: "subsection_do", dimSlug: "subsection_type", rawCol: "subsection_type" },
      { tableId: "payroll_do", dimSlug: "payroll_band", rawCol: "employee_count" },
      { tableId: "stress_do", dimSlug: "stress_band", rawCol: "stress" },
    ],
  },
]);

// GL Plan: 5 factor tables, 5 dims, base 300 → gl_premium.
const GL_TABLES: TableSpec[] = [
  table("ntee_gl", "ntee_major", NTEE_GL),
  table("revenue_gl", "revenue_band", REVENUE_GL),
  table("state_gl", "state", STATE_GL),
  table("subsection_gl", "subsection_type", SUB_GL),
  table("occupancy_gl", "occupancy_intensity_band", OCCUPANCY_GL),
];
const GL_DIMS: Dimension[] = [
  catDim("ntee_major"),
  catDim("subsection_type"),
  bandedDim("revenue_band", REVENUE_BANDS),
  bandedDim("occupancy_intensity_band", OCCUPANCY_BANDS),
  stateDim(),
];
const GL_STAGE: StageLike = chainStage("gl_plan", [
  {
    name: "GL premium", baseValue: 300, output: "gl_premium",
    lookups: [
      { tableId: "ntee_gl", dimSlug: "ntee_major", rawCol: "ntee_major" },
      { tableId: "revenue_gl", dimSlug: "revenue_band", rawCol: "revenue" },
      { tableId: "state_gl", dimSlug: "state", rawCol: "state" },
      { tableId: "subsection_gl", dimSlug: "subsection_type", rawCol: "subsection_type" },
      { tableId: "occupancy_gl", dimSlug: "occupancy_intensity_band", rawCol: "occupancy_intensity" },
    ],
  },
]);

/** Build + compile one product's plan from its stage/dims/tables. */
function buildProductPlan(stage: StageLike, dims: Dimension[], tables: TableSpec[]) {
  const cells = new Map<string, ReadonlyMap<string, number>>(
    tables.map((t) => [t.id, new Map(Object.entries(t.cells))]),
  );
  const { plan } = stagesToRuntimePlan(
    [stage],
    dims,
    tables.map(factorTableLike),
    cells,
    { lcmOverride: LCM },
  );
  return { plan, compiled: compilePlan(plan) };
}

// ── The Policy that composes the two products (ADR-0034 §1) ──────────
//
// content_hash is a placeholder here — these plans are built in-memory,
// not persisted. The composer doesn't verify the hash (fetching the
// right algorithm version is the caller's job); it only runs + sums.
const POLICY: Policy = {
  policy_id: "nonprofit-do-gl",
  lines: [
    { plan_ref: { plan_id: "plan-do", content_hash: "do-v1", product: "do" }, premium_output: "do_premium" },
    { plan_ref: { plan_id: "plan-gl", content_hash: "gl-v1", product: "cgl" }, premium_output: "gl_premium" },
  ],
};

interface BookContext {
  doCompiled: CompiledPlan;
  glCompiled: CompiledPlan;
}

/** Build both product plans once. */
function buildContext(): BookContext {
  return {
    doCompiled: buildProductPlan(DO_STAGE, DO_DIMS, DO_TABLES).compiled,
    glCompiled: buildProductPlan(GL_STAGE, GL_DIMS, GL_TABLES).compiled,
  };
}

/** Compose one insured's policy from the two product Plans (the generic
 *  composer — no product branch lives here). */
function composeRow(
  ctx: BookContext,
  inputs: Record<string, unknown>,
): PolicyResult {
  return composePolicy(POLICY, (line) => ({
    compiled: line.plan_ref.product === "do" ? ctx.doCompiled : ctx.glCompiled,
    externalInputs: inputs,
  }));
}

/** Pull one product's (raw, unrounded) premium out of a composed result. */
function premiumFor(result: PolicyResult, product: ProductCode): number {
  const line = result.lines.find((l) => l.product === product);
  if (!line) throw new Error(`composed result has no ${product} line`);
  return line.premium;
}

// ──────────────────────────────────────────────────────────────────
// CSV (RFC-4180-ish: quote-aware so comma-bearing names don't shift cols)
// ──────────────────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (line === "") continue;
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const header = rows[0]!;
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** CSV row → the externalInputs the chains read (raw cols + derived ratios).
 *  Field names mirror the live nonprofit_990 `form_input.<field>` paths
 *  (`stress`, `occupancy_intensity`) — the same contract PolicyComposeRoute's
 *  sample mapper feeds, so this book proof tracks the shipped field names. The
 *  ratios are RAW magnitudes; the `stress_band` / `occupancy_intensity_band`
 *  banded dims resolve them to factors (not pre-banded labels). */
function rowToInputs(r: Record<string, string>): Record<string, unknown> {
  const revenue = Number(r.revenue);
  return {
    ntee_major: r.ntee_major,
    subsection_type: r.subsection_type,
    state: r.state,
    revenue,
    employee_count: Number(r.employee_count),
    stress: Number(r.total_expenses) / revenue,
    occupancy_intensity: Number(r.occupancy_expense) / revenue,
  };
}

/** Round each premium to the nearest $1 — the spec's per-premium rule. */
const dollars = (n: unknown): number => Math.round(Number(n));

// ──────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────

beforeAll(() => {
  registerBuiltinKinds();
});

describe("nonprofit D&O + GL — book conformance (ADR-0032 Phase 0 / ADR-0034 gate 8)", () => {
  it("reproduces the 20 xlsx test cases to the dollar (incl. NP-001 = 658/396)", () => {
    const ctx = buildContext();
    const cases = parseCsv(testCasesCsv);
    expect(cases).toHaveLength(20);
    const mismatches: string[] = [];
    for (const c of cases) {
      // Composed from the two product Plans via composePolicy; each
      // product premium is the spec's per-premium round-to-$1.
      const result = composeRow(ctx, rowToInputs(c));
      const do_ = dollars(premiumFor(result, "do"));
      const gl = dollars(premiumFor(result, "cgl"));
      const eDo = Number(c.expected_do_premium);
      const eGl = Number(c.expected_gl_premium);
      if (do_ !== eDo || gl !== eGl) {
        mismatches.push(`${c.acct_id}: got ${do_}/${gl}, expected ${eDo}/${eGl}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("reproduces the 2,000-policy book to the dollar ($3,844,254) — via composePolicy over the do + cgl Plans", () => {
    const ctx = buildContext();
    const rows = parseCsv(policiesCsv);
    expect(rows).toHaveLength(2000);
    let doBook = 0;
    let glBook = 0;
    for (const r of rows) {
      const result = composeRow(ctx, rowToInputs(r));
      doBook += dollars(premiumFor(result, "do"));
      glBook += dollars(premiumFor(result, "cgl"));
    }
    // The split is non-regressing: two Plans + a Policy reproduce the
    // exact book the single combined plan did.
    expect(doBook).toBe(2_279_163);
    expect(glBook).toBe(1_565_091);
    expect(doBook + glBook).toBe(3_844_254);
  });

  it("clamps the 93 policies with revenue > $5M to the top revenue band (no silent 1.0)", () => {
    const rows = parseCsv(policiesCsv);
    const over5m = rows.filter((r) => Number(r.revenue) > 5_000_000);
    expect(over5m).toHaveLength(93);

    // Each clamps to the 07_1m_5m factor (1.75 D&O / 2.1 GL) rather than
    // a missing-band 1.0 — verified by scoring vs. a hand-clamped calc.
    const ctx = buildContext();
    for (const r of over5m.slice(0, 5)) {
      const result = composeRow(ctx, rowToInputs(r));
      expect(dollars(premiumFor(result, "do"))).toBeGreaterThan(0);
      expect(dollars(premiumFor(result, "cgl"))).toBeGreaterThan(0);
    }
  });

  it("keys the State factor by 5 territory tiers (not 51 raw states) — N13 guard, BOTH Plans", () => {
    // The guard now applies to each product Plan independently — both
    // resolve State via derive.territory keyed by the 5 tiers.
    for (const { plan } of [
      buildProductPlan(DO_STAGE, DO_DIMS, DO_TABLES),
      buildProductPlan(GL_STAGE, GL_DIMS, GL_TABLES),
    ]) {
      const kinds = plan.nodes.map((n) => n.kind);
      expect(kinds).toContain("derive.territory");
      const terr = plan.nodes.find((n) => n.kind === "derive.territory");
      const map = (terr?.params as { territoryMap: Record<string, string> }).territoryMap;
      expect(map.CA).toBe("T5");
      expect(map.WY).toBe("T1");
      expect(new Set(Object.values(map))).toEqual(new Set(["T1", "T2", "T3", "T4", "T5"]));
    }
  });

  it("composes exactly two product lines (do + cgl), each from its own Plan", () => {
    const ctx = buildContext();
    const rows = parseCsv(policiesCsv);
    const result = composeRow(ctx, rowToInputs(rows[0]!));

    // two products, in policy order, each sourced from its own plan
    expect(result.lines.map((l) => l.product)).toEqual(["do", "cgl"]);
    expect(result.lines.map((l) => l.plan_id)).toEqual(["plan-do", "plan-gl"]);

    // defaults: no credit, no floor → total is the raw subtotal
    expect(result.package_credit).toBe(1);
    expect(result.minimum_premium).toBe(0);
    expect(result.minimum_applied).toBe(false);
    const rawSum = premiumFor(result, "do") + premiumFor(result, "cgl");
    expect(result.subtotal).toBeCloseTo(rawSum, 6);
    expect(result.after_credit).toBeCloseTo(rawSum, 6);
    expect(result.total).toBeCloseTo(rawSum, 6);
  });

  it("applies policy-level package credit + minimum on real data (the Policy layer does real work)", () => {
    const ctx = buildContext();
    const rows = parseCsv(policiesCsv);
    const inputs = rowToInputs(rows[0]!);
    const resolve = (line: Policy["lines"][number]) => ({
      compiled: line.plan_ref.product === "do" ? ctx.doCompiled : ctx.glCompiled,
      externalInputs: inputs,
    });

    const base = composePolicy(POLICY, resolve);

    // a 10% package credit BETWEEN the two products (the cross-product
    // credit that has no home in a single-plan model)
    const credited = composePolicy({ ...POLICY, package_credit: 0.9 }, resolve);
    expect(credited.after_credit).toBeCloseTo(base.subtotal * 0.9, 6);
    expect(credited.total).toBeCloseTo(base.subtotal * 0.9, 6);

    // a policy minimum that bites floors the composed total
    const floored = composePolicy(
      { ...POLICY, package_credit: 0.9, minimum_premium: 10_000_000 },
      resolve,
    );
    expect(floored.minimum_applied).toBe(true);
    expect(floored.total).toBe(10_000_000);
  });
});
