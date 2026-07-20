/**
 * Brief 43 PR 43.4 — Exhibit math for the chart + (PR 43.5) map.
 *
 * Pure functions over a scored batch — the actuary picks a slice
 * variable + a KPI; we group the rows by slice level and compute
 * the KPI value per level. Compare (when comparisonRows is non-null)
 * surfaces per-level deltas vs the baseline.
 *
 * Shapes match Brief 43 §6.1 — the scored result is a `RunResult[]`
 * paired with the input rows so the slice grouping can read the
 * raw input column (which the runtime trace doesn't expose).
 *
 * Why pure: the chart + map both read the same exhibit primitive
 * (Brief 43 §1 lock) so the math lives in one place. Tests are
 * cheap because the math is deterministic + side-effect-free.
 */

import type { AnalyticsKpiId } from "./analytics-types";
import {
  COVERAGE_SUM_COLUMN,
  COVERAGE_SUM_COLUMN_LABEL,
} from "./premium-resolution";

// ──────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────

/**
 * A single row's input + output. The chart needs the slice variable
 * (from inputs) plus the premium / loss columns (from outputs).
 */
export interface AnalyticsScoredRow {
  readonly inputs: Record<string, unknown>;
  readonly outputs: Record<string, unknown>;
}

/**
 * The full scored batch — what `executePlanBatch` produces plus the
 * column metadata the math needs. PR 43.6 will plumb a real instance
 * from the Inputs workspace; PR 43.4 only needs the type.
 */
export interface ScoredBatchResult {
  /** ISO timestamp the batch ran at. */
  readonly scoredAt: string;
  /** Row count. Redundant with rows.length; kept for the footer chip. */
  readonly rowCount: number;
  readonly rows: readonly AnalyticsScoredRow[];
  /**
   * Which output field carries the premium ("final_premium",
   * "annual_premium", etc). Resolved by the consumer from the plan's
   * output spec — Brief 43 doesn't lock a name because each LOB
   * names its output differently.
   */
  readonly premiumColumn: string;
  /** Optional — the loss column for the `lr` KPI. */
  readonly lossColumn?: string;
  /**
   * Brief 51 L2 — the plan's REAL declared output columns, recorded at
   * score time from the runtime plan's `output` nodes. Lets the metric
   * picker bind to actual tower outputs (+ the declared plan total)
   * instead of guessing from `*_premium` name heuristics. Optional:
   * results scored before Brief 51 omit it and fall back to the
   * heuristic in `derivePremiumMetricColumns`.
   */
  readonly outputColumns?: readonly OutputColumnSpec[];
  /**
   * Brief 43 §6.1 / ADR-0041 Phase 2 — a content fingerprint of the
   * scoring substrate (stages + dims + factor cells) captured at score
   * time. Analytics recomputes the current fingerprint and shows a
   * non-blocking "plan changed since you scored" banner when they
   * differ. Optional: results scored before this lands omit it (→ never
   * flagged stale).
   */
  readonly planFingerprint?: string;
}

/**
 * Brief 51 L2 — one declared output column of the scored plan, with the
 * role Analytics needs to decide whether it's a selectable premium
 * metric. `premium` = a money tower output (a coverage premium);
 * `total` = the plan-wide aggregate (e.g. `plan_total_premium`),
 * surfaced first in the picker; `diagnostic` = a non-money output
 * (`*_factor_used`, `*_fallback_*`, records) excluded from KPIs.
 */
export interface OutputColumnSpec {
  readonly column: string;
  readonly label?: string;
  readonly role: "premium" | "total" | "diagnostic";
}

// ──────────────────────────────────────────────────────────────────
// Cold-test L27 — premium-metric column discovery
// ──────────────────────────────────────────────────────────────────

/**
 * One selectable premium metric — a column in the scored rows'
 * `outputs` the exhibits can be driven by. Powers the Analytics
 * toolbar's metric picker.
 */
export interface PremiumMetricOption {
  /** The output column name (e.g. `do_premium`, `plan_total_premium`). */
  readonly column: string;
  /** Human label for the picker (e.g. "D&O", "GL", "Combined (all LOBs)"). */
  readonly label: string;
  /**
   * True for the plan-wide combined total (`plan_total_premium`). The
   * picker marks it visually + the multi-LOB default selects it.
   */
  readonly isCombinedTotal: boolean;
}

