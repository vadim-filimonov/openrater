/**
 * Tests for the exhibit math — Brief 43 PR 43.4.
 *
 * Pins down the 5 KPI computations + the comparison delta math
 * against a small handwritten scored batch. Each KPI is tested
 * against a known-correct answer so future refactors can't drift
 * silently.
 */

import { describe, expect, it } from "vitest";
import {
  computeSliceExhibit,
  defaultPremiumMetricColumn,
  deltaTone,
  derivePremiumMetricColumns,
  exhibitRowCount,
  formatDeltaPct,
  formatKpiValue,
  formatRelativeTime,
  kpiValue,
  premiumSplitByTier,
  type AnalyticsScoredRow,
  type ScoredBatchResult,
} from "./exhibit-math";

// ──────────────────────────────────────────────────────────────────
// Fixture
// ──────────────────────────────────────────────────────────────────

function row(
  ntee: string,
  premium: number,
  loss?: number,
): AnalyticsScoredRow {
  return {
    inputs: { ntee_major: ntee },
    outputs:
      loss !== undefined
        ? { final_premium: premium, incurred_loss: loss }
        : { final_premium: premium },
  };
}

const BASELINE_ROWS: AnalyticsScoredRow[] = [
  // Arts: 2 rows, premium 1000 + 500 = 1500
  row("arts", 1000, 600),
  row("arts", 500, 200),
  // Religion: 1 row, premium 2000
  row("religion", 2000, 1500),
  // Education: 1 row, premium 750
  row("education", 750, 100),
];

const COMPARISON_ROWS: AnalyticsScoredRow[] = [
  // Arts: 2 rows, premium 1100 + 600 = 1700 (+13.3% vs 1500)
  row("arts", 1100, 600),
  row("arts", 600, 200),
  // Religion: 1 row, premium 1900 (-5% vs 2000)
  row("religion", 1900, 1500),
  // Education: 1 row, premium 750 (flat vs 750)
  row("education", 750, 100),
  // Health: net new in comparison (no baseline level — should still appear)
  row("health", 1200, 400),
];

const NTEE_LEVELS = [
  { id: "arts", label: "Arts" },
  { id: "religion", label: "Religion" },
  { id: "education", label: "Education" },
  { id: "health", label: "Health" },
];

// ──────────────────────────────────────────────────────────────────
// premiumSplitByTier (G11 — written vs declined-indicative)
// ──────────────────────────────────────────────────────────────────

