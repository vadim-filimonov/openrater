/**
 * Exhibits book — derivation tests (Brief: portfolio-redesign v2 §5.4, P3).
 */

import { describe, expect, it } from "vitest";
import type { PolicyBookResult } from "@openrater/contracts";
import type { PlanDimension, PlanFactorTable } from "@openrater/api-client";
import {
  BOOK_ROW_CAP,
  dimFieldBindings,
  impactStats,
  moverDriver,
  parseBook,
  policyPremium,
  portraitStats,
  toSubmissions,
  type DriverPair,
} from "./book";

function result(
  id: string,
  premium: number | null,
  extra: Partial<{
    tier: string;
    rowErrors: number;
  }> = {},
): PolicyBookResult {
  return {
    policy_id: id,
    rollup: {
      policy_id: id,
      rolled: premium !== null ? { total_premium: premium } : {},
    },
    appetite: {
      tier: (extra.tier ?? "standard") as PolicyBookResult["appetite"]["tier"],
      deciding: null,
      verdicts: [],
    },
    ...(extra.rowErrors !== undefined ? { row_errors: extra.rowErrors } : {}),
  } as unknown as PolicyBookResult;
}

const NOW = "2026-07-18T00:00:00Z";

function dim(partial: Partial<PlanDimension> & { dim_id: string }): PlanDimension {
  return {
    rating_plan_id: "plan",
    display_name: partial.dim_id,
    slug: partial.dim_id,
    data_type: "string",
    role: "rating-input",
    levels: [],
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  } as PlanDimension;
}

function table(
  partial: Partial<PlanFactorTable> & {
    table_id: string;
    cells: Record<string, number>;
  },
): PlanFactorTable {
  return {
    rating_plan_id: "plan",
    display_name: partial.table_id,
    slug: partial.table_id,
    key_dimensions: [],
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  } as PlanFactorTable;
}

