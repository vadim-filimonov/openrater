/**
 * <ChartPanel> — Brief 43 PR 43.4 chart exhibit.
 *
 * Row-based ranked chart with paired baseline/comparison bars per
 * slice level. Each row reads:
 *
 *     [rank][label][bar-wrap][value][delta%]
 *
 * Bar-wrap holds two stacked half-height bars (baseline top,
 * comparison bottom). Scaling is shared across rows via the
 * `maxValue` from the SliceExhibit so the actuary can read magnitudes
 * across levels at a glance.
 *
 * v1 (PR 43.4) is presentation-only — click handlers and the
 * cross-filter highlight land in PR 43.6.
 *
 * Matches the mockup at
 * `rate-lab/frontend/public/mockup/43-analytics-workspace.html` —
 * same grid columns (36px / 1fr / 70px / 36px), same paired-bar
 * layout, same value + delta column formats.
 */

import type { JSX } from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@openrater/design-system";
import type { AnalyticsKpiSpec } from "./analytics-types";
import {
  deltaTone,
  formatDeltaPct,
  formatKpiValue,
  type LevelStat,
  type SliceExhibit,
} from "./exhibit-math";
import "./ChartPanel.css";

export interface ChartPanelProps {
  /**
   * The computed exhibit. When null the panel renders a small empty
   * state — "no data for this slice yet." Parent decides whether to
   * pass null (e.g. the score-all bridge hasn't populated yet).
   */
  readonly exhibit: SliceExhibit | null;
  readonly kpi: AnalyticsKpiSpec;
  /** Human-readable label for the active comparison (e.g. "live draft"). */
  readonly comparisonLabel: string;
  /** Human-readable label for the active baseline (e.g. "filed_2026_q3"). */
  readonly baselineLabel: string;
  /**
   * Fallback slice label for the header when `exhibit` is null. Lets
   * the empty state still tell the user which variable is selected
   * upstream — even when the data hasn't arrived yet.
   */
  readonly sliceLabelFallback?: string;
  /**
   * Brief 43 PR 43.6.b — cross-filter wiring.
   *
   * The id of the level currently filtered "into" (chart click was
   * the source). When set, the matching row gets the `matched` ring
   * and other rows fade. Independent from the map's selected state
   * (the parent enforces mutual exclusion).
   */
  readonly selectedLevelId?: string | null;
  /**
   * Fired when the user clicks a row. The parent toggles
   * `selectedLevelId` — click the active row again to clear.
   */
  readonly onSelectLevel?: (levelId: string | null) => void;
  readonly testId?: string;
}