describe("premiumSplitByTier", () => {
  function tierRow(premium: number, tier?: string): AnalyticsScoredRow {
    return {
      inputs: {},
      outputs:
        tier !== undefined
          ? { final_premium: premium, eligibility_tier: tier }
          : { final_premium: premium },
    };
  }

  it("splits declined-indicative premium out of the written total", () => {
    const split = premiumSplitByTier(
      [
        tierRow(4731, "standard"),
        tierRow(1388, "decline"),
        tierRow(900, "submit"),
      ],
      "final_premium",
    );
    expect(split.written).toBe(5631); // standard + submit — never the decline
    expect(split.declined).toBe(1388);
    expect(split.declinedCount).toBe(1);
    expect(split.hasVerdicts).toBe(true);
  });

  it("reports hasVerdicts=false for a book with no tier column (gate-less / legacy run)", () => {
    const split = premiumSplitByTier(
      [tierRow(1000), tierRow(500)],
      "final_premium",
    );
    expect(split.hasVerdicts).toBe(false);
    expect(split.written).toBe(1500);
    expect(split.declined).toBe(0);
    expect(split.declinedCount).toBe(0);
  });

  it("counts a declined row with no numeric premium without polluting sums", () => {
    const rows: AnalyticsScoredRow[] = [
      { inputs: {}, outputs: { eligibility_tier: "decline" } },
      tierRow(100, "standard"),
    ];
    const split = premiumSplitByTier(rows, "final_premium");
    expect(split.declinedCount).toBe(1);
    expect(split.declined).toBe(0);
    expect(split.written).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────────────
// kpiValue (per-bucket)
// ──────────────────────────────────────────────────────────────────

describe("kpiValue", () => {
  it("returns null for an empty bucket", () => {
    expect(kpiValue([], "count", "final_premium")).toBe(null);
    expect(kpiValue([], "total", "final_premium")).toBe(null);
    expect(kpiValue([], "avg", "final_premium")).toBe(null);
  });

  it("count returns row length", () => {
    const rows = BASELINE_ROWS.slice(0, 3);
    expect(kpiValue(rows, "count", "final_premium")).toBe(3);
  });

  it("total sums the premium column", () => {
    const rows = [row("arts", 1000), row("arts", 500)];
    expect(kpiValue(rows, "total", "final_premium")).toBe(1500);
  });

  it("avg is total ÷ count", () => {
    const rows = [row("arts", 1000), row("arts", 500)];
    expect(kpiValue(rows, "avg", "final_premium")).toBe(750);
  });

  it("lr divides loss by premium", () => {
    const rows = [row("arts", 1000, 600), row("arts", 500, 200)];
    expect(
      kpiValue(rows, "lr", "final_premium", "incurred_loss"),
    ).toBeCloseTo(800 / 1500, 5);
  });

  it("lr returns null when premium is zero", () => {
    const rows = [row("arts", 0, 100)];
    expect(kpiValue(rows, "lr", "final_premium", "incurred_loss")).toBe(
      null,
    );
  });

  it("lr returns null when lossColumn is omitted", () => {
    const rows = [row("arts", 1000)];
    expect(kpiValue(rows, "lr", "final_premium")).toBe(null);
  });

  it("lr falls back to row.inputs[lossColumn] when the column isn't in outputs (G-4)", () => {
    // Plans typically carry loss data in the CSV inputs, not in
    // the computed outputs. The lossSum fallback lets the LR KPI
    // compute correctly regardless of which side the column lives on.
    const inputsRows: AnalyticsScoredRow[] = [
      {
        inputs: { ntee_major: "arts", incurred_loss: 600 },
        outputs: { final_premium: 1000 },
      },
      {
        inputs: { ntee_major: "arts", incurred_loss: 200 },
        outputs: { final_premium: 500 },
      },
    ];
    // (600 + 200) / (1000 + 500) = 800/1500 ≈ 0.5333
    expect(
      kpiValue(inputsRows, "lr", "final_premium", "incurred_loss"),
    ).toBeCloseTo(800 / 1500, 5);
  });

  it("lr prefers row.outputs over row.inputs when both are present (G-4)", () => {
    const mixedRow: AnalyticsScoredRow = {
      inputs: { ntee_major: "arts", incurred_loss: 999 },
      outputs: { final_premium: 1000, incurred_loss: 100 },
    };
    // outputs takes precedence — 100 / 1000 = 0.1
    expect(
      kpiValue([mixedRow], "lr", "final_premium", "incurred_loss"),
    ).toBeCloseTo(100 / 1000, 5);
  });

  it("rate_change uses the supplied globals", () => {
    const rows = [row("arts", 100)];
    expect(
      kpiValue(rows, "rate_change", "final_premium", undefined, {
        baselineTotal: 4250,
        comparisonTotal: 5550,
      }),
    ).toBeCloseTo(5550 / 4250 - 1, 5);
  });

  it("rate_change returns null without globals", () => {
    const rows = [row("arts", 100)];
    expect(kpiValue(rows, "rate_change", "final_premium")).toBe(null);
  });

  it("ignores non-numeric outputs gracefully", () => {
    const r: AnalyticsScoredRow = {
      inputs: {},
      outputs: { final_premium: "not a number" },
    };
    expect(kpiValue([r], "total", "final_premium")).toBe(0);
  });

  it("parses numeric strings", () => {
    const r: AnalyticsScoredRow = {
      inputs: {},
      outputs: { final_premium: "1200.50" },
    };
    expect(kpiValue([r], "total", "final_premium")).toBe(1200.5);
  });
});

// ──────────────────────────────────────────────────────────────────
// computeSliceExhibit
// ──────────────────────────────────────────────────────────────────

describe("computeSliceExhibit — single-side (baseline only)", () => {
  it("buckets per level + computes total premium per level", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: null,
      sliceId: "ntee_major",
      sliceLabel: "NTEE major",
      kpi: "total",
      premiumColumn: "final_premium",
      definedLevels: NTEE_LEVELS,
    });

    // Bar scaling: max baseline value is 2000 (religion).
    expect(exhibit.maxValue).toBe(2000);

    // Sorted by comparisonValue desc, falling back to baselineValue
    // when no comparison. So: religion (2000), arts (1500),
    // education (750), health (null → 0).
    const ids = exhibit.levels.map((l) => l.id);
    expect(ids).toEqual(["religion", "arts", "education", "health"]);

    // Religion: 2000
    expect(exhibit.levels[0]?.baselineValue).toBe(2000);
    expect(exhibit.levels[0]?.comparisonValue).toBe(null);
    expect(exhibit.levels[0]?.deltaPct).toBe(null);
    // Arts: 1500
    expect(exhibit.levels[1]?.baselineValue).toBe(1500);
    // Education: 750
    expect(exhibit.levels[2]?.baselineValue).toBe(750);
    // Health: not in baseline → null
    expect(exhibit.levels[3]?.baselineValue).toBe(null);
    expect(exhibit.levels[3]?.comparisonValue).toBe(null);
  });

  it("exposes the workspace-wide baseline total for total KPI", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: null,
      sliceId: "ntee_major",
      sliceLabel: "NTEE major",
      kpi: "total",
      premiumColumn: "final_premium",
      definedLevels: NTEE_LEVELS,
    });
    expect(exhibit.baselineTotal).toBe(4250);
    expect(exhibit.comparisonTotal).toBe(null);
  });

  it("hides totals for non-summable KPIs (avg, lr, rate_change)", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: null,
      sliceId: "ntee_major",
      sliceLabel: "NTEE major",
      kpi: "avg",
      premiumColumn: "final_premium",
      definedLevels: NTEE_LEVELS,
    });
    expect(exhibit.baselineTotal).toBe(null);
  });
});

