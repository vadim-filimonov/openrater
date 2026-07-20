/**
 * Brief 64 §5.0 — variable impact ranking that orders the Overview's
 * "Rate Drivers" list.
 *
 * Plan-agnostic (§−1.Q8): the caller maps whatever `plan.dimensions`
 * contains into `OverviewVariableSpec[]` — Meridian BOP, E&S GL, anything. This
 * module assumes no variable names. For each variable it groups the scored
 * rows into levels (categorical/geographic → defined or discovered levels;
 * numeric → equal-count bins), computes the active KPI per level over
 * **well-populated** levels, and reports the swing = maxLevel / minLevel.
 *
 * "Well-populated" (§5.0): a level counts toward the swing only if it holds
 * ≥ max(2, 0.5% of the variable's rows) rows — so one freak policy can't
 * crown a variable. A variable whose populated levels don't differ is
 * `flat` (renders a "doesn't differentiate premium" chip, sorts last).
 *
 * Pure + deterministic. Reuses `kpiValue` (incl. for total/avg) so the
 * Overview, the detail exhibits, and the footer all agree on the math.
 */

import type { AnalyticsKpiId } from "./analytics-types";
import { kpiValue, type AnalyticsScoredRow } from "./exhibit-math";
import {
  computeEqualCountBins,
  binIndexForValue,
  type EqualCountGroups,
} from "./binning";

/** How a variable is grouped + which detail exhibit it dispatches to. */
export type OverviewVariableKind = "categorical" | "numeric" | "geographic";

/** One defined level of a discrete (categorical / geographic) variable. */
export interface OverviewLevelDef {
  readonly id: string;
  readonly label: string;
  /**
   * Raw input values that map to this level — territory member states/ZIPs
   * (Brief 44 grouping) or categorical aliases. When omitted, the level
   * `id` IS the raw value (the common 1:1 case).
   */
  readonly match?: readonly string[];
}

/**
 * A variable to rank. The consumer builds this from `plan.dimensions` +
 * the plan's column map + `levelsForKeying` (territory-when-grouped). Pure
 * data so the ranking stays testable.
 */
export interface OverviewVariableSpec {
  readonly id: string;
  readonly label: string;
  readonly kind: OverviewVariableKind;
  /** Physical input column the value lives in; defaults to `id`. */
  readonly column?: string;
  /** Discrete levels (categorical/geographic). Omit → discover from data. */
  readonly levels?: readonly OverviewLevelDef[];
  /** Numeric: equal-count bin count used for ranking. Default 10. */
  readonly binGroups?: EqualCountGroups;
}

/** Per-variable summary — one row of the Rate Drivers list. */
export interface VariableOverview {
  readonly id: string;
  readonly label: string;
  readonly kind: OverviewVariableKind;
  readonly kpi: AnalyticsKpiId;
  /** Total premium across rows that carry a value for this variable. */
  readonly total: number;
  /** Average per-policy premium across those rows (null when no rows). */
  readonly avg: number | null;
  /** Min / max of the per-level KPI value over well-populated levels. */
  readonly minLevel: number | null;
  readonly maxLevel: number | null;
  /** maxLevel / minLevel — the impact "swing". Null when flat or minLevel ≤ 0. */
  readonly swing: number | null;
  /** Levels with ≥ 1 row. */
  readonly levelCount: number;
  /** Levels that met the well-populated threshold (drive the swing). */
  readonly rankedLevelCount: number;
  /** True when the variable doesn't differentiate premium. */
  readonly flat: boolean;
  /** Numeric only — honest requested-vs-formed bin reporting (§5.1). */
  readonly bins?: { readonly requested: number; readonly formed: number };
}

export interface PlanOverview {
  /** Sorted by swing desc; flat variables last, ties broken by label. */
  readonly variables: readonly VariableOverview[];
  readonly premiumColumn: string;
  readonly kpi: AnalyticsKpiId;
  readonly rowCount: number;
}

export interface ComputePlanOverviewArgs {
  readonly rows: readonly AnalyticsScoredRow[];
  readonly variables: readonly OverviewVariableSpec[];
  readonly premiumColumn: string;
  /** The KPI whose per-level spread drives the ranking. Default "avg". */
  readonly kpi?: AnalyticsKpiId;
  readonly lossColumn?: string;
  /** Min share of a variable's rows for a level to count. Default 0.005. */
  readonly minExposureFraction?: number;
}

export function computePlanOverview(
  args: ComputePlanOverviewArgs,
): PlanOverview {
  const kpi = args.kpi ?? "avg";
  const minFrac = args.minExposureFraction ?? 0.005;
  const variables = args.variables.map((v) =>
    summarizeVariable(v, args.rows, args.premiumColumn, kpi, args.lossColumn, minFrac),
  );

  variables.sort((a, b) => {
    if (a.swing === null && b.swing === null) return a.label.localeCompare(b.label);
    if (a.swing === null) return 1;
    if (b.swing === null) return -1;
    if (b.swing !== a.swing) return b.swing - a.swing;
    return a.label.localeCompare(b.label);
  });

  return {
    variables,
    premiumColumn: args.premiumColumn,
    kpi,
    rowCount: args.rows.length,
  };
}