/** The substrate's plan-total output field (projector G-3 convention). */
const PLAN_TOTAL_COLUMN = "plan_total_premium";

/** A plan-WIDE premium column: the declared combined total, or the
 *  synthesized dec-page sum a total-less plan's run advertises. Both
 *  lead the metric picker + win the multi-metric default. */
function isCombinedTotalColumn(column: string): boolean {
  return column === PLAN_TOTAL_COLUMN || column === COVERAGE_SUM_COLUMN;
}

/**
 * Map a known LOB tag (the `chain.lob_sum` kind's `lob_tag`, surfaced
 * in `{lob}_lob_premium`) to a human label. Falls back to a titled
 * form for unknown tags so the picker never shows a raw slug.
 *
 * The tag is now an EXPLICIT author choice on a `chain.lob_sum` node —
 * the projector no longer auto-emits these columns from a name-heuristic
 * (ADR-0033 §0; the `inferLobFromName` projection was removed in gate 5).
 * Labeling stays so any plan that authors a `chain.lob_sum` reads cleanly.
 */
const LOB_TAG_LABELS: Readonly<Record<string, string>> = {
  professional: "D&O / Professional",
  liability: "General liability",
  property: "Property",
  auto: "Auto",
  workers_comp: "Workers' comp",
  umbrella: "Umbrella",
};

/**
 * Turn a raw premium column name into a readable label.
 *
 *   plan_total_premium       → "Combined (all LOBs)"
 *   do_premium               → "D&O"
 *   gl_premium               → "GL"
 *   professional_lob_premium → "D&O / Professional"
 *   <other>_premium          → "<Other>" (title-cased, suffix stripped)
 */
function labelForPremiumColumn(column: string): string {
  if (column === PLAN_TOTAL_COLUMN) return "Combined (all LOBs)";
  // Total-less plans: the synthesized dec-page sum — labeled as a sum,
  // never as a filed total (the filing declares none).
  if (column === COVERAGE_SUM_COLUMN) return COVERAGE_SUM_COLUMN_LABEL;
  // Per-LOB rollup: `{lob_tag}_lob_premium`.
  const lobMatch = /^(.+)_lob_premium$/.exec(column);
  if (lobMatch) {
    const tag = lobMatch[1]!;
    return LOB_TAG_LABELS[tag] ?? titleCase(tag);
  }
  // Common coverage abbreviations get a crisp uppercase label.
  const base = column.replace(/_premium$/, "");
  const ABBREV: Readonly<Record<string, string>> = {
    do: "D&O",
    gl: "GL",
    bop: "BOP",
    epli: "EPLI",
    cyber: "Cyber",
    umbrella: "Umbrella",
  };
  return ABBREV[base] ?? titleCase(base);
}