describe("computeSliceExhibit — slice→input column binding (Brief 51 L1)", () => {
  // The BOP-KS shape: the geographic dim's id is `zip`, but the value
  // lives in CSV column `territory` (mapped via column_map). The level
  // ids ARE the territory codes. Reproduces + guards the all-"—" bug.
  const TERRITORY_ROWS: AnalyticsScoredRow[] = [
    { inputs: { territory: "t1" }, outputs: { premium: 100 } },
    { inputs: { territory: "t1" }, outputs: { premium: 200 } },
    { inputs: { territory: "t2" }, outputs: { premium: 50 } },
  ];
  const TERRITORY_LEVELS = [
    { id: "t1", label: "t1" },
    { id: "t2", label: "t2" },
  ];

  it("groups by sliceColumn when it differs from sliceId (dim id ≠ column)", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: TERRITORY_ROWS,
      comparisonRows: null,
      sliceId: "zip", // dim identity
      sliceColumn: "territory", // physical CSV column
      sliceLabel: "territory",
      kpi: "total",
      premiumColumn: "premium",
      definedLevels: TERRITORY_LEVELS,
    });
    const t701 = exhibit.levels.find((l) => l.id === "t1")!;
    const t702 = exhibit.levels.find((l) => l.id === "t2")!;
    expect(t701.baselineValue).toBe(300); // 100 + 200
    expect(t702.baselineValue).toBe(50);
    expect(exhibit.baselineTotal).toBe(350);
    // sliceId stays the identity (not the column).
    expect(exhibit.sliceId).toBe("zip");
  });

  it("reproduces the bug: without sliceColumn, grouping by sliceId drops every row", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: TERRITORY_ROWS,
      comparisonRows: null,
      sliceId: "zip", // no sliceColumn → falls back to id → reads inputs["zip"] = undefined
      sliceLabel: "territory",
      kpi: "total",
      premiumColumn: "premium",
      definedLevels: TERRITORY_LEVELS,
    });
    // Every defined level is empty → baselineValue null → renders "—".
    expect(exhibit.levels.every((l) => l.baselineValue === null)).toBe(true);
  });
});

