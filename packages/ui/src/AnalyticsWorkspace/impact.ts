/**
 * Brief 64 §1.2 — impact-by-variable for the Compare act.
 *
 * Baseline and comparison are the SAME book re-scored (rows aligned by
 * index — the `rerateSnapshotRows` contract), so a policy's input values
 * are identical on both sides and only its premium differs. For each
 * variable we group the (shared) policies into levels, then read each
 * level's premium under both sides → a per-level Δ%. The variable's
 * headline is the biggest-moving **well-populated** level (`maxAbsDelta`),
 * so a thin level can't crown it.
 *
 * Ranks "which variables drove the dislocation differentially." The drill
 * (per-level old-vs-new paired bars) is `<DimensionDetailExhibit>` fed a
 * `comparisonRows` — no separate chart needed here.
 *
 * Pure + deterministic. Reuses `kpiValue` + the equal-count binning.
 */

import type { AnalyticsKpiSpec } from "./analytics-types";
import { kpiValue, type AnalyticsScoredRow } from "./exhibit-math";
import {
  computeEqualCountBins,
  binIndexForValue,
  type EqualCountGroups,
} from "./binning";
import type {
  OverviewVariableSpec,
  OverviewVariableKind,
} from "./overview-math";

export interface VariableImpact {
  readonly id: string;
  readonly label: string;
  readonly kind: OverviewVariableKind;
  /** KPI over the variable's rows, each side. */
  readonly bookBaseline: number | null;
  readonly bookComparison: number | null;
  /** (comparison − baseline) / baseline over the variable's rows. */
  readonly bookDelta: number | null;
  /** Per-level Δ% extremes over well-populated levels. */
  readonly minLevelDelta: number | null;
  readonly maxLevelDelta: number | null;
  /** Biggest |Δ%| over well-populated levels (display). */
  readonly maxAbsDelta: number | null;
  /**
   * maxLevelDelta − minLevelDelta — how *differently* the variable's levels
   * moved. This is the ranking metric: a variable whose levels all moved by
   * the same amount is a base-rate shift, not a dislocation driver. Null
   * when the variable doesn't differentiate (single level / uniform move).
   */
  readonly deltaSpread: number | null;
  /** Levels with ≥ 1 policy. */
  readonly levelCount: number;
  /** Levels that met the population threshold (drive the deltas). */
  readonly rankedLevelCount: number;
  /** True when no level moved (or none well-populated). */
  readonly flat: boolean;
}

export interface ComputeImpactArgs {
  readonly baselineRows: readonly AnalyticsScoredRow[];
  readonly comparisonRows: readonly AnalyticsScoredRow[];
  readonly variables: readonly OverviewVariableSpec[];
  readonly premiumColumn: string;
  readonly kpi: AnalyticsKpiSpec;
  readonly lossColumn?: string;
  readonly minExposureFraction?: number;
  /** Equal-count bins for numeric variables. Default 10. */
  readonly binGroups?: EqualCountGroups;
}

export interface ImpactByVariableResult {
  /** Sorted by maxAbsDelta desc; flat variables last, ties by label. */
  readonly variables: readonly VariableImpact[];
}

export function computeImpactByVariable(
  args: ComputeImpactArgs,
): ImpactByVariableResult {
  const minFrac = args.minExposureFraction ?? 0.005;
  const binGroups = args.binGroups ?? 10;
  const variables = args.variables.map((v) =>
    summarize(
      v,
      args.baselineRows,
      args.comparisonRows,
      args.premiumColumn,
      args.kpi,
      args.lossColumn,
      minFrac,
      binGroups,
    ),
  );
  variables.sort((a, b) => {
    if (a.deltaSpread === null && b.deltaSpread === null) {
      return a.label.localeCompare(b.label);
    }
    if (a.deltaSpread === null) return 1;
    if (b.deltaSpread === null) return -1;
    if (b.deltaSpread !== a.deltaSpread) return b.deltaSpread - a.deltaSpread;
    return a.label.localeCompare(b.label);
  });
  return { variables };
}

// ──────────────────────────────────────────────────────────────────