describe("parseBook", () => {
  it("parses the Walk-4 recipe and finds the key column", () => {
    const parsed = parseBook(
      "book.csv",
      "case_id,zip,sprinklered\nmv_01,68102,true\nmv_02,68502,false\n",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.book.keyColumn).toBe("case_id");
    expect(parsed.book.rows).toHaveLength(2);
    expect(parsed.book.columns).toEqual(["case_id", "zip", "sprinklered"]);
  });
  it("refuses an over-cap book with the cap named", () => {
    const rows = Array.from({ length: BOOK_ROW_CAP + 1 }, (_, i) => `r${i},1`);
    const parsed = parseBook("big.csv", `id,x\n${rows.join("\n")}\n`);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("2,000");
    expect(parsed.error).toContain("big.csv");
  });
  it("refuses duplicate keys by name — the join must be unambiguous", () => {
    const parsed = parseBook(
      "book.csv",
      "case_id,zip\nmv_01,68102\nmv_01,68502\n",
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('duplicate case_id "mv_01"');
  });
  it("refuses a header-only file", () => {
    const parsed = parseBook("empty.csv", "case_id,zip\n");
    expect(parsed.ok).toBe(false);
  });
});

describe("toSubmissions", () => {
  it("keys rows by the key column, falling back to row index", () => {
    const parsed = parseBook("b.csv", "zip,limit\n68102,100\n68502,200\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const subs = toSubmissions(parsed.book);
    expect(subs.map((s) => s.submission_id)).toEqual(["row-1", "row-2"]);
    expect(subs[0]?.locations[0]?.inputs).toEqual({ zip: "68102", limit: "100" });
  });
});

describe("portraitStats", () => {
  it("totals the rated, names the refused, counts the tiers", () => {
    const stats = portraitStats(
      [
        result("a", 1898, { tier: "preferred" }),
        result("b", 6484),
        result("c", null, { rowErrors: 1 }),
        result("d", 500, { tier: "preferred" }),
      ],
      "total_premium",
    );
    expect(stats.count).toBe(4);
    expect(stats.rated).toBe(3);
    expect(stats.total).toBe(8882);
    expect(stats.min).toBe(500);
    expect(stats.max).toBe(6484);
    expect(stats.tiers).toEqual([
      ["preferred", 2],
      ["standard", 1],
    ]);
    expect(stats.refused).toEqual([
      { key: "c", reason: "1 location row cannot be rated" },
    ]);
  });
});

describe("impactStats", () => {
  it("joins on key, totals both sides, names movers via the caller's driver", () => {
    const a = [
      result("mv_01", 1000),
      result("mv_02", 2000),
      result("mv_03", 500),
    ];
    const b = [
      result("mv_01", 1100),
      result("mv_02", 1900),
      result("mv_03", null, { rowErrors: 2 }),
    ];
    const impact = impactStats(
      a,
      b,
      "total_premium",
      "total_premium",
      (key) => (key === "mv_01" ? "territory_prop t3 1.12→1.22" : null),
    );
    expect(impact.matched).toBe(2);
    expect(impact.aTotal).toBe(3000);
    expect(impact.bTotal).toBe(3000);
    expect(impact.deltaPct).toBeCloseTo(0, 5);
    expect(impact.up).toHaveLength(1);
    expect(impact.up[0]).toMatchObject({
      key: "mv_01",
      pct: expect.closeTo(10, 5) as number,
      driver: "territory_prop t3 1.12→1.22",
    });
    expect(impact.down[0]?.key).toBe("mv_02");
    expect(impact.refusedInB).toEqual([
      { key: "mv_03", premium: 500, reason: "2 location rows cannot be rated" },
    ]);
    expect(impact.refusedInA).toEqual([]);
  });
});

describe("moverDriver", () => {
  const territory = dim({
    dim_id: "territory",
    dimension_type: "geographic",
    source_field: "zip",
    geo_territories: [
      { id: "t3", label: "T3", members: ["68502"] },
      { id: "t5", label: "T5", members: ["68801"] },
    ],
    levels: [],
  });
  const sprinklered = dim({
    dim_id: "sprinklered_level",
    source_field: "sprinklered",
    levels: [
      { kind: "categorical", id: "true", label: "Yes", aliases: ["y"] },
      { kind: "categorical", id: "false", label: "No", aliases: ["n"] },
    ],
  });
  const band = dim({
    dim_id: "building_limit_band",
    data_type: "number",
    shape: "banded",
    source_field: "building_limit",
    levels: [
      { kind: "banded", id: "lo", label: "0–250k", lo: null, hi: 250_000 },
      { kind: "banded", id: "hi", label: "250k+", lo: 250_000, hi: null },
    ],
  });
  const pairs: DriverPair[] = [
    {
      a: table({ table_id: "territory_prop", cells: { t3: 1.12, t5: 0.91 } }),
      b: table({ table_id: "territory_prop", cells: { t3: 1.22, t5: 0.91 } }),
      dim: territory,
    },
    {
      a: table({ table_id: "sprinkler_prop", cells: { true: 0.92, false: 1 } }),
      b: table({ table_id: "sprinkler_prop", cells: { true: 0.88, false: 1 } }),
      dim: sprinklered,
    },
    {
      a: table({ table_id: "building_ilf", cells: { lo: 1, hi: 0.82 } }),
      b: table({ table_id: "building_ilf", cells: { lo: 1, hi: 0.85 } }),
      dim: band,
    },
  ];
  it("resolves the row through the engine's own resolvers and names the biggest move", () => {
    // t3 moved +8.9%, sprinkler −4.3%, band +3.7% → territory wins.
    expect(
      moverDriver(
        { zip: "68502", sprinklered: "true", building_limit: "$400,000" },
        pairs,
      ),
    ).toBe("territory_prop t3 1.12→1.22");
    // A t5 row: territory unchanged there — the sprinkler credit wins.
    expect(
      moverDriver(
        { zip: "68801", sprinklered: "y", building_limit: "100000" },
        pairs,
      ),
    ).toBe("sprinkler_prop true 0.92→0.88");
  });
  it("tolerates wire levels that omit aliases (the API may not send them)", () => {
    const bare: DriverPair[] = [
      {
        a: table({ table_id: "sprinkler_prop", cells: { true: 0.92 } }),
        b: table({ table_id: "sprinkler_prop", cells: { true: 0.88 } }),
        dim: dim({
          dim_id: "sprinklered_level",
          source_field: "sprinklered",
          levels: [{ kind: "categorical", id: "true", label: "Yes" }],
        }),
      },
    ];
    expect(moverDriver({ sprinklered: "true" }, bare)).toBe(
      "sprinkler_prop true 0.92→0.88",
    );
  });
  it("reads the input column from the STAGE binding when dims name none", () => {
    const unbound: DriverPair[] = [
      {
        a: table({ table_id: "territory_prop", cells: { t3: 1.12 } }),
        b: table({ table_id: "territory_prop", cells: { t3: 1.22 } }),
        dim: { ...territory, source_field: null } as typeof territory,
      },
    ];
    expect(moverDriver({ zip: "68502" }, unbound)).toBeNull();
    expect(
      moverDriver({ zip: "68502" }, unbound, { territory: "zip" }),
    ).toBe("territory_prop t3 1.12→1.22");
  });
  it("harvests slug→field bindings from chain stage configs", () => {
    const stages = [
      {
        stage_id: "chains",
        stage_kind: "multiplicative_chain",
        display_name: "Rating chains",
        config_json: {
          chains: [
            {
              factor_lookups: [
                // The ingester's shape: { path, source } per dim…
                {
                  dimensions: {
                    territory: { path: "zip", source: "form_input" },
                  },
                },
                // …and the bare-string shape older configs carry.
                { dimensions: { sprinklered_level: "sprinklered" } },
              ],
            },
          ],
        },
      } as unknown as Parameters<typeof dimFieldBindings>[0][number],
    ];
    expect(dimFieldBindings(stages)).toEqual({
      territory: "zip",
      sprinklered_level: "sprinklered",
    });
  });
  it("is null when no changed table resolves for the row", () => {
    expect(
      moverDriver({ zip: "99999", sprinklered: "maybe" }, pairs),
    ).toBeNull();
  });
});

describe("policyPremium", () => {
  it("prefers the composed final and refuses error rows", () => {
    const composed = {
      ...result("y", 900),
      composed: { final: 950, subtotal: 900, adjustments: [] },
    } as unknown as PolicyBookResult;
    expect(policyPremium(composed, "total_premium")).toBe(950);
    expect(
      policyPremium(result("z", 100, { rowErrors: 1 }), "total_premium"),
    ).toBeNull();
  });
});
