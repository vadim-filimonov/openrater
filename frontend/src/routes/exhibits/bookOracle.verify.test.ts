/**
 * Exhibits book — the ORACLE pin (Brief: portfolio-redesign v2 §5.4, P3).
 *
 * The exhibit's book mode must reproduce the demo book's committed
 * `expected_tier` / `expected_total` columns EXACTLY — the same oracle
 * `meridianSeedFixture.verify.test.ts` pins for the score/quote seams.
 * This test drives the PAGE's own path end to end: parseBook →
 * toSubmissions (the projection seam) → rateBookSide over a live-shaped
 * body composed from the fixture — no harness math.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { registerBuiltinKinds } from "@openrater/contracts";
import type {
  PlanDimension,
  PlanFactorTable,
  StageSummary,
} from "@openrater/api-client";
import {
  rateBookSide,
  type RerateSnapshotBody,
} from "../../integrations/runBookRerate";
import { parseBook, policyPremium, portraitStats, toSubmissions } from "./book";

const FIXTURE_PATH = fileURLToPath(
  new URL(
    "../../../../docs/fixtures/meridian-shopfront-bop-ne-2026.plan.json",
    import.meta.url,
  ),
);
const BOOK_PATH = fileURLToPath(
  new URL("../../../../docs/fixtures/meridian-demo-book.csv", import.meta.url),
);

interface FixtureTable {
  readonly rows: readonly Record<string, unknown>[];
}
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  tables: Record<string, FixtureTable>;
};

function J(raw: unknown): unknown {
  if (typeof raw !== "string" || raw === "") return raw ?? undefined;
  try {
    // The fixture is written by Python's lenient json (bands' open ends
    // serialize as bare Infinity). The WIRE encodes open ends as null
    // (contracts finding E5) — normalize to exactly that before parsing.
    return JSON.parse(raw.replace(/:(\s*)-?Infinity/g, ":$1null"));
  } catch {
    return undefined;
  }
}

/** Fixture DB rows → the WIRE shapes a frozen snapshot body carries. */
function wireBody(): RerateSnapshotBody {
  const dimensions = FIXTURE.tables["plan_dimensions"]!.rows.map(
    (r) =>
      ({
        rating_plan_id: r["rating_plan_id"],
        dim_id: r["dim_id"],
        display_name: r["display_name"],
        slug: r["slug"],
        data_type: r["data_type"],
        role: r["role"],
        dimension_type: r["dimension_type"] ?? undefined,
        shape: r["shape"] ?? undefined,
        levels: J(r["levels_json"]) ?? [],
        axes: J(r["axes_json"]) ?? undefined,
        source_field: r["source_field"] ?? undefined,
        geo_granularity: r["geo_granularity"] ?? undefined,
        geo_territories: J(r["geo_territories_json"]) ?? undefined,
        created_at: r["created_at"],
        updated_at: r["updated_at"],
      }) as unknown as PlanDimension,
  );
  const cellsByTable = new Map<string, Record<string, number>>();
  for (const c of FIXTURE.tables["plan_factor_table_cells"]!.rows) {
    const tid = String(c["table_id"]);
    const bucket = cellsByTable.get(tid) ?? {};
    bucket[String(c["cell_key"])] = Number(c["value"]);
    cellsByTable.set(tid, bucket);
  }
  const factor_tables = FIXTURE.tables["plan_factor_tables"]!.rows.map(
    (r) =>
      ({
        rating_plan_id: r["rating_plan_id"],
        table_id: r["table_id"],
        display_name: r["display_name"],
        slug: r["slug"],
        key_dimensions: (J(r["key_dimensions_json"]) ?? []) as string[],
        cells: cellsByTable.get(String(r["table_id"])) ?? {},
        interpolation: J(r["interpolation_json"]) ?? undefined,
        created_at: r["created_at"],
        updated_at: r["updated_at"],
      }) as unknown as PlanFactorTable,
  );
  const stages = FIXTURE.tables["rating_plan_stages"]!.rows
    .slice()
    .sort((a, b) => Number(a["sequence"]) - Number(b["sequence"]))
    .map(
      (r) =>
        ({
          stage_id: String(r["stage_id"]),
          stage_kind: String(r["stage_kind"]),
          sequence: Number(r["sequence"]),
          display_name: r["display_name"],
          config_json: J(r["config_json"]) ?? {},
        }) as unknown as StageSummary,
    );
  return {
    stages,
    dimensions,
    factor_tables,
    input_mapping: null,
    policy_tail: null,
  } as unknown as RerateSnapshotBody;
}

describe("the exhibit's book mode reproduces the committed oracle, exactly", () => {
  beforeAll(() => registerBuiltinKinds());

  it("every expected_total and expected_tier, row for row", () => {
    const parsed = parseBook(
      "meridian-demo-book.csv",
      readFileSync(BOOK_PATH, "utf8"),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const body = wireBody();
    const submissions = toSubmissions(
      parsed.book,
      (body.stages ?? []) as readonly StageSummary[],
    );
    const run = rateBookSide(body, submissions, undefined, undefined);
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const byId = new Map(run.results.map((r) => [r.policy_id, r]));
    const misses: string[] = [];
    for (const row of parsed.book.rows) {
      const key = row["case_id"] ?? "";
      const result = byId.get(key);
      const premium =
        result === undefined ? null : policyPremium(result, run.premiumField);
      const expectedTotal = Number(row["expected_total"]);
      const tier = result?.appetite.tier ?? "(missing)";
      if (premium === null || Math.round(premium) !== expectedTotal) {
        misses.push(
          `${key}: premium ${premium === null ? "null" : Math.round(premium)} ≠ ${expectedTotal}`,
        );
      }
      if (tier !== row["expected_tier"]) {
        misses.push(`${key}: tier ${tier} ≠ ${row["expected_tier"] ?? "?"}`);
      }
    }
    expect(misses, misses.join("\n")).toEqual([]);

    const stats = portraitStats(run.results, run.premiumField);
    const oracleTotal = parsed.book.rows.reduce(
      (sum, row) => sum + Number(row["expected_total"]),
      0,
    );
    expect(Math.round(stats.total)).toBe(oracleTotal);
    expect(stats.rated).toBe(20);
  });
});
