/**
 * Brief 64 PR 64.2 / 64.3 — <DimensionDetailExhibit>.
 *
 * Opens when the user clicks a row in the Rate Drivers list. Dispatches
 * by the variable's shape to the right exhibit, composing existing
 * primitives — no new chart engine:
 *
 *   • categorical ≤ 30 levels  → <ChartPanel> ranked bars (premium-native)
 *   • categorical > 30 levels  → <FactorDistribution> (Brief 45, generalized
 *                                 for premium $ via title + valueFormatter)
 *   • numeric                  → equal-count bins (5 / 10 / 20 segmented)
 *                                 rendered through <ChartPanel>
 *   • geographic (state-mappable) → <MapPanel> choropleth (territory-aware
 *                                 when geo_territories group states) + a
 *                                 ranked <ChartPanel> below
 *   • geographic (sub-state, e.g. ZIPs) → falls back to the discrete path
 *                                 (a national state map can't represent
 *                                 within-state regions; the county/ZIP
 *                                 choropleth is a future follow-up)
 *
 * A compact KPI-aware hero (Book {kpi} · Range · Levels) sits on top.
 *
 * Single scored dataset in v1 (Overview act). The Compare act's paired
 * old-vs-new drill (64.4) passes `comparisonRows`; ChartPanel already
 * renders paired bars when a comparison is present.
 */

import { useMemo, useState, type JSX } from "react";
import { ChartPanel } from "./ChartPanel";
import { MapPanel, type MapTerritory } from "./MapPanel";
import { STATE_CODES } from "./map-data";
import { FactorDistribution } from "../FactorDistribution";
import {
  computeFactorDistribution,
  type FactorDistributionDatum,
} from "../FactorTableViz";
import type { AnalyticsKpiSpec } from "./analytics-types";
import {
  computeSliceExhibit,
  formatKpiValue,
  kpiValue,
  type AnalyticsScoredRow,
  type LevelStat,
  type SliceExhibit,
} from "./exhibit-math";
import {
  computeEqualCountBins,
  binIndexForValue,
  type EqualCountGroups,
} from "./binning";
import type { OverviewVariableSpec } from "./overview-math";
import "./DimensionDetailExhibit.css";

/** Above this level count, a discrete variable renders as a distribution. */
const DENSE_LEVEL_THRESHOLD = 30;
const BIN_OPTIONS: readonly EqualCountGroups[] = [5, 10, 20];
/** USPS codes the national choropleth can render (state granularity). */
const STATE_CODE_SET = new Set<string>(STATE_CODES);

export interface DimensionDetailExhibitProps {
  /** The drilled-into variable (from the Rate Drivers list). */
  readonly variable: OverviewVariableSpec;
  /** The scored book (baseline / current dataset). */
  readonly rows: readonly AnalyticsScoredRow[];
  /** Optional comparison dataset → ChartPanel renders paired bars (64.4). */
  readonly comparisonRows?: readonly AnalyticsScoredRow[] | null;
  /** Active KPI (the bars + ranking encode this). */
  readonly kpi: AnalyticsKpiSpec;
  readonly premiumColumn: string;
  readonly lossColumn?: string;
  /** Book-average premium — the FactorDistribution gradient pivot. */
  readonly bookAvg: number;
  readonly baselineLabel?: string;
  readonly comparisonLabel?: string;
  /** Cross-filter (geographic ↔ chart) — selected level id. */
  readonly selectedLevelId?: string | null;
  readonly onSelectLevel?: (levelId: string | null) => void;
  readonly testId?: string;
}