describe("computeSliceExhibit — paired (baseline + comparison)", () => {
  it("computes the deltaPct per level when both sides are non-null", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: COMPARISON_ROWS,
      sliceId: "ntee_major",
      sliceLabel: "NTEE major",
      kpi: "total",
      premiumColumn: "final_premium",
      definedLevels: NTEE_LEVELS,
    });

    const arts = exhibit.levels.find((l) => l.id === "arts")!;
    expect(arts.baselineValue).toBe(1500);
    expect(arts.comparisonValue).toBe(1700);
    expect(arts.deltaPct).toBeCloseTo(1700 / 1500 - 1, 5);

    const religion = exhibit.levels.find((l) => l.id === "religion")!;
    expect(religion.baselineValue).toBe(2000);
    expect(religion.comparisonValue).toBe(1900);
    expect(religion.deltaPct).toBeCloseTo(1900 / 2000 - 1, 5);
  });

  it("flat delta when comparison equals baseline", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: COMPARISON_ROWS,
      sliceId: "ntee_major",
      sliceLabel: "NTEE major",
      kpi: "total",
      premiumColumn: "final_premium",
      definedLevels: NTEE_LEVELS,
    });
    const education = exhibit.levels.find((l) => l.id === "education")!;
    expect(education.deltaPct).toBe(0);
  });

  it("delta is null when baseline is null (new comparison-only level)", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: COMPARISON_ROWS,
      sliceId: "ntee_major",
      sliceLabel: "NTEE major",
      kpi: "total",
      premiumColumn: "final_premium",
      definedLevels: NTEE_LEVELS,
    });
    const health = exhibit.levels.find((l) => l.id === "health")!;
    expect(health.baselineValue).toBe(null);
    expect(health.comparisonValue).toBe(1200);
    expect(health.deltaPct).toBe(null);
  });

  it("sorts by comparisonValue desc when both sides present", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: COMPARISON_ROWS,
      sliceId: "ntee_major",
      sliceLabel: "NTEE major",
      kpi: "total",
      premiumColumn: "final_premium",
      definedLevels: NTEE_LEVELS,
    });
    // Comparison sums: religion=1900, arts=1700, health=1200, education=750
    expect(exhibit.levels.map((l) => l.id)).toEqual([
      "religion",
      "arts",
      "health",
      "education",
    ]);
  });

  it("reports row count for the comparison side", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: COMPARISON_ROWS,
      sliceId: "ntee_major",
      sliceLabel: "NTEE major",
      kpi: "total",
      premiumColumn: "final_premium",
      definedLevels: NTEE_LEVELS,
    });
    expect(exhibit.levels.find((l) => l.id === "arts")?.rowCount).toBe(2);
    expect(exhibit.levels.find((l) => l.id === "religion")?.rowCount).toBe(1);
  });

  it("exposes both totals on workspace-wide tier (count + total only)", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: COMPARISON_ROWS,
      sliceId: "ntee_major",
      sliceLabel: "NTEE major",
      kpi: "total",
      premiumColumn: "final_premium",
      definedLevels: NTEE_LEVELS,
    });
    expect(exhibit.baselineTotal).toBe(4250);
    expect(exhibit.comparisonTotal).toBe(5550);
  });
});