// ──────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────

interface LevelBucket {
  readonly id: string;
  readonly label: string;
  readonly rows: AnalyticsScoredRow[];
}

function summarizeVariable(
  v: OverviewVariableSpec,
  rows: readonly AnalyticsScoredRow[],
  premiumColumn: string,
  kpi: AnalyticsKpiId,
  lossColumn: string | undefined,
  minFrac: number,
): VariableOverview {
  const column = v.column ?? v.id;

  // Rows that carry a value for this variable.
  const present: AnalyticsScoredRow[] = [];
  for (const r of rows) if (rawKey(r, column) !== null) present.push(r);

  const total = kpiValue(present, "total", premiumColumn) ?? 0;
  const avg = present.length ? kpiValue(present, "avg", premiumColumn) : null;

  const { buckets, bins } = bucketLevels(v, present, column);

  const levelCount = buckets.filter((b) => b.rows.length > 0).length;
  const threshold = Math.max(2, Math.ceil(minFrac * present.length));
  const values: number[] = [];
  for (const b of buckets) {
    if (b.rows.length < threshold) continue;
    const kv = kpiValue(b.rows, kpi, premiumColumn, lossColumn);
    if (kv !== null && Number.isFinite(kv)) values.push(kv);
  }

  const rankedLevelCount = values.length;
  const minLevel = values.length ? Math.min(...values) : null;
  const maxLevel = values.length ? Math.max(...values) : null;
  const flat =
    rankedLevelCount < 2 ||
    (minLevel !== null && maxLevel !== null && minLevel === maxLevel);
  const swing =
    !flat && minLevel !== null && maxLevel !== null && minLevel > 0
      ? maxLevel / minLevel
      : null;

  return {
    id: v.id,
    label: v.label,
    kind: v.kind,
    kpi,
    total,
    avg,
    minLevel,
    maxLevel,
    swing,
    levelCount,
    rankedLevelCount,
    flat,
    ...(bins ? { bins } : {}),
  };
}

function bucketLevels(
  v: OverviewVariableSpec,
  present: readonly AnalyticsScoredRow[],
  column: string,
): {
  readonly buckets: LevelBucket[];
  readonly bins?: { readonly requested: number; readonly formed: number };
} {
  if (v.kind === "numeric") {
    const values: number[] = [];
    for (const r of present) {
      const n = readNumber(rawValue(r, column));
      if (n !== null) values.push(n);
    }
    const binning = computeEqualCountBins(values, v.binGroups ?? 10);
    const buckets: LevelBucket[] = binning.bins.map((b, i) => ({
      id: `bin-${i}`,
      label: `${fmtNum(b.lo)}–${fmtNum(b.hi)}`,
      rows: [],
    }));
    for (const r of present) {
      const n = readNumber(rawValue(r, column));
      if (n === null) continue;
      const idx = binIndexForValue(binning, n);
      if (idx >= 0) buckets[idx]!.rows.push(r);
    }
    return {
      buckets,
      bins: { requested: binning.requested, formed: binning.formed },
    };
  }

  // Discrete (categorical / geographic).
  if (v.levels && v.levels.length > 0) {
    const buckets = new Map<string, LevelBucket>();
    const matchToLevel = new Map<string, string>();
    for (const lv of v.levels) {
      buckets.set(lv.id, { id: lv.id, label: lv.label, rows: [] });
      if (lv.match && lv.match.length > 0) {
        for (const m of lv.match) matchToLevel.set(m, lv.id);
      } else {
        matchToLevel.set(lv.id, lv.id); // id is the raw value
      }
    }
    for (const r of present) {
      const key = rawKey(r, column);
      if (key === null) continue;
      const lid = matchToLevel.get(key);
      if (lid !== undefined) buckets.get(lid)!.rows.push(r);
      // Raw value matching no defined level is dropped from the ranking
      // (mirrors `bucketRows` with a defined level set).
    }
    return { buckets: [...buckets.values()] };
  }

  // Discover one level per distinct raw value.
  const discovered = new Map<string, LevelBucket>();
  for (const r of present) {
    const key = rawKey(r, column);
    if (key === null) continue;
    let b = discovered.get(key);
    if (!b) {
      b = { id: key, label: key, rows: [] };
      discovered.set(key, b);
    }
    b.rows.push(r);
  }
  return { buckets: [...discovered.values()] };
}

function rawValue(row: AnalyticsScoredRow, column: string): unknown {
  const i = row.inputs[column];
  if (i !== undefined && i !== null) return i;
  const o = row.outputs[column];
  return o === undefined ? null : o;
}

function rawKey(row: AnalyticsScoredRow, column: string): string | null {
  const v = rawValue(row, column);
  return v === null || v === undefined ? null : String(v);
}

function readNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function fmtNum(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