function titleCase(slug: string): string {
  return slug
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Discover which premium-metric columns the scored rows actually
 * contain, returning one labeled option per distinct metric. Powers
 * the L27 metric picker so a multi-LOB plan (D&O + GL) can switch the
 * exhibits between each LOB and the combined total instead of being
 * hard-locked to the first chain's column.
 *
 * Rules:
 *   • A column qualifies when its name ends in `_premium` AND at least
 *     one row carries a finite numeric value for it. (Excludes the
 *     non-premium diagnostic outputs — `_factor_used`, `_fallback_*`,
 *     `_contribution`, `sublimit_*`.)
 *   • Duplicate columns are collapsed: when two columns carry the SAME
 *     value on every row (the projector emits both a `{chain}_premium`
 *     and a redundant single-chain `{lob}_lob_premium`), only one is
 *     kept — preferring the shorter / cleaner column name so the menu
 *     shows "D&O" rather than "professional_lob_premium" twice. A
 *     `{lob}_lob_premium` that genuinely differs from every chain
 *     column (a multi-chain LOB) survives as its own option.
 *   • The combined total (`plan_total_premium`) is always surfaced
 *     first when present, then the remaining metrics in stable
 *     column order.
 *
 * Returns `[]` when no premium column exists (degenerate plan); the
 * consumer falls back to the result's own `premiumColumn` in that case.
 */
export function derivePremiumMetricColumns(
  result: Pick<ScoredBatchResult, "rows" | "premiumColumn" | "outputColumns">,
): readonly PremiumMetricOption[] {
  // Brief 51 L2 — authoritative path: bind the picker to the plan's REAL
  // declared outputs (money tower outputs + the declared plan total),
  // recorded at score time. No name heuristic — a `premium`-named output
  // is just as discoverable as `do_premium`, and a multi-output plan
  // exposes every coverage + its declared total as selectable metrics.
  const declared = (result.outputColumns ?? []).filter(
    (o) => o.role === "premium" || o.role === "total",
  );
  if (declared.length > 0) {
    const options: PremiumMetricOption[] = declared.map((o) => ({
      column: o.column,
      label: o.label ?? labelForPremiumColumn(o.column),
      isCombinedTotal: o.role === "total" || isCombinedTotalColumn(o.column),
    }));
    // Declared total(s) first, then declared (plan) order.
    options.sort((a, b) => {
      if (a.isCombinedTotal !== b.isCombinedTotal) {
        return a.isCombinedTotal ? -1 : 1;
      }
      return (
        declared.findIndex((o) => o.column === a.column) -
        declared.findIndex((o) => o.column === b.column)
      );
    });
    return options;
  }

  // Legacy fallback (results scored before Brief 51 recorded
  // outputColumns): discover `*_premium` columns by heuristic, but
  // ALWAYS lead with the declared primary `premiumColumn` so a
  // `premium`-named output (or any non-`*_premium` name) is no longer
  // invisible to the picker (Brief 51 L2 — the "Analytics KPI unbound"
  // fatal flaw).
  const rows = result.rows;
  if (rows.length === 0) {
    // No rows to inspect — offer just the declared premium column so
    // the picker isn't empty for an in-flight / zero-row batch.
    return [
      {
        column: result.premiumColumn,
        label: labelForPremiumColumn(result.premiumColumn),
        isCombinedTotal: isCombinedTotalColumn(result.premiumColumn),
      },
    ];
  }

  // 1. Collect candidate columns. Lead with the declared primary when it
  //    carries a finite value on >= 1 row (it usually does — scoring
  //    emits it), then any `*_premium` output numeric on >= 1 row.
  //    Preserve first-seen order.
  const candidates: string[] = [];
  const seen = new Set<string>();
  const primaryNumeric = rows.some((row) => {
    const v = row.outputs[result.premiumColumn];
    return Number.isFinite(typeof v === "number" ? v : Number(v));
  });
  if (primaryNumeric) {
    candidates.push(result.premiumColumn);
    seen.add(result.premiumColumn);
  }
  for (const row of rows) {
    for (const key of Object.keys(row.outputs)) {
      if (seen.has(key)) continue;
      if (!key.endsWith("_premium")) continue;
      const v = row.outputs[key];
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) {
        seen.add(key);
        candidates.push(key);
      }
    }
  }
  if (candidates.length === 0) return [];

  // 2. Collapse value-identical duplicates. Two columns are duplicates
  //    when they carry the same numeric value on EVERY row. Keep the
  //    representative with the cleaner (shorter, then lexsmaller) name.
  const groups: string[][] = [];
  for (const col of candidates) {
    const match = groups.find((g) =>
      columnsValueIdentical(rows, g[0]!, col),
    );
    if (match) match.push(col);
    else groups.push([col]);
  }
  const representatives = groups.map((g) => pickCleanestColumn(g));

  // 3. Build options — combined total first, then column order.
  const options: PremiumMetricOption[] = representatives.map((column) => ({
    column,
    label: labelForPremiumColumn(column),
    isCombinedTotal: isCombinedTotalColumn(column),
  }));
  options.sort((a, b) => {
    if (a.isCombinedTotal !== b.isCombinedTotal) {
      return a.isCombinedTotal ? -1 : 1;
    }
    return (
      candidates.indexOf(a.column) - candidates.indexOf(b.column)
    );
  });
  return options;
}

