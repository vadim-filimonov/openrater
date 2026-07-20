/**
 * SEED-FIXTURE ORACLE GATE — the committed Meridian plan
 * (`docs/fixtures/meridian-shopfront-bop-ne-2026.plan.json`, the blob the
 * deploy seed pre-loads and `scripts/plan_fixture.py load` restores) must
 * reproduce the reference filing's expected premiums when run through the
 * exact production path the Run zone uses:
 *
 *   fixture rows (DB shape, snake_case + *_json)
 *     → API shapes → planDimensionToRow / planFactorTableToRow
 *     → stagesToRuntimePlan            (three coverage towers + sidecars)
 *     → projectRowsToExternalInputs    (identity column map — the demo book's
 *     → runPlan                         headers ARE the declared inputs)
 *     → keyedRowsFromBook → policyBookConfigFromPlan
 *       + appendPlanFloor(planMinimumPremium)   (the $500 package floor
 *     → evaluatePolicyBook                       composes once per policy)
 *
 * with NO harness math — every factor, the LCM, the interpolated building
 * curve, the endorsement, the loading, the liability clamp, and the
 * appetite gates come from the COMMITTED FIXTURE plus the committed
 * 20-row demo book (`docs/fixtures/meridian-demo-book.csv`).
 *
 * The plan is the ingester's own output for the reference filing
 * (`docs/specs/examples/meridian-shopfront-bop/` — fictional carrier,
 * invented factors, REAL rule/page citations into the filing PDF). The
 * demo book's `expected_tier` / `expected_total` columns are computed by
 * the same engine-mirrored `price()` that self-verifies the workbook, so
 * the filing, the workbook, the fixture, and this gate share one source
 * of truth. mv_01 ($1,898) is additionally pinned as a literal so a
 * coordinated regeneration drift still has one absolute anchor.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import {
  registerBuiltinKinds,
  compilePlan,
  runPlan,
  evaluatePolicyBook,
  type Plan,
  type Dimension,
  type PolicyBookResult,
} from "@openrater/contracts";
import {
  stagesToRuntimePlan,
  projectRowsToExternalInputs,
  resolvePremiumColumn,
  planMinimumPremium,
  appendPlanFloor,
  type FactorTableCellsMap,
} from "@openrater/ui";
import type { PlanDimension, PlanFactorTable, StageSummary } from "@openrater/api-client";
import { planDimensionToRow } from "./dimensionsSync";
import { planFactorTableToRow } from "./factorTablesSync";
import {
  policyBookConfigFromPlan,
  keyedRowsFromBook,
  type AuthoredGrouping,
} from "./policyBookConfig";

// ── Load the committed fixture (what the deploy seed restores) ────────────────
const FIXTURE_PATH = fileURLToPath(
  new URL(
    "../../../docs/fixtures/meridian-shopfront-bop-ne-2026.plan.json",
    import.meta.url,
  ),
);
const BOOK_PATH = fileURLToPath(
  new URL("../../../docs/fixtures/meridian-demo-book.csv", import.meta.url),
);

interface DbTable {
  readonly columns: string[];
  readonly rows: Array<Record<string, unknown>>;
}
interface Fixture {
  readonly plan_id: string;
  readonly tables: Record<string, DbTable>;
}
const FIXTURE: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

// The DB→API seam: the server's stored JSON is Python-flavored (an
// open-ended band's `hi` is a bare `Infinity` token, which Python's
// json accepts); pydantic serializes it as `null` on the wire, and the
// frontend adapters receive that. Mirror the same mapping here.
const J = (v: unknown): unknown =>
  typeof v === "string" && v !== ""
    ? JSON.parse(v.replace(/-?\bInfinity\b/g, "null"))
    : v;

// ── The committed 20-row demo book (RFC-4180-ish; names carry commas) ─────────
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0]!;
  return rows
    .slice(1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}
const BOOK: Array<Record<string, string>> = parseCsv(
  readFileSync(BOOK_PATH, "utf8"),
);

// ── DB rows → API shapes → production adapters ────────────────────────────────
function dbDimensions(): Dimension[] {
  return FIXTURE.tables.plan_dimensions!.rows.map((r) => {
    const pd = {
      rating_plan_id: r.rating_plan_id,
      dim_id: r.dim_id,
      display_name: r.display_name,
      slug: r.slug,
      data_type: r.data_type,
      role: r.role,
      dimension_type: r.dimension_type ?? undefined,
      shape: r.shape ?? undefined,
      levels: J(r.levels_json) ?? [],
      axes: J(r.axes_json) ?? undefined,
      source_field: r.source_field ?? undefined,
      geo_granularity: r.geo_granularity ?? undefined,
      geo_territories: J(r.geo_territories_json) ?? undefined,
      derived_from: J(r.derived_from_json) ?? undefined,
      class_library_id: r.class_library_id ?? undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
    } as unknown as PlanDimension;
    return planDimensionToRow(pd) as unknown as Dimension;
  });
}

function dbFactorTables(): {
  fts: Parameters<typeof stagesToRuntimePlan>[2];
  cells: FactorTableCellsMap;
} {
  const cellsByTable = new Map<string, Map<string, number>>();
  for (const c of FIXTURE.tables.plan_factor_table_cells!.rows) {
    const tid = String(c.table_id);
    if (!cellsByTable.has(tid)) cellsByTable.set(tid, new Map());
    cellsByTable.get(tid)!.set(String(c.cell_key), Number(c.value));
  }
  const cells: FactorTableCellsMap = new Map(
    [...cellsByTable.entries()].map(([tid, m]) => [
      tid,
      m as ReadonlyMap<string, number>,
    ]),
  );
  const fts = FIXTURE.tables.plan_factor_tables!.rows.map((r) => {
    const pf = {
      rating_plan_id: r.rating_plan_id,
      table_id: r.table_id,
      display_name: r.display_name,
      slug: r.slug,
      key_dimensions: (J(r.key_dimensions_json) ?? []) as string[],
      cells: Object.fromEntries(
        cellsByTable.get(String(r.table_id)) ?? new Map(),
      ),
      // The stored linear-interpolation flag (the filing's Rule C.3
      // building-limit curve — registry r9).
      interpolation: J(r.interpolation_json) ?? undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
    } as unknown as PlanFactorTable;
    return planFactorTableToRow(pf);
  }) as unknown as Parameters<typeof stagesToRuntimePlan>[2];
  return { fts, cells };
}

function dbStages(): Parameters<typeof stagesToRuntimePlan>[0] {
  return FIXTURE.tables.rating_plan_stages!.rows
    .slice()
    .sort((a, b) => Number(a.sequence) - Number(b.sequence))
    .map((r) => ({
      stage_id: String(r.stage_id),
      stage_kind: String(r.stage_kind),
      sequence: Number(r.sequence),
      display_name: r.display_name as string | undefined,
      config_json: J(r.config_json),
    })) as unknown as Parameters<typeof stagesToRuntimePlan>[0];
}

// The workbook-built plan authors no input mappings (those come from the
// Run zone's live mapper) — the demo book's headers ARE the declared
// inputs, so the column map is the identity over the input dictionary,
// with dtypes from each input_node's declared data_type.
function identityMapAndDtypes(): {
  columnMap: Record<string, string>;
  inputDtypes: Record<string, "number" | "boolean" | "date" | "string">;
} {
  const columnMap: Record<string, string> = {};
  const inputDtypes: Record<string, "number" | "boolean" | "date" | "string"> =
    {};
  for (const r of FIXTURE.tables.rating_plan_stages!.rows) {
    if (r.stage_kind !== "input_node") continue;
    const cfg = (J(r.config_json) ?? {}) as Record<string, unknown>;
    if (cfg.source === "derived") continue;
    const field = String(cfg.name ?? cfg.source_path ?? r.stage_id);
    columnMap[field] = field;
    const dt = String(cfg.data_type ?? "string");
    inputDtypes[field] =
      dt === "money" || dt === "int" || dt === "number" || dt === "float"
        ? "number"
        : dt === "bool" || dt === "boolean"
          ? "boolean"
          : dt === "date"
            ? "date"
            : "string";
  }
  return { columnMap, inputDtypes };
}

function buildPlan(): Plan {
  const { fts, cells } = dbFactorTables();
  return stagesToRuntimePlan(dbStages(), dbDimensions(), fts, cells, {
    planId: `-runtime`,
  }).plan as unknown as Plan;
}

// ── Per-row scoring (the /quote seam's math) ──────────────────────────────────
function score(row: Record<string, string>): Record<string, number> {
  const plan = buildPlan();
  const { columnMap, inputDtypes } = identityMapAndDtypes();
  const [inputs] = projectRowsToExternalInputs([row], columnMap, {
    inputDtypes,
  });
  const res = runPlan(compilePlan(plan), inputs!);
  return res.outputs as Record<string, number>;
}

// ── Policy composition (the Run zone's book path: rollup → floor) ─────────────
function rollupBook(
  book: Array<Record<string, string>>,
): Record<string, PolicyBookResult> {
  const { columnMap, inputDtypes } = identityMapAndDtypes();
  const projected = projectRowsToExternalInputs(book, columnMap, {
    inputDtypes,
  });
  const grouping: AuthoredGrouping = { policy_id_column: "case_id" };
  const keyed = keyedRowsFromBook(projected, book, grouping);
  const stages = dbStages() as unknown as StageSummary[];
  // The plan's $500 floor composes ONCE per policy — the scoring service
  // lifts it from the round stage's `literal:` binding via appendPlanFloor.
  const composedTail = appendPlanFloor(
    [],
    planMinimumPremium(
      stages as unknown as Parameters<typeof planMinimumPremium>[0],
    ),
  );
  // Mirror the scoring service's compose seam (score.ts): the premium
  // field aggregates via an explicit sum roll-up, and the tail reads it.
  const config = {
    ...policyBookConfigFromPlan(stages, []),
    rollupFields: [{ field: "total_premium", reducer: "sum" as const }],
    policyTail: composedTail,
    premiumRollupField: "total_premium",
  };
  const results = evaluatePolicyBook(compilePlan(buildPlan()), keyed, config, {});
  return Object.fromEntries(results.map((r) => [r.policy_id, r]));
}

// The one absolute anchor: the filing's first worked example. Everything
// else derives from the committed book's expected_* columns; this literal
// catches a coordinated regeneration that drifts book + fixture together.
const MV_01_PINNED_TOTAL = 1898;

describe("Meridian seed FIXTURE scores the reference filing's 20-row demo book (production path, no harness math)", () => {
  beforeAll(() => registerBuiltinKinds());

  it("fixture shape: 3 coverage towers + gates + IRPM schedule + interpolated curve + build-report provenance", () => {
    const chainStage = FIXTURE.tables.rating_plan_stages!.rows.find(
      (r) => r.stage_kind === "multiplicative_chain",
    )!;
    const cfg = J(chainStage.config_json) as {
      chains: Array<{ coverage_value?: string }>;
    };
    expect(cfg.chains.map((c) => c.coverage_value)).toEqual([
      "building",
      "bpp",
      "liability",
    ]);
    const kinds = new Set(
      FIXTURE.tables.rating_plan_stages!.rows.map((r) => String(r.stage_kind)),
    );
    for (const k of [
      "eligibility.gate",
      "modifier.schedule",
      "endorsement.factor",
      "clamp",
      "round",
    ]) {
      expect(kinds, `missing stage kind ${k}`).toContain(k);
    }
    // The building-limit curve ships its linear-interpolation flag.
    const interpolated = FIXTURE.tables.plan_factor_tables!.rows.filter(
      (r) => {
        const flag = J(r.interpolation_json) as { mode?: string } | null;
        return flag?.mode === "linear";
      },
    );
    expect(interpolated.map((r) => r.table_id)).toEqual(["building_ilf"]);
    expect(BOOK).toHaveLength(20);
  });

  it("build-report provenance rides in the fixture: vectors ran 40/40, two honest gaps, workbook bytes attached", () => {
    const reportRow = FIXTURE.tables.plan_build_reports!.rows[0]!;
    const vectors = J(reportRow.vectors_json) as {
      status?: string;
      matched?: number;
      total_cases?: number;
    };
    expect(vectors.status).toBe("ran");
    expect(vectors.total_cases).toBe(8);
    expect(vectors.matched).toBe(40);
    expect(J(reportRow.gaps_json)).toHaveLength(2);
    // The workbook itself travels with the plan (re-ingest diffs need it).
    expect(reportRow.workbook_blob).toBeTruthy();
  });

  it("resolvePremiumColumn picks the aggregate total_premium", () => {
    expect(resolvePremiumColumn(buildPlan())).toBe("total_premium");
  });

  it(`mv_01 absolute pin: the filing's worked example G.1 rates $${MV_01_PINNED_TOTAL}`, () => {
    const row = BOOK.find((r) => r.case_id === "mv_01")!;
    expect(Number(row.expected_total)).toBe(MV_01_PINNED_TOTAL);
    const out = score(row);
    expect(Math.round(out.total_premium ?? Number.NaN)).toBe(
      MV_01_PINNED_TOTAL,
    );
  });

  describe("per-row oracle (the /quote seam): every committed expected_total, exactly", () => {
    for (const row of BOOK) {
      const cid = row.case_id!;
      const expected = Number(row.expected_total);
      it(`${cid} → $${expected.toLocaleString("en-US")} (${row.name})`, () => {
        const out = score(row);
        expect(Math.round(out.total_premium ?? Number.NaN)).toBe(expected);
      });
    }
  });

  describe("composed book (the Run zone path): per-policy final + appetite tier", () => {
    let cache: Record<string, PolicyBookResult> | null = null;
    const composed = () => (cache ??= rollupBook(BOOK));

    for (const row of BOOK) {
      const cid = row.case_id!;
      const expTier = row.expected_tier!.trim();
      const expected = Number(row.expected_total);
      it(`${cid} → ${expTier} $${expected.toLocaleString("en-US")}`, () => {
        const p = composed()[cid]!;
        expect(p.appetite.tier).toBe(expTier);
        expect(Math.round(p.composed?.final ?? Number.NaN)).toBe(expected);
      });
    }

    it("mv_04 floors to exactly $500 (the package minimum, once per policy)", () => {
      const row = BOOK.find((r) => r.case_id === "mv_04")!;
      expect(Number(row.expected_total)).toBe(500);
      expect(composed().mv_04!.composed?.final).toBe(500);
    });

    it("bk_13 interpolates the mid-band building limit (registry r9 linear curve)", () => {
      // $333,000 sits strictly between band lower bounds; a stepped
      // engine would rate the band factor instead. The committed
      // expected_total is computed from the interpolated factor, so
      // equality here proves interpolation ran.
      const p = composed().bk_13!;
      expect(Math.round(p.composed?.final ?? Number.NaN)).toBe(
        Number(BOOK.find((r) => r.case_id === "bk_13")!.expected_total),
      );
    });
  });
});