export function ChartPanel(props: ChartPanelProps): JSX.Element {
  const {
    exhibit,
    kpi,
    comparisonLabel,
    baselineLabel,
    sliceLabelFallback,
    selectedLevelId,
    onSelectLevel,
    testId = "rater-analytics-chart",
  } = props;
  const activeLevelId = selectedLevelId ?? null;

  if (!exhibit || exhibit.levels.length === 0) {
    return (
      <div className="rater-analytics-chart" data-testid={testId}>
        <ChartHeader
          sliceLabel={exhibit?.sliceLabel ?? sliceLabelFallback ?? "—"}
          kpiLabel={kpi.label}
          baselineLabel={baselineLabel}
          comparisonLabel={comparisonLabel}
        />
        <div
          className="rater-analytics-chart__empty"
          data-testid={`${testId}-empty`}
        >
          <EmptyState
            icon={<BarChart3 size={24} />}
            title="No data for this slice yet"
            description="Run Score all on Inputs to populate the chart, then pick a slice variable above."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rater-analytics-chart" data-testid={testId}>
      <ChartHeader
        sliceLabel={exhibit.sliceLabel}
        kpiLabel={kpi.label}
        baselineLabel={baselineLabel}
        comparisonLabel={comparisonLabel}
      />
      <div
        className="rater-analytics-chart__axis"
        aria-hidden
      >
        <span className="rater-analytics-chart__axis-cell rater-analytics-chart__axis-cell--rank">
          #
        </span>
        <span className="rater-analytics-chart__axis-cell">level</span>
        <span className="rater-analytics-chart__axis-cell">{kpi.label}</span>
        <span className="rater-analytics-chart__axis-cell">value</span>
        <span className="rater-analytics-chart__axis-cell">Δ%</span>
      </div>
      <div
        className="rater-analytics-chart__rows"
        role="list"
        aria-label={`Levels ranked by ${kpi.label}`}
      >
        {exhibit.levels.map((level, idx) => (
          <ChartRow
            key={level.id}
            rank={idx + 1}
            level={level}
            kpi={kpi}
            maxValue={exhibit.maxValue}
            hasComparison={
              exhibit.levels.some((l) => l.comparisonValue !== null)
            }
            isSelected={activeLevelId === level.id}
            isDimmed={activeLevelId !== null && activeLevelId !== level.id}
            {...(onSelectLevel
              ? {
                  onClick: () =>
                    onSelectLevel(
                      activeLevelId === level.id ? null : level.id,
                    ),
                }
              : {})}
            testId={`${testId}-row-${level.id}`}
          />
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────────

interface ChartHeaderProps {
  readonly sliceLabel: string;
  readonly kpiLabel: string;
  readonly baselineLabel: string;
  readonly comparisonLabel: string;
}

function ChartHeader(props: ChartHeaderProps): JSX.Element {
  return (
    <header className="rater-analytics-chart__header">
      <div className="rater-analytics-chart__title-block">
        <span
          className="rater-analytics-chart__title-icon"
          aria-hidden
        >
          <BarChart3 size={14} />
        </span>
        <h2 className="rater-analytics-chart__title">
          {props.kpiLabel} by {props.sliceLabel}
        </h2>
      </div>
      <div
        className="rater-analytics-chart__legend"
        aria-label="Bar series"
      >
        <span className="rater-analytics-chart__legend-item">
          <span className="rater-analytics-chart__legend-dot rater-analytics-chart__legend-dot--baseline" />
          {props.baselineLabel}
        </span>
        <span className="rater-analytics-chart__legend-item">
          <span className="rater-analytics-chart__legend-dot rater-analytics-chart__legend-dot--comparison" />
          {props.comparisonLabel}
        </span>
      </div>
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────
// Row
// ──────────────────────────────────────────────────────────────────

interface ChartRowProps {
  readonly rank: number;
  readonly level: LevelStat;
  readonly kpi: AnalyticsKpiSpec;
  readonly maxValue: number;
  readonly hasComparison: boolean;
  readonly isSelected: boolean;
  readonly isDimmed: boolean;
  readonly onClick?: () => void;
  readonly testId: string;
}

function ChartRow(props: ChartRowProps): JSX.Element {
  const {
    rank,
    level,
    kpi,
    maxValue,
    hasComparison,
    isSelected,
    isDimmed,
    onClick,
    testId,
  } = props;

  // Bar widths as % of the chart's max value. Clamp to [0, 100].
  const barPct = (value: number | null): number => {
    if (value === null || maxValue <= 0) return 0;
    const pct = (Math.abs(value) / maxValue) * 100;
    return Math.min(100, Math.max(0, pct));
  };

  const tone = deltaTone(level.deltaPct);
  const valueText = formatKpiValue(
    level.comparisonValue ?? level.baselineValue,
    kpi.id,
  );

  return (
    <div
      className="rater-analytics-chart__row"
      role="listitem"
      data-testid={testId}
      data-row-id={level.id}
      data-selected={isSelected ? "true" : undefined}
      data-dimmed={isDimmed ? "true" : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      tabIndex={onClick ? 0 : -1}
      aria-pressed={onClick ? isSelected : undefined}
    >
      <span className="rater-analytics-chart__rank">{rank}</span>
      <span className="rater-analytics-chart__label" title={level.label}>
        {level.label}
      </span>
      <span
        className="rater-analytics-chart__bar-wrap"
        aria-hidden
      >
        {level.baselineValue !== null ? (
          <span
            className={
              hasComparison
                ? "rater-analytics-chart__bar rater-analytics-chart__bar--baseline rater-analytics-chart__bar--paired"
                : "rater-analytics-chart__bar rater-analytics-chart__bar--baseline"
            }
            style={{ width: `${barPct(level.baselineValue)}%` }}
          />
        ) : null}
        {level.comparisonValue !== null && hasComparison ? (
          <span
            className="rater-analytics-chart__bar rater-analytics-chart__bar--comparison rater-analytics-chart__bar--paired"
            style={{ width: `${barPct(level.comparisonValue)}%` }}
          />
        ) : null}
      </span>
      <span
        className="rater-analytics-chart__value"
        data-testid={`${testId}-value`}
      >
        {valueText}
      </span>
      <span
        className={`rater-analytics-chart__delta rater-analytics-chart__delta--${tone}`}
        data-testid={`${testId}-delta`}
      >
        {formatDeltaPct(level.deltaPct)}
      </span>
    </div>
  );
}