export function DimensionDetailExhibit(
  props: DimensionDetailExhibitProps,
): JSX.Element {
  const {
    variable,
    rows,
    comparisonRows = null,
    kpi,
    premiumColumn,
    lossColumn,
    bookAvg,
    baselineLabel = "baseline",
    comparisonLabel = "live draft",
    selectedLevelId = null,
    onSelectLevel,
    testId = "rater-dim-detail",
  } = props;

  const [groups, setGroups] = useState<EqualCountGroups>(10);
  const column = variable.column ?? variable.id;

  // Build the exhibit + render metadata for the variable's shape.
  const { exhibit, binNote, territories, isGeoMap } = useMemo(() => {
    if (variable.kind === "numeric") {
      return {
        exhibit: numericBinExhibit({
          rows,
          column,
          kpi,
          premiumColumn,
          ...(lossColumn !== undefined ? { lossColumn } : {}),
          groups,
          sliceId: variable.id,
          sliceLabel: variable.label,
        }),
        binNote: binFormedNote(rows, column, groups),
        territories: undefined as readonly MapTerritory[] | undefined,
        isGeoMap: false,
      };
    }

    // Geographic with defined territories → group rows by territory.
    const hasTerritories =
      variable.kind === "geographic" &&
      (variable.levels?.some((l) => l.match && l.match.length > 0) ?? false);

    if (hasTerritories) {
      const levels = variable.levels!;
      const exhibit = matchSliceExhibit({
        rows,
        column,
        levels,
        kpi,
        premiumColumn,
        ...(lossColumn !== undefined ? { lossColumn } : {}),
        sliceId: variable.id,
        sliceLabel: variable.label,
      });
      const territories: MapTerritory[] = levels.map((l) => ({
        id: l.id,
        label: l.label,
        members: (l.match ?? []).map((m) => m.toUpperCase()),
      }));
      const canMap = territories.some((t) =>
        t.members.some((m) => STATE_CODE_SET.has(m)),
      );
      return {
        exhibit,
        binNote: null,
        territories: canMap ? territories : undefined,
        isGeoMap: canMap,
      };
    }

    // Discrete (categorical, or geographic by raw level).
    const definedLevels =
      variable.levels && variable.levels.length > 0
        ? variable.levels.map((l) => ({ id: l.id, label: l.label }))
        : null;
    const exhibit = computeSliceExhibit({
      baselineRows: rows,
      comparisonRows: comparisonRows ?? null,
      sliceId: variable.id,
      sliceColumn: column,
      sliceLabel: variable.label,
      kpi: kpi.id,
      premiumColumn,
      ...(lossColumn !== undefined ? { lossColumn } : {}),
      definedLevels,
    });
    const isGeoMap =
      variable.kind === "geographic" &&
      exhibit.levels.some((lvl) => STATE_CODE_SET.has(lvl.id.toUpperCase()));
    return { exhibit, binNote: null, territories: undefined, isGeoMap };
  }, [variable, rows, comparisonRows, kpi, premiumColumn, lossColumn, groups, column]);

  const hero = useMemo(
    () => computeHero(rows, column, exhibit, kpi, premiumColumn, lossColumn),
    [rows, column, exhibit, kpi, premiumColumn, lossColumn],
  );

  const isDense =
    !isGeoMap &&
    variable.kind !== "numeric" &&
    exhibit.levels.length > DENSE_LEVEL_THRESHOLD;

  return (
    <section className="rater-dim-detail" data-testid={testId}>
      <header className="rater-dim-detail__head">
        <div className="rater-dim-detail__title-block">
          <h3 className="rater-dim-detail__title">{variable.label}</h3>
          <span className="rater-dim-detail__sub">
            {kpi.label} ·{" "}
            {variable.kind === "numeric"
              ? `${exhibit.levels.length} equal-count bins`
              : `${exhibit.levels.length} levels`}
          </span>
        </div>
        {variable.kind === "numeric" && (
          <div
            className="rater-dim-detail__bins"
            role="group"
            aria-label="Bin count"
          >
            {BIN_OPTIONS.map((g) => (
              <button
                key={g}
                type="button"
                className={`rater-dim-detail__bin-btn${groups === g ? " is-active" : ""}`}
                aria-pressed={groups === g}
                onClick={() => setGroups(g)}
                data-testid={`${testId}-bins-${g}`}
              >
                {g}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="rater-dim-detail__hero" data-testid={`${testId}-hero`}>
        <div className="rater-dim-detail__stat">
          <span className="rater-dim-detail__stat-label">Book {kpi.label}</span>
          <span className="rater-dim-detail__stat-val">{hero.book}</span>
        </div>
        <div className="rater-dim-detail__stat">
          <span className="rater-dim-detail__stat-label">Range across levels</span>
          <span className="rater-dim-detail__stat-val">{hero.range}</span>
        </div>
        <div className="rater-dim-detail__stat">
          <span className="rater-dim-detail__stat-label">Levels</span>
          <span className="rater-dim-detail__stat-val">{exhibit.levels.length}</span>
        </div>
      </div>

      {isGeoMap ? (
        <div className="rater-dim-detail__geo">
          <MapPanel
            exhibit={exhibit}
            kpi={kpi}
            {...(territories ? { territories } : {})}
            sliceLabelFallback={variable.label}
            selectedStateCode={selectedLevelId}
            {...(onSelectLevel ? { onSelectState: onSelectLevel } : {})}
            testId={`${testId}-map`}
          />
          <ChartPanel
            exhibit={exhibit}
            kpi={kpi}
            baselineLabel={baselineLabel}
            comparisonLabel={comparisonLabel}
            selectedLevelId={selectedLevelId}
            {...(onSelectLevel ? { onSelectLevel } : {})}
            testId={`${testId}-chart`}
          />
        </div>
      ) : isDense ? (
        <FactorDistribution
          distribution={computeFactorDistribution({
            data: levelsToData(exhibit.levels),
          })}
          baseline={bookAvg}
          title={`Distribution of ${kpi.label.toLowerCase()}`}
          valueFormatter={(v) => formatKpiValue(v, kpi.id)}
          tableLabel={variable.label}
          {...(onSelectLevel
            ? { onOutlierClick: (key: string) => onSelectLevel(key) }
            : {})}
          testId={`${testId}-distribution`}
        />
      ) : (
        <ChartPanel
          exhibit={exhibit}
          kpi={kpi}
          baselineLabel={baselineLabel}
          comparisonLabel={comparisonLabel}
          selectedLevelId={selectedLevelId}
          {...(onSelectLevel ? { onSelectLevel } : {})}
          testId={`${testId}-chart`}
        />
      )}

      {binNote && (
        <p className="rater-dim-detail__note" data-testid={`${testId}-bin-note`}>
          {binNote}
        </p>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// Internals (pure)
// ──────────────────────────────────────────────────────────────────

interface NumericBinExhibitArgs {
  readonly rows: readonly AnalyticsScoredRow[];
  readonly column: string;
  readonly kpi: AnalyticsKpiSpec;
  readonly premiumColumn: string;
  readonly lossColumn?: string;
  readonly groups: EqualCountGroups;
  readonly sliceId: string;
  readonly sliceLabel: string;
}

/** Build a SliceExhibit whose levels are equal-count bins of a numeric column. */
function numericBinExhibit(args: NumericBinExhibitArgs): SliceExhibit {
  const { rows, column, kpi, premiumColumn, lossColumn, groups, sliceId, sliceLabel } = args;
  const values: number[] = [];
  for (const r of rows) {
    const n = readNumber(rawValue(r, column));
    if (n !== null) values.push(n);
  }
  const binning = computeEqualCountBins(values, groups);
  const binRows: AnalyticsScoredRow[][] = binning.bins.map(() => []);
  for (const r of rows) {
    const n = readNumber(rawValue(r, column));
    if (n === null) continue;
    const idx = binIndexForValue(binning, n);
    if (idx >= 0) binRows[idx]!.push(r);
  }
  const levels: LevelStat[] = binning.bins.map((b, i) => ({
    id: `bin-${i}`,
    label: `${fmtNum(b.lo)}–${fmtNum(b.hi)}`,
    baselineValue: kpiValue(binRows[i]!, kpi.id, premiumColumn, lossColumn),
    comparisonValue: null,
    deltaPct: null,
    rowCount: binRows[i]!.length,
  }));
  let maxValue = 0;
  for (const l of levels) {
    if (l.baselineValue !== null && Math.abs(l.baselineValue) > maxValue) {
      maxValue = Math.abs(l.baselineValue);
    }
  }
  const sumable = kpi.id === "count" || kpi.id === "total";
  return {
    sliceId,
    sliceLabel,
    kpi: kpi.id,
    levels,
    maxValue,
    baselineTotal: sumable ? kpiValue(rows, kpi.id, premiumColumn, lossColumn) : null,
    comparisonTotal: null,
  };
}

interface MatchSliceExhibitArgs {
  readonly rows: readonly AnalyticsScoredRow[];
  readonly column: string;
  readonly levels: readonly { readonly id: string; readonly label: string; readonly match?: readonly string[] }[];
  readonly kpi: AnalyticsKpiSpec;
  readonly premiumColumn: string;
  readonly lossColumn?: string;
  readonly sliceId: string;
  readonly sliceLabel: string;
}

/**
 * Build a SliceExhibit by grouping rows into defined levels via each
 * level's `match` set (territory members / aliases). Levels are ranked
 * by value desc so the chart + map read consistently. Baseline-only
 * (the Overview act is a single dataset; the Compare drill comes in 64.4).
 */
function matchSliceExhibit(args: MatchSliceExhibitArgs): SliceExhibit {
  const { rows, column, levels, kpi, premiumColumn, lossColumn, sliceId, sliceLabel } = args;
  const matchToLevel = new Map<string, string>();
  for (const l of levels) {
    if (l.match && l.match.length > 0) {
      for (const m of l.match) matchToLevel.set(m, l.id);
    } else {
      matchToLevel.set(l.id, l.id);
    }
  }
  const byLevel = new Map<string, AnalyticsScoredRow[]>();
  for (const l of levels) byLevel.set(l.id, []);
  for (const r of rows) {
    const key = rawKey(r, column);
    if (key === null) continue;
    const lid = matchToLevel.get(key);
    if (lid !== undefined) byLevel.get(lid)!.push(r);
  }
  const stats: LevelStat[] = levels.map((l) => ({
    id: l.id,
    label: l.label,
    baselineValue: kpiValue(byLevel.get(l.id)!, kpi.id, premiumColumn, lossColumn),
    comparisonValue: null,
    deltaPct: null,
    rowCount: byLevel.get(l.id)!.length,
  }));
  stats.sort((a, b) => (b.baselineValue ?? 0) - (a.baselineValue ?? 0));
  let maxValue = 0;
  for (const s of stats) {
    if (s.baselineValue !== null && Math.abs(s.baselineValue) > maxValue) {
      maxValue = Math.abs(s.baselineValue);
    }
  }
  const sumable = kpi.id === "count" || kpi.id === "total";
  return {
    sliceId,
    sliceLabel,
    kpi: kpi.id,
    levels: stats,
    maxValue,
    baselineTotal: sumable ? kpiValue(rows, kpi.id, premiumColumn, lossColumn) : null,
    comparisonTotal: null,
  };
}

function binFormedNote(
  rows: readonly AnalyticsScoredRow[],
  column: string,
  groups: EqualCountGroups,
): string | null {
  const values: number[] = [];
  for (const r of rows) {
    const n = readNumber(rawValue(r, column));
    if (n !== null) values.push(n);
  }
  const binning = computeEqualCountBins(values, groups);
  if (binning.formed >= binning.requested) return null;
  return `${binning.requested} requested · ${binning.formed} formed — values too tied for ${binning.requested} equal-count groups.`;
}

function levelsToData(levels: readonly LevelStat[]): FactorDistributionDatum[] {
  const data: FactorDistributionDatum[] = [];
  for (const l of levels) {
    const v = l.comparisonValue ?? l.baselineValue;
    if (v === null || !Number.isFinite(v)) continue;
    data.push({ key: l.id, label: l.label, value: v });
  }
  return data;
}

interface Hero {
  readonly book: string;
  readonly range: string;
}

function computeHero(
  rows: readonly AnalyticsScoredRow[],
  column: string,
  exhibit: SliceExhibit,
  kpi: AnalyticsKpiSpec,
  premiumColumn: string,
  lossColumn: string | undefined,
): Hero {
  const present = rows.filter((r) => rawKey(r, column) !== null);
  const book = formatKpiValue(
    kpi.id === "rate_change" ? null : kpiValue(present, kpi.id, premiumColumn, lossColumn),
    kpi.id,
  );
  const vals: number[] = [];
  for (const l of exhibit.levels) {
    const v = l.comparisonValue ?? l.baselineValue;
    if (v !== null && Number.isFinite(v)) vals.push(v);
  }
  const range =
    vals.length > 0
      ? `${formatKpiValue(Math.min(...vals), kpi.id)} – ${formatKpiValue(Math.max(...vals), kpi.id)}`
      : "—";
  return { book, range };
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