function summarize(
  variable: OverviewVariableSpec,
  baselineRows: readonly AnalyticsScoredRow[],
  comparisonRows: readonly AnalyticsScoredRow[],
  premiumColumn: string,
  kpi: AnalyticsKpiSpec,
  lossColumn: string | undefined,
  minFrac: number,
  binGroups: EqualCountGroups,
): VariableImpact {
  const column = variable.column ?? variable.id;
  const n = Math.min(baselineRows.length, comparisonRows.length);

  // Group policy indices into levels (shared across both sides).
  const groups = new Map<string, number[]>();
  const push = (id: string, i: number): void => {
    const arr = groups.get(id);
    if (arr) arr.push(i);
    else groups.set(id, [i]);
  };

  if (variable.kind === "numeric") {
    const idxVals: Array<{ i: number; v: number }> = [];
    for (let i = 0; i < n; i += 1) {
      const v = readNumber(rawValue(baselineRows[i]!, column));
      if (v !== null) idxVals.push({ i, v });
    }
    const binning = computeEqualCountBins(idxVals.map((x) => x.v), binGroups);
    for (const { i, v } of idxVals) {
      const idx = binIndexForValue(binning, v);
      if (idx >= 0) push(`bin-${idx}`, i);
    }
  } else {
    const matchToLevel = buildMatch(variable.levels);
    for (let i = 0; i < n; i += 1) {
      const key = rawKey(baselineRows[i]!, column);
      if (key === null) continue;
      const lid = matchToLevel ? matchToLevel.get(key) : key;
      if (lid === undefined) continue;
      push(lid, i);
    }
  }

  // Book delta over the variable's rows.
  const presentBase: AnalyticsScoredRow[] = [];
  const presentComp: AnalyticsScoredRow[] = [];
  for (const idxs of groups.values()) {
    for (const i of idxs) {
      presentBase.push(baselineRows[i]!);
      presentComp.push(comparisonRows[i]!);
    }
  }
  const bookBaseline = kpiValue(presentBase, kpi.id, premiumColumn, lossColumn);
  const bookComparison = kpiValue(presentComp, kpi.id, premiumColumn, lossColumn);
  const bookDelta =
    bookBaseline !== null && bookComparison !== null && bookBaseline > 0
      ? bookComparison / bookBaseline - 1
      : null;

  // Per-level Δ% over well-populated levels.
  const threshold = Math.max(2, Math.ceil(minFrac * presentBase.length));
  const deltas: number[] = [];
  let levelCount = 0;
  for (const idxs of groups.values()) {
    if (idxs.length > 0) levelCount += 1;
    if (idxs.length < threshold) continue;
    const b = kpiValue(idxs.map((i) => baselineRows[i]!), kpi.id, premiumColumn, lossColumn);
    const c = kpiValue(idxs.map((i) => comparisonRows[i]!), kpi.id, premiumColumn, lossColumn);
    if (b !== null && c !== null && b > 0) deltas.push(c / b - 1);
  }

  const rankedLevelCount = deltas.length;
  const minLevelDelta = deltas.length ? Math.min(...deltas) : null;
  const maxLevelDelta = deltas.length ? Math.max(...deltas) : null;
  const maxAbsDelta = deltas.length
    ? Math.max(...deltas.map((d) => Math.abs(d)))
    : null;
  const spread =
    minLevelDelta !== null && maxLevelDelta !== null
      ? maxLevelDelta - minLevelDelta
      : null;
  // Differentiates premium-change only when its levels moved differently.
  const flat = rankedLevelCount < 1 || (spread !== null && spread < 1e-9);

  return {
    id: variable.id,
    label: variable.label,
    kind: variable.kind,
    bookBaseline,
    bookComparison,
    bookDelta,
    minLevelDelta,
    maxLevelDelta,
    maxAbsDelta,
    deltaSpread: flat ? null : spread,
    levelCount,
    rankedLevelCount,
    flat,
  };
}

function buildMatch(
  levels: OverviewVariableSpec["levels"],
): Map<string, string> | null {
  if (!levels || levels.length === 0) return null;
  const m = new Map<string, string>();
  for (const l of levels) {
    if (l.match && l.match.length > 0) {
      for (const k of l.match) m.set(k, l.id);
    } else {
      m.set(l.id, l.id);
    }
  }
  return m;
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