/**
 * Pick a sensible DEFAULT premium metric for a freshly-loaded result.
 * Multi-metric (multi-LOB) plans default to the combined total so the
 * actuary sees the whole book first; single-metric plans default to
 * the only option. Falls back to the result's declared `premiumColumn`
 * when discovery is empty.
 */
export function defaultPremiumMetricColumn(
  result: Pick<ScoredBatchResult, "rows" | "premiumColumn" | "outputColumns">,
): string {
  const options = derivePremiumMetricColumns(result);
  if (options.length === 0) return result.premiumColumn;
  const combined = options.find((o) => o.isCombinedTotal);
  if (options.length > 1 && combined) return combined.column;
  return options[0]!.column;
}

/** Do two columns carry the same numeric value on every row? */
function columnsValueIdentical(
  rows: readonly AnalyticsScoredRow[],
  a: string,
  b: string,
): boolean {
  if (a === b) return true;
  for (const row of rows) {
    const va = Number(row.outputs[a]);
    const vb = Number(row.outputs[b]);
    // Both non-finite → treat as equal (e.g. both missing on this row).
    if (!Number.isFinite(va) && !Number.isFinite(vb)) continue;
    if (va !== vb) return false;
  }
  return true;
}

/**
 * From a group of value-identical columns, pick the cleanest name to
 * show. Prefers `plan_total_premium` (the combined-total convention),
 * then the shortest name, then lexicographically — so `do_premium`
 * wins over `professional_lob_premium`.
 */
function pickCleanestColumn(cols: readonly string[]): string {
  return [...cols].sort((a, b) => {
    if (a === PLAN_TOTAL_COLUMN) return -1;
    if (b === PLAN_TOTAL_COLUMN) return 1;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  })[0]!;
}

/**
 * One level of the slice with its KPI value + comparison delta.
 * `null` values mean "no rows landed in this level for this side"
 * — the chart renders a faded row instead of skipping.
 */
export interface LevelStat {
  readonly id: string;
  readonly label: string;
  readonly baselineValue: number | null;
  readonly comparisonValue: number | null;
  /** (comparison/baseline - 1) when both sides are non-null and
   *  baseline > 0; null otherwise. */
  readonly deltaPct: number | null;
  /** Row count on the comparison side; falls back to baseline when
   *  no comparison rows are present (e.g. live-draft mode). Surfaces
   *  in tooltips + drives the footer "rows" chip. */
  readonly rowCount: number;
}

/**
 * The exhibit primitive. Single source of truth for both the chart
 * (PR 43.4) and the map (PR 43.5) — they read the same level stats.
 */
