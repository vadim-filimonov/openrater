/**
 * <MapPanel> — Brief 43 PR 43.5 map exhibit (Brief 44 PR 44.8 upgrade,
 * Brief 64 PR 64.3 territory mode).
 *
 * The tile-grid placeholder shipped in Brief 43 (ADR-0018 anticipated
 * the swap) is now powered by <UsChoropleth> (maps next-gen — the
 * d3-geo Albers SVG that replaced the MapLibre GeoMapEditor). It draws
 * all 51 state polygons, tinted by the same 7-bucket choropleth that
 * keyed the original tile grid — the bucket math is unchanged; the
 * legend is now the value-break <ChoroplethScaleLegend>.
 *
 * Two modes:
 *   • State mode (default) — `exhibit` is keyed by USPS code; each state
 *     polygon is tinted by its own bucket; the chip rail lists 51 states.
 *   • Territory mode (Brief 64 — pass `territories`) — `exhibit` is keyed
 *     by territory id; every member state's polygon takes its TERRITORY's
 *     bucket color, and the chip rail lists the defined territories. This
 *     honors a geographic dimension's `geo_territories` grouping
 *     (Brief 44 model) so the map reads "by territory," not raw state.
 *
 * Cross-filter (PR 43.6.b) — clicks on map polygons / chips emit the
 * level id (state code, or territory id in territory mode) via
 * `onSelectState`. A compact chip rail below the canvas mirrors the
 * selection with real DOM buttons so keyboard users + screen readers +
 * headless tests have first-class affordances (the canvas is a single
 * WebGL surface — every cell on top would otherwise be invisible to AT).
 */

import { useMemo, type JSX } from "react";
import { Map as MapIcon } from "lucide-react";
import { EmptyState } from "@openrater/design-system";
import { UsChoropleth } from "../UsChoropleth";
import type { AnalyticsKpiSpec } from "./analytics-types";
import {
  formatKpiValue,
  type LevelStat,
  type SliceExhibit,
} from "./exhibit-math";
import {
  BUCKET_TO_COLOR,
  bucketMap,
  divergingColor,
  DIVERGING_RAMP,
  SEQUENTIAL_RAMP,
  type ChoroplethBucket,
} from "./map-bucket";
import { ChoroplethScaleLegend } from "./ChoroplethScaleLegend";
import { STATE_CODES } from "./map-data";
import "./MapPanel.css";

/**
 * KPIs whose sign carries valence (a decrease is "good", an increase is
 * "bad") read better on a DIVERGING ramp than the sequential azure→cyan. The
 * bucket math already centers bucket 0 on the book average for these relative
 * measures, so the emerald↓/orange↑ split lands at the book center.
 */
const DIVERGING_KPIS = new Set(["rate_change", "lr"]);

/** A defined territory — a named bucket of geo levels (Brief 44 model). */
export interface MapTerritory {
  readonly id: string;
  readonly label: string;
  /** Member USPS state codes that take this territory's color. */
  readonly members: readonly string[];
}

export interface MapPanelProps {
  /**
   * The geographic exhibit. State mode: one row per USPS code. Territory
   * mode (when `territories` is set): one row per territory id. When null
   * the panel shows the empty state.
   */
  readonly exhibit: SliceExhibit | null;
  readonly kpi: AnalyticsKpiSpec;
  /** Fallback for the header subtitle when exhibit is null. */
  readonly sliceLabelFallback?: string;
  /**
   * Brief 64 — when set, render in TERRITORY mode: color each member
   * state's polygon by its territory's bucket + list territories in the
   * chip rail. Built from the geo dim's `geo_territories`.
   */
  readonly territories?: readonly MapTerritory[];
  /**
   * Brief 43 PR 43.6.b — cross-filter wiring. The level id currently
   * filtered "into" (state code, or territory id in territory mode).
   */
  readonly selectedStateCode?: string | null;
  /**
   * Fired when the user clicks a polygon or chip. The parent toggles the
   * selection — click the active one again to clear. Emits the level id
   * (territory id in territory mode).
   */
  readonly onSelectState?: (levelId: string | null) => void;
  /**
   * V2 — when the plan rates a SINGLE state, fit the map to it instead of
   * the national view. Multi-state / undefined keeps the national choropleth.
   */
  readonly focusState?: string;
  readonly testId?: string;
}

// The canonical bucket→hex ramp is shared from map-bucket (Brief 71).

interface ChipModel {
  readonly id: string;
  readonly label: string;
  readonly bucket: ChoroplethBucket;
  readonly stat: LevelStat | null;
}