describe("computeSliceExhibit — undefined levels (continuous slice)", () => {
  it("discovers levels from the data when no definedLevels", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: null,
      sliceId: "ntee_major",
      sliceLabel: "ntee_major",
      kpi: "count",
      premiumColumn: "final_premium",
      definedLevels: null,
    });
    // Levels come from the input data — order by count desc.
    expect(exhibit.levels.map((l) => l.id).sort()).toEqual([
      "arts",
      "education",
      "religion",
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Display helpers
// ──────────────────────────────────────────────────────────────────

describe("formatKpiValue", () => {
  it("formats count with thousands separators", () => {
    expect(formatKpiValue(1247, "count")).toBe("1,247");
  });

  it("formats total premium as $M for ≥ 1M", () => {
    expect(formatKpiValue(2_500_000, "total")).toBe("$2.50M");
  });

  it("formats total premium as $K for ≥ 1K", () => {
    expect(formatKpiValue(2500, "total")).toBe("$2.5K");
  });

  it("formats avg premium with the same currency formatter", () => {
    expect(formatKpiValue(2097, "avg")).toBe("$2.1K");
  });

  it("formats loss ratio as a percent", () => {
    expect(formatKpiValue(0.354, "lr")).toBe("35.4%");
  });

  it("formats rate_change with sign", () => {
    expect(formatKpiValue(0.068, "rate_change")).toBe("+6.8%");
    expect(formatKpiValue(-0.025, "rate_change")).toBe("-2.5%");
  });

  it("renders dash for null", () => {
    expect(formatKpiValue(null, "total")).toBe("—");
  });
});

describe("formatDeltaPct", () => {
  it("adds a sign + clamps to 1 decimal", () => {
    expect(formatDeltaPct(0.087)).toBe("+8.7%");
    expect(formatDeltaPct(-0.025)).toBe("-2.5%");
    // Exactly 0 prints without a sign — convention matches financial
    // reporting (positives flagged, zero is neutral).
    expect(formatDeltaPct(0)).toBe("0.0%");
    expect(formatDeltaPct(null)).toBe("—");
  });
});

describe("deltaTone", () => {
  it("categorizes deltas into up/down/flat", () => {
    expect(deltaTone(0.05)).toBe("up");
    expect(deltaTone(-0.05)).toBe("down");
    expect(deltaTone(0.001)).toBe("flat");
    expect(deltaTone(null)).toBe("none");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-05-26T15:00:00Z");

  it("returns 'just now' under 60 seconds", () => {
    expect(formatRelativeTime("2026-05-26T14:59:30Z", now)).toBe("just now");
  });

  it("returns minutes for less than an hour", () => {
    expect(formatRelativeTime("2026-05-26T14:48:00Z", now)).toBe("12 min ago");
  });

  it("returns hours for less than a day", () => {
    expect(formatRelativeTime("2026-05-26T12:00:00Z", now)).toBe("3 hr ago");
  });

  it("singularizes 1 day", () => {
    expect(formatRelativeTime("2026-05-25T15:00:00Z", now)).toBe("1 day ago");
  });

  it("pluralizes multi-day spans", () => {
    expect(formatRelativeTime("2026-05-22T15:00:00Z", now)).toBe("4 days ago");
  });

  it("returns dash for unparseable input", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("—");
  });
});

describe("exhibitRowCount", () => {
  it("returns 0 for null exhibit", () => {
    expect(exhibitRowCount(null)).toBe(0);
  });

  it("sums level row counts", () => {
    const exhibit = computeSliceExhibit({
      baselineRows: BASELINE_ROWS,
      comparisonRows: COMPARISON_ROWS,
      sliceId: "ntee_major",
      sliceLabel: "ntee_major",
      kpi: "count",
      premiumColumn: "final_premium",
      definedLevels: null,
    });
    // BASELINE_ROWS = 4 rows total; exhibit rowCount mirrors comparison
    // side when present (5 rows in COMPARISON_ROWS — see fixture).
    expect(exhibitRowCount(exhibit)).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// Cold-test L27 — premium-metric column discovery
// ──────────────────────────────────────────────────────────────────

/**
 * A multi-LOB scored batch mirroring the cold-test CGL D&O + GL plan:
 * every row carries do_premium, gl_premium, the per-LOB rollups
 * (which duplicate the chain columns for one-chain-per-LOB plans), and
 * plan_total_premium. Plus a non-premium diagnostic output.
 */
function multiLobResult(): ScoredBatchResult {
  const mk = (doP: number, glP: number): AnalyticsScoredRow => ({
    inputs: { state: "IL" },
    outputs: {
      do_premium: doP,
      gl_premium: glP,
      professional_lob_premium: doP, // duplicates do_premium
      liability_lob_premium: glP, // duplicates gl_premium
      plan_total_premium: doP + glP,
      do_model_factor_used: 1.05, // non-premium diagnostic — excluded
    },
  });
  return {
    scoredAt: "2026-05-28T00:00:00Z",
    rowCount: 2,
    rows: [mk(1000, 700), mk(1200, 800)],
    premiumColumn: "do_premium",
  };
}

describe("derivePremiumMetricColumns (L27)", () => {
  it("collapses value-identical duplicates to the cleaner column name", () => {
    const opts = derivePremiumMetricColumns(multiLobResult());
    const cols = opts.map((o) => o.column);
    // professional_lob_premium duplicates do_premium → only do_premium
    // survives; liability_lob_premium duplicates gl_premium → gl_premium.
    expect(cols).toContain("do_premium");
    expect(cols).toContain("gl_premium");
    expect(cols).toContain("plan_total_premium");
    expect(cols).not.toContain("professional_lob_premium");
    expect(cols).not.toContain("liability_lob_premium");
    // Exactly the 3 the cold-test wants.
    expect(cols).toHaveLength(3);
  });

  it("excludes non-premium diagnostic outputs", () => {
    const cols = derivePremiumMetricColumns(multiLobResult()).map(
      (o) => o.column,
    );
    expect(cols).not.toContain("do_model_factor_used");
  });

  it("surfaces the combined total first + flags it", () => {
    const opts = derivePremiumMetricColumns(multiLobResult());
    expect(opts[0]?.column).toBe("plan_total_premium");
    expect(opts[0]?.isCombinedTotal).toBe(true);
    expect(opts.filter((o) => o.isCombinedTotal)).toHaveLength(1);
  });

  it("labels columns human-readably (D&O / GL / Combined)", () => {
    const opts = derivePremiumMetricColumns(multiLobResult());
    const byCol = new Map(opts.map((o) => [o.column, o.label]));
    expect(byCol.get("do_premium")).toBe("D&O");
    expect(byCol.get("gl_premium")).toBe("GL");
    expect(byCol.get("plan_total_premium")).toBe("Combined (all LOBs)");
  });

  it("returns a single option for a single-LOB plan", () => {
    const single: ScoredBatchResult = {
      scoredAt: "2026-05-28T00:00:00Z",
      rowCount: 2,
      rows: [
        { inputs: {}, outputs: { final_premium: 100 } },
        { inputs: {}, outputs: { final_premium: 200 } },
      ],
      premiumColumn: "final_premium",
    };
    const opts = derivePremiumMetricColumns(single);
    expect(opts).toHaveLength(1);
    expect(opts[0]?.column).toBe("final_premium");
  });

  it("returns [] when no premium column exists", () => {
    const none: ScoredBatchResult = {
      scoredAt: "2026-05-28T00:00:00Z",
      rowCount: 1,
      rows: [{ inputs: {}, outputs: { some_factor: 1.2 } }],
      premiumColumn: "missing",
    };
    expect(derivePremiumMetricColumns(none)).toEqual([]);
  });

  it("treats the synthesized coverage-sum column as the combined total, labeled as a SUM", () => {
    // A total-less plan's run-fed result: the bridge materialized
    // `coverage_sum_premium` per clean row from views.premium; the
    // picker leads with it, flags it combined, and labels it honestly
    // (a dec-page sum, never a filed total).
    const totalLess: ScoredBatchResult = {
      scoredAt: "2026-07-15T00:00:00Z",
      rowCount: 2,
      rows: [
        {
          inputs: {},
          outputs: {
            building_premium: 13,
            contents_premium: 1650,
            coverage_sum_premium: 1663,
          },
        },
        {
          inputs: {},
          outputs: {
            building_premium: 26,
            contents_premium: 1650,
            coverage_sum_premium: 1676,
          },
        },
      ],
      premiumColumn: "coverage_sum_premium",
    };
    const opts = derivePremiumMetricColumns(totalLess);
    expect(opts[0]?.column).toBe("coverage_sum_premium");
    expect(opts[0]?.isCombinedTotal).toBe(true);
    expect(opts[0]?.label).toBe("All coverages (sum)");
    // The towers stay selectable metrics beside it.
    expect(opts.map((o) => o.column)).toEqual([
      "coverage_sum_premium",
      "building_premium",
      "contents_premium",
    ]);
    expect(defaultPremiumMetricColumn(totalLess)).toBe(
      "coverage_sum_premium",
    );
  });

  it("sums correctly per metric (the cold-test $ values direction)", () => {
    const r = multiLobResult();
    const doSum = kpiValue(r.rows, "total", "do_premium");
    const glSum = kpiValue(r.rows, "total", "gl_premium");
    const totalSum = kpiValue(r.rows, "total", "plan_total_premium");
    expect(doSum).toBe(2200); // 1000 + 1200
    expect(glSum).toBe(1500); // 700 + 800
    expect(totalSum).toBe(3700); // 2200 + 1500 — combined
  });
});

describe("defaultPremiumMetricColumn (L27)", () => {
  it("defaults a multi-LOB plan to the combined total", () => {
    expect(defaultPremiumMetricColumn(multiLobResult())).toBe(
      "plan_total_premium",
    );
  });

  it("defaults a single-LOB plan to its only column", () => {
    const single: ScoredBatchResult = {
      scoredAt: "2026-05-28T00:00:00Z",
      rowCount: 1,
      rows: [{ inputs: {}, outputs: { final_premium: 100 } }],
      premiumColumn: "final_premium",
    };
    expect(defaultPremiumMetricColumn(single)).toBe("final_premium");
  });

  it("falls back to the declared column when discovery is empty", () => {
    const none: ScoredBatchResult = {
      scoredAt: "2026-05-28T00:00:00Z",
      rowCount: 1,
      rows: [{ inputs: {}, outputs: { x: 1 } }],
      premiumColumn: "do_premium",
    };
    expect(defaultPremiumMetricColumn(none)).toBe("do_premium");
  });
});

// ──────────────────────────────────────────────────────────────────
// Brief 51 L2 — KPI → output column binding (declared outputs)
// ──────────────────────────────────────────────────────────────────

describe("derivePremiumMetricColumns — declared outputs (Brief 51 L2)", () => {
  it("binds to the plan's real declared money outputs, not a name heuristic", () => {
    // The BOP shape: the single tower output is literally named `premium`
    // (no `_premium` suffix). The pre-Brief-51 heuristic missed it →
    // empty picker → "Analytics KPI unbound". outputColumns fixes it.
    const result: ScoredBatchResult = {
      scoredAt: "2026-05-31T00:00:00Z",
      rowCount: 2,
      rows: [
        { inputs: {}, outputs: { premium: 100 } },
        { inputs: {}, outputs: { premium: 200 } },
      ],
      premiumColumn: "premium",
      outputColumns: [{ column: "premium", role: "premium" }],
    };
    const opts = derivePremiumMetricColumns(result);
    expect(opts.map((o) => o.column)).toEqual(["premium"]);
    expect(defaultPremiumMetricColumn(result)).toBe("premium");
  });

  it("enumerates every coverage output + surfaces the declared total first", () => {
    // The multi-output BOP intent: building / bpp / total as real outputs.
    const result: ScoredBatchResult = {
      scoredAt: "2026-05-31T00:00:00Z",
      rowCount: 1,
      rows: [
        {
          inputs: {},
          outputs: {
            building_premium: 2109,
            bpp_premium: 387,
            plan_total_premium: 2496,
          },
        },
      ],
      premiumColumn: "building_premium",
      outputColumns: [
        { column: "building_premium", role: "premium" },
        { column: "bpp_premium", role: "premium" },
        { column: "plan_total_premium", role: "total" },
      ],
    };
    const opts = derivePremiumMetricColumns(result);
    expect(opts[0]?.column).toBe("plan_total_premium"); // declared total first
    expect(opts[0]?.isCombinedTotal).toBe(true);
    expect(opts.map((o) => o.column).sort()).toEqual(
      ["bpp_premium", "building_premium", "plan_total_premium"].sort(),
    );
    expect(defaultPremiumMetricColumn(result)).toBe("plan_total_premium");
  });

  it("excludes declared diagnostic (non-money) outputs", () => {
    const result: ScoredBatchResult = {
      scoredAt: "2026-05-31T00:00:00Z",
      rowCount: 1,
      rows: [{ inputs: {}, outputs: { premium: 100, do_factor_used: 1.05 } }],
      premiumColumn: "premium",
      outputColumns: [
        { column: "premium", role: "premium" },
        { column: "do_factor_used", role: "diagnostic" },
      ],
    };
    expect(derivePremiumMetricColumns(result).map((o) => o.column)).toEqual([
      "premium",
    ]);
  });

  it("legacy fallback (no outputColumns) still surfaces a `premium`-named output", () => {
    // Guards the BOP "Analytics KPI unbound" regression for results
    // scored before Brief 51 recorded outputColumns.
    const legacy: ScoredBatchResult = {
      scoredAt: "2026-05-31T00:00:00Z",
      rowCount: 2,
      rows: [
        { inputs: {}, outputs: { premium: 1.35 } },
        { inputs: {}, outputs: { premium: 1.35 } },
      ],
      premiumColumn: "premium",
      // no outputColumns — exercises the legacy heuristic path
    };
    expect(derivePremiumMetricColumns(legacy).map((o) => o.column)).toEqual([
      "premium",
    ]);
    expect(defaultPremiumMetricColumn(legacy)).toBe("premium");
  });
});