export interface SliceExhibit {
  readonly sliceId: string;
  readonly sliceLabel: string;
  readonly kpi: AnalyticsKpiId;
  /** Ordered by `comparisonValue` desc (falling back to baseline). */
  readonly levels: readonly LevelStat[];
  /** Highest absolute value across both sides. Drives bar scaling. */
  readonly maxValue: number;
  /** Sum of baseline-side KPI values across all levels (when KPI is
   *  a sum-able measure — count, total). Used by the footer summary. */
  readonly baselineTotal: number | null;
  readonly comparisonTotal: number | null;
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function sliceKey(row: AnalyticsScoredRow, sliceId: string): string | null {
  // Brief 55 — a slice may target a scored OUTPUT column (e.g.
  // `eligibility_tier`) as well as a raw input column. Read inputs
  // first (the common case), then fall back to outputs so a verdict
  // column is groupable without polluting the input namespace.
  const raw =
    row.inputs[sliceId] !== undefined ? row.inputs[sliceId] : row.outputs[sliceId];
  if (raw === null || raw === undefined) return null;
  return String(raw);
}

/**
 * Bucket rows into per-level groups. Levels that exist in `definedLevels`
 * but have no rows produce a bucket with an empty array — the chart
 * still renders the row with a "—" value. Rows whose slice key matches
 * no defined level fall into a synthetic "__other__" bucket; the chart
 * collapses this when empty.
 */
function bucketRows(
  rows: readonly AnalyticsScoredRow[],
  sliceId: string,
  definedLevels: readonly { readonly id: string }[] | null,
): Map<string, AnalyticsScoredRow[]> {
  const buckets = new Map<string, AnalyticsScoredRow[]>();
  if (definedLevels) {
    for (const lvl of definedLevels) buckets.set(lvl.id, []);
  }
  for (const row of rows) {
    const key = sliceKey(row, sliceId);
    if (key === null) continue;
    let bucket = buckets.get(key);
    if (!bucket) {
      // Unknown level — keep around if the slice has no defined
      // level set (a continuous / column slice). Otherwise drop.
      if (definedLevels) continue;
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(row);
  }
  return buckets;
}

// ──────────────────────────────────────────────────────────────────
// KPI computation per bucket
// ──────────────────────────────────────────────────────────────────

function premiumSum(
  rows: readonly AnalyticsScoredRow[],
  premiumColumn: string,
): number {
  let sum = 0;
  for (const row of rows) {
    const v = toNumber(row.outputs[premiumColumn]);
    if (v !== null) sum += v;
  }
  return sum;
}

/**
 * G11 — split a book's premium by the run verdict. Reads the
 * `eligibility_tier` output column the scoring bridge surfaces on every
 * scored row of a plan with an appetite gate (Brief 55). A declined
 * row's premium is INDICATIVE, never written — the owner-locked split.
 *
 * `hasVerdicts` is false when NO row carries a verdict (a gate-less
 * plan, or a persisted run predating the tier column) — the caller
 * should render the undifferentiated total in that case rather than
 * claim a "written" figure it can't substantiate.
 */
export function premiumSplitByTier(
  rows: readonly AnalyticsScoredRow[],
  premiumColumn: string,
): {
  readonly written: number;
  readonly declined: number;
  readonly declinedCount: number;
  readonly hasVerdicts: boolean;
} {
  let written = 0;
  let declined = 0;
  let declinedCount = 0;
  let hasVerdicts = false;
  for (const row of rows) {
    const tier = row.outputs["eligibility_tier"];
    if (typeof tier === "string" && tier.length > 0) hasVerdicts = true;
    const v = toNumber(row.outputs[premiumColumn]);
    if (tier === "decline") {
      declinedCount += 1;
      if (v !== null) declined += v;
    } else if (v !== null) {
      written += v;
    }
  }
  return { written, declined, declinedCount, hasVerdicts };
}

/**
 * Brief 64 — smallest / largest premium among a bucket's rows (the `min`
 * / `max` KPIs). Returns null when no row carries a finite premium, so an
 * empty or all-non-numeric bucket renders "—" like the other KPIs.
 */
function premiumExtent(
  rows: readonly AnalyticsScoredRow[],
  premiumColumn: string,
  which: "min" | "max",
): number | null {
  let acc: number | null = null;
  for (const row of rows) {
    const v = toNumber(row.outputs[premiumColumn]);
    if (v === null) continue;
    acc = acc === null ? v : which === "min" ? Math.min(acc, v) : Math.max(acc, v);
  }
  return acc;
}

function lossSum(
  rows: readonly AnalyticsScoredRow[],
  lossColumn: string,
): number {
  // G-4 fix — loss values typically live in the CSV inputs (actuals
  // brought in alongside the risk attributes), not in the plan's
  // computed outputs. The lookup checks outputs FIRST (plans that
  // pass-through or compute losses take precedence) and falls back
  // to inputs (the common CSV-actuals case).
  let sum = 0;
  for (const row of rows) {
    let raw = row.outputs[lossColumn];
    if (raw === undefined || raw === null) raw = row.inputs[lossColumn];
    const v = toNumber(raw);
    if (v !== null) sum += v;
  }
  return sum;
}

/**
 * Compute the KPI value for a single bucket. Returns null when the
 * KPI can't be computed (e.g. `lr` without a loss column, `avg` with
 * an empty bucket).
 */
export function kpiValue(
  rows: readonly AnalyticsScoredRow[],
  kpi: AnalyticsKpiId,
  premiumColumn: string,
  lossColumn?: string,
  // For the global rate_change KPI we need cross-bucket totals; the
  // caller supplies them so per-bucket math stays simple.
  globals?: {
    readonly baselineTotal: number;
    readonly comparisonTotal: number;
  },
): number | null {
  if (rows.length === 0) return null;
  switch (kpi) {
    case "count":
      return rows.length;
    case "total":
      return premiumSum(rows, premiumColumn);
    case "avg": {
      const total = premiumSum(rows, premiumColumn);
      return total / rows.length;
    }
    case "min":
      return premiumExtent(rows, premiumColumn, "min");
    case "max":
      return premiumExtent(rows, premiumColumn, "max");
    case "lr": {
      if (!lossColumn) return null;
      const premium = premiumSum(rows, premiumColumn);
      if (premium <= 0) return null;
      return lossSum(rows, lossColumn) / premium;
    }
    case "rate_change": {
      // Rate-change is a single-cell metric (comparison/baseline - 1)
      // applied at the per-bucket level. The caller supplies the
      // globals only for the workspace-wide tile; per-bucket math
      // returns null here and the chart computes it from baselineValue
      // + comparisonValue (where we have both sides).
      if (!globals) return null;
      if (globals.baselineTotal <= 0) return null;
      return globals.comparisonTotal / globals.baselineTotal - 1;
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Main entry: compute the exhibit
// ──────────────────────────────────────────────────────────────────

export interface ComputeSliceExhibitArgs {
  readonly baselineRows: readonly AnalyticsScoredRow[];
  readonly comparisonRows: readonly AnalyticsScoredRow[] | null;
  readonly sliceId: string;
  /**
   * Brief 51 L1 — the physical input column the slice's values live in.
   * A dim's id (`sliceId`) is its stable identity, but the value may be
   * stored under a different CSV column (e.g. dim id `zip` ← column
   * `territory`, mapped via the plan's `column_map`). Grouping reads
   * `row.inputs[sliceColumn]`. When omitted, falls back to `sliceId` —
   * the back-compat path where the dim id IS the column name (the
   * Brief 43 cold-test fixtures). Keeping id + column separate is why a
   * geo-territory plan no longer renders every cell "—".
   */
  readonly sliceColumn?: string;
  readonly sliceLabel: string;
  readonly kpi: AnalyticsKpiId;
  readonly premiumColumn: string;
  readonly lossColumn?: string;
  /**
   * The defined levels for the slice. When null, the math discovers
   * levels from the data (continuous slice / raw column).
   */
  readonly definedLevels: readonly {
    readonly id: string;
    readonly label: string;
  }[] | null;
}

export function computeSliceExhibit(
  args: ComputeSliceExhibitArgs,
): SliceExhibit {
  const {
    baselineRows,
    comparisonRows,
    sliceId,
    sliceColumn,
    sliceLabel,
    kpi,
    premiumColumn,
    lossColumn,
    definedLevels,
  } = args;

  // Brief 51 L1 — group by the physical input column, not the dim id.
  // `sliceId` stays the identity (returned below + used for level
  // matching); `groupKey` is what we read from each row's inputs.
  const groupKey = sliceColumn ?? sliceId;
  const baselineBuckets = bucketRows(baselineRows, groupKey, definedLevels);
  const comparisonBuckets = comparisonRows
    ? bucketRows(comparisonRows, groupKey, definedLevels)
    : null;

  // Union of level ids across both sides + the defined level set.
  const allLevelIds = new Set<string>();
  for (const id of baselineBuckets.keys()) allLevelIds.add(id);
  if (comparisonBuckets) {
    for (const id of comparisonBuckets.keys()) allLevelIds.add(id);
  }

  const labelOf = (id: string): string => {
    if (definedLevels) {
      const lvl = definedLevels.find((l) => l.id === id);
      if (lvl) return lvl.label;
    }
    return id;
  };

  // Pre-compute the workspace-wide totals (used by rate_change).
  const baselineTotal = premiumSum(baselineRows, premiumColumn);
  const comparisonTotal = comparisonRows
    ? premiumSum(comparisonRows, premiumColumn)
    : 0;

  const optsForKpi: Parameters<typeof kpiValue>[4] =
    kpi === "rate_change"
      ? { baselineTotal, comparisonTotal }
      : undefined;

  const stats: LevelStat[] = [];
  for (const id of allLevelIds) {
    const bRows = baselineBuckets.get(id) ?? [];
    const cRows = comparisonBuckets?.get(id) ?? [];
    const baselineValue = bRows.length
      ? kpiValue(bRows, kpi, premiumColumn, lossColumn, optsForKpi)
      : null;
    const comparisonValue =
      comparisonBuckets && cRows.length
        ? kpiValue(cRows, kpi, premiumColumn, lossColumn, optsForKpi)
        : null;
    const deltaPct =
      baselineValue !== null &&
      comparisonValue !== null &&
      baselineValue !== 0
        ? comparisonValue / baselineValue - 1
        : null;
    stats.push({
      id,
      label: labelOf(id),
      baselineValue,
      comparisonValue,
      deltaPct,
      // Comparison-side count when present; otherwise fall back to
      // the baseline side. The footer "rows" chip sums these to show
      // the total rows the exhibit is built from — `0` when comparison
      // is null would understate the dataset and mislead the user.
      rowCount: comparisonBuckets ? cRows.length : bRows.length,
    });
  }

  // Sort by comparisonValue desc (fall back to baseline for missing).
  stats.sort((a, b) => {
    const av = a.comparisonValue ?? a.baselineValue ?? 0;
    const bv = b.comparisonValue ?? b.baselineValue ?? 0;
    return bv - av;
  });

  // Bar scaling: the larger of either side.
  let maxValue = 0;
  for (const s of stats) {
    if (s.baselineValue !== null && Math.abs(s.baselineValue) > maxValue) {
      maxValue = Math.abs(s.baselineValue);
    }
    if (s.comparisonValue !== null && Math.abs(s.comparisonValue) > maxValue) {
      maxValue = Math.abs(s.comparisonValue);
    }
  }

  return {
    sliceId,
    sliceLabel,
    kpi,
    levels: stats,
    maxValue,
    baselineTotal: kpi === "count" || kpi === "total" ? baselineTotal : null,
    comparisonTotal:
      comparisonRows && (kpi === "count" || kpi === "total")
        ? comparisonTotal
        : null,
  };
}

// ──────────────────────────────────────────────────────────────────
// Display helpers (shared between chart, tile row, footer)
// ──────────────────────────────────────────────────────────────────

/**
 * Format a KPI value for the chart's value column. The format is
 * KPI-aware: counts get thousands separators, premiums round to $K /
 * $M, loss ratio renders as a percent, rate change as ±%.
 */
export function formatKpiValue(
  value: number | null,
  kpi: AnalyticsKpiId,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (kpi) {
    case "count":
      return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
    case "total":
      return formatCurrency(value);
    case "avg":
      return formatCurrency(value);
    case "min":
      return formatCurrency(value);
    case "max":
      return formatCurrency(value);
    case "lr":
      return `${(value * 100).toFixed(1)}%`;
    case "rate_change":
      return formatDeltaPct(value);
  }
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatDeltaPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Categorical bucket for a delta — drives the chart's up/down/flat
 *  delta cell color (red for up, emerald for down, subtle for flat). */
export function deltaTone(
  value: number | null,
): "up" | "down" | "flat" | "none" {
  if (value === null || !Number.isFinite(value)) return "none";
  const pct = value * 100;
  if (pct > 0.5) return "up";
  if (pct < -0.5) return "down";
  return "flat";
}

/**
 * "12 min ago" / "3 hours ago" / "2 days ago" / "just now".
 *
 * Brief 43 PR 43.6.c — used by the footer "scored" chip. We keep the
 * formatter pure (takes an explicit `now` for testability) and round
 * conservatively (no second-resolution flicker — minimum unit is
 * minute).
 *
 * Returns "—" when the input doesn't parse.
 */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date(),
): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const deltaMs = now.getTime() - t;
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/**
 * Sum the row counts across the exhibit's levels. The chart exhibit
 * already applies any active state-filter at the source-row layer,
 * so this is the right number for the footer "rows" chip in both
 * filtered and unfiltered states.
 */
export function exhibitRowCount(exhibit: SliceExhibit | null): number {
  if (!exhibit) return 0;
  let total = 0;
  for (const level of exhibit.levels) total += level.rowCount;
  return total;
}