export function MapPanel(props: MapPanelProps): JSX.Element {
  const {
    exhibit,
    kpi,
    sliceLabelFallback,
    territories,
    selectedStateCode,
    onSelectState,
    focusState,
    testId = "rater-analytics-map",
  } = props;
  const activeId = selectedStateCode ?? null;
  const focus = focusState ? focusState.toUpperCase() : null;
  const isTerritoryMode = (territories?.length ?? 0) > 0;
  const isDiverging = DIVERGING_KPIS.has(kpi.id);

  // Level id → LevelStat. Territory ids stay as-authored; state codes
  // uppercase to match the polygon ids.
  const statById = useMemo<Map<string, LevelStat>>(() => {
    const map = new Map<string, LevelStat>();
    if (!exhibit) return map;
    for (const level of exhibit.levels) {
      map.set(isTerritoryMode ? level.id : level.id.toUpperCase(), level);
    }
    return map;
  }, [exhibit, isTerritoryMode]);

  // Bucket each level (territory or state) by its comparison/baseline value.
  const bucketByLevel = useMemo<Map<string, ChoroplethBucket>>(() => {
    if (!exhibit) return new Map();
    const valueByLevel = new Map<string, number | null>();
    for (const lvl of exhibit.levels) {
      const v = lvl.comparisonValue ?? lvl.baselineValue;
      valueByLevel.set(isTerritoryMode ? lvl.id : lvl.id.toUpperCase(), v);
    }
    return bucketMap(valueByLevel, kpi.id);
  }, [exhibit, kpi.id, isTerritoryMode]);

  // Polygon tints (state code → hex). In territory mode every member state
  // takes its territory's color; in state mode each state takes its own.
  // Signed KPIs (rate change, loss ratio) use the diverging ramp.
  const tints = useMemo<Map<string, string>>(() => {
    const colorOf = (b: ChoroplethBucket): string =>
      isDiverging ? divergingColor(b) : BUCKET_TO_COLOR[b];
    const m = new Map<string, string>();
    if (isTerritoryMode && territories) {
      for (const t of territories) {
        const color = colorOf(bucketByLevel.get(t.id) ?? 0);
        for (const member of t.members) m.set(member.toUpperCase(), color);
      }
    } else {
      for (const [code, bucket] of bucketByLevel) m.set(code, colorOf(bucket));
    }
    return m;
  }, [bucketByLevel, isTerritoryMode, territories, isDiverging]);

  // The displayed value range (+ book mean), for the value-break legend.
  // The mean doubles as the diverging baseline — it's where the bucket math
  // centers bucket 0 for relative KPIs, so the color split lands there.
  const domain = useMemo<{ min: number; max: number; mean: number }>(() => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let n = 0;
    if (exhibit) {
      for (const lvl of exhibit.levels) {
        const v = lvl.comparisonValue ?? lvl.baselineValue;
        if (v != null && Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
          sum += v;
          n += 1;
        }
      }
    }
    return { min, max, mean: n > 0 ? sum / n : 0 };
  }, [exhibit]);

  // State code → owning level id, so a polygon click resolves to its
  // territory in territory mode (identity in state mode via the fallback).
  const stateToLevel = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    if (isTerritoryMode && territories) {
      for (const t of territories) {
        for (const member of t.members) m.set(member.toUpperCase(), t.id);
      }
    }
    return m;
  }, [isTerritoryMode, territories]);

  // State USPS → value, for the map's hover tooltip. In territory mode each
  // member state surfaces its TERRITORY's value (which is what its color shows).
  const valueByState = useMemo<Map<string, number | null>>(() => {
    const m = new Map<string, number | null>();
    if (!exhibit) return m;
    if (isTerritoryMode && territories) {
      for (const t of territories) {
        const stat = statById.get(t.id);
        const v = stat ? stat.comparisonValue ?? stat.baselineValue : null;
        for (const member of t.members) m.set(member.toUpperCase(), v);
      }
    } else {
      for (const lvl of exhibit.levels) m.set(lvl.id.toUpperCase(), lvl.comparisonValue ?? lvl.baselineValue);
    }
    return m;
  }, [exhibit, isTerritoryMode, territories, statById]);

  // Chip rail models — territories or all 51 states.
  const chips = useMemo<ChipModel[]>(() => {
    if (isTerritoryMode && territories) {
      return territories.map((t) => ({
        id: t.id,
        label: t.label,
        bucket: bucketByLevel.get(t.id) ?? 0,
        stat: statById.get(t.id) ?? null,
      }));
    }
    return STATE_CODES.map((code) => ({
      id: code,
      label: code,
      bucket: bucketByLevel.get(code) ?? 0,
      stat: statById.get(code) ?? null,
    }));
  }, [isTerritoryMode, territories, bucketByLevel, statById]);

  const hasData = exhibit !== null && exhibit.levels.length > 0;
  const sliceLabel =
    exhibit?.sliceLabel ?? sliceLabelFallback ?? "geographic";
  // GeoMapEditor highlights a single polygon — meaningful only in state
  // mode (a territory spans many states; the selected chip carries it there).
  const mapSelected = !isTerritoryMode && activeId !== null ? activeId : null;

  return (
    <div
      className="rater-analytics-map"
      data-testid={testId}
      data-state={hasData ? "ready" : "empty"}
      data-mode={isTerritoryMode ? "territory" : "state"}
    >
      <header className="rater-analytics-map__header">
        <div className="rater-analytics-map__title-block">
          <span className="rater-analytics-map__title-icon" aria-hidden>
            <MapIcon size={14} />
          </span>
          <h2 className="rater-analytics-map__title">
            {kpi.label} by {sliceLabel}
          </h2>
        </div>
        {hasData && (
          <ChoroplethScaleLegend
            ramp={isDiverging ? DIVERGING_RAMP : SEQUENTIAL_RAMP}
            min={domain.min}
            max={domain.max}
            diverging={isDiverging}
            baseline={domain.mean}
            formatValue={(v) => formatKpiValue(v, kpi.id)}
            testId={`${testId}-legend`}
          />
        )}
      </header>
      {hasData ? (
        <div
          className="rater-analytics-map__body"
          data-testid={`${testId}-body`}
        >
          <div className="rater-analytics-map__canvas-wrap">
            <UsChoropleth
              granularity="state"
              geographicContext
              {...(focus ? { focusState: focus } : {})}
              colorById={tints}
              valueById={valueByState}
              formatValue={(v) => formatKpiValue(v, kpi.id)}
              metricLabel={kpi.label}
              {...(mapSelected !== null ? { selectedId: mapSelected } : {})}
              {...(onSelectState
                ? {
                    onSelect: (code: string) => {
                      const levelId = isTerritoryMode
                        ? stateToLevel.get(code.toUpperCase()) ?? code
                        : code;
                      onSelectState(activeId === levelId ? null : levelId);
                    },
                  }
                : {})}
              testId={`${testId}-canvas`}
              ariaLabel={
                isTerritoryMode
                  ? "Territory choropleth map"
                  : "State choropleth map"
              }
            />
          </div>
          <ul
            className="rater-analytics-map__chip-rail"
            data-testid={`${testId}-chip-rail`}
            aria-label={isTerritoryMode ? "Filter by territory" : "Filter by state"}
          >
            {chips.map((chip) => (
              <LevelChip
                key={chip.id}
                id={chip.id}
                label={chip.label}
                stat={chip.stat}
                bucket={chip.bucket}
                kpi={kpi}
                isDiverging={isDiverging}
                isSelected={activeId === chip.id}
                isDimmed={activeId !== null && activeId !== chip.id}
                {...(onSelectState
                  ? {
                      onClick: () =>
                        onSelectState(activeId === chip.id ? null : chip.id),
                    }
                  : {})}
                testId={`${testId}-cell-${chip.id}`}
              />
            ))}
          </ul>
        </div>
      ) : (
        <div
          className="rater-analytics-map__empty"
          data-testid={`${testId}-empty`}
        >
          <EmptyState
            icon={<MapIcon size={24} />}
            title="No geographic data"
            description="Map a state / territory dim on Inputs + run Score all. The map tints each region by the active KPI."
          />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Level chip — paired affordance to the map canvas (state OR territory).
//
// The MapLibre canvas is a single WebGL surface — DOM-level testids +
// screen-reader announcements aren't possible there. The chip rail is the
// keyboard/AT/test contract for cross-filter selection. The map's
// `onLevelClick` and these chips fire the same parent callback.
// ──────────────────────────────────────────────────────────────────

interface LevelChipProps {
  readonly id: string;
  readonly label: string;
  readonly stat: LevelStat | null;
  readonly bucket: ChoroplethBucket;
  readonly kpi: AnalyticsKpiSpec;
  /** Signed KPI → tint the chip from the diverging ramp (match the map). */
  readonly isDiverging: boolean;
  readonly isSelected: boolean;
  readonly isDimmed: boolean;
  readonly onClick?: () => void;
  readonly testId: string;
}

function LevelChip(props: LevelChipProps): JSX.Element {
  const { id, label, stat, bucket, kpi, isDiverging, isSelected, isDimmed, onClick } = props;
  const value = stat?.comparisonValue ?? stat?.baselineValue ?? null;
  const hasValue = value !== null;
  const title = hasValue
    ? `${label} · ${kpi.label}: ${formatKpiValue(value, kpi.id)}`
    : `${label} · no data`;
  return (
    <button
      type="button"
      className="rater-analytics-map__chip"
      data-testid={props.testId}
      data-level-id={id}
      data-bucket={bucket}
      data-diverging={isDiverging ? "true" : undefined}
      data-has-value={hasValue ? "true" : "false"}
      data-selected={isSelected ? "true" : undefined}
      data-dimmed={isDimmed ? "true" : undefined}
      title={title}
      aria-label={title}
      aria-pressed={onClick ? isSelected : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
