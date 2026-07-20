/**
 * Brief 64 PR 64.2 — <RateDriversList>.
 *
 * The Overview's primary surface: a plan-agnostic, impact-ranked
 * "sensitivity tornado". One compact row per rated variable, sorted by how
 * much it swings premium across its levels (§5.0), biggest driver on top.
 * Each row is a horizontal range bar anchored at the book-average premium,
 * spanning the variable's lowest- → highest-premium level, gradient-tinted
 * (azure→orange = below→above average via `factorGradient`).
 *
 * Scales to dozens of variables: search + type-filter chips + sort + a
 * top-N / show-all expander. Click a row → the consumer opens the
 * type-adaptive detail exhibit (`<DimensionDetailExhibit>`).
 *
 * Pure presentation. Consumes the `VariableOverview[]` from
 * `computePlanOverview` directly — no recompute here.
 */

import { useMemo, useState, type CSSProperties, type JSX } from "react";
import type { VariableOverview, OverviewVariableKind } from "../AnalyticsWorkspace/overview-math";
import { factorGradient } from "../FactorTableViz/colorRamp";
import "./RateDriversList.css";

export type RateDriverSort = "impact" | "share" | "name" | "type";

export interface RateDriversListProps {
  /** Per-variable summaries from `computePlanOverview`. */
  readonly variables: readonly VariableOverview[];
  /** Book-average premium — the bar anchor tick + the gradient pivot. */
  readonly bookAvg: number;
  /** KPI label for the header (e.g. "Avg premium"). */
  readonly kpiLabel: string;
  /** Formats a KPI value for the range column (e.g. `formatKpiValue` bound to the kpi). */
  readonly formatValue: (value: number | null) => string;
  /** The currently drilled-into variable (highlighted). */
  readonly selectedId?: string | null;
  /** Fires when the user clicks a row → open its detail exhibit. */
  readonly onSelect?: (variableId: string) => void;
  /** Rows shown before the "Show all" expander. Default 8. */
  readonly topN?: number;
  readonly testId?: string;
}

const KIND_LABEL: Readonly<Record<OverviewVariableKind, string>> = {
  categorical: "categorical",
  numeric: "continuous",
  geographic: "geographic",
};

type TypeFilter = "all" | OverviewVariableKind;
const TYPE_FILTERS: readonly TypeFilter[] = [
  "all",
  "categorical",
  "numeric",
  "geographic",
];

export function RateDriversList(props: RateDriversListProps): JSX.Element {
  const {
    variables,
    bookAvg,
    kpiLabel,
    formatValue,
    selectedId = null,
    onSelect,
    topN = 8,
    testId = "rater-rate-drivers",
  } = props;

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<RateDriverSort>("impact");
  const [showAll, setShowAll] = useState(false);

  // Bar domain: the largest per-level value across all variables (same KPI,
  // so the scale is shared) → bars are comparable row-to-row.
  const domainMax = useMemo(() => {
    let m = 0;
    for (const v of variables) {
      if (v.maxLevel !== null && v.maxLevel > m) m = v.maxLevel;
    }
    return m;
  }, [variables]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variables.filter((v) => {
      if (typeFilter !== "all" && v.kind !== typeFilter) return false;
      if (q.length > 0 && !v.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [variables, query, typeFilter]);

  const sorted = useMemo(() => sortVariables(filtered, sort), [filtered, sort]);

  const visible = showAll ? sorted : sorted.slice(0, topN);
  const hiddenCount = sorted.length - visible.length;
  const avgPct = domainMax > 0 ? clampPct((bookAvg / domainMax) * 100) : 0;

  return (
    <section
      className="rater-rate-drivers"
      data-testid={testId}
      aria-label="Rate drivers"
    >
      <div className="rater-rate-drivers__toolbar">
        <span className="rater-rate-drivers__search">
          <SearchGlyph />
          <input
            type="search"
            className="rater-rate-drivers__search-input"
            placeholder={`Search ${variables.length} variables…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search variables"
            data-testid={`${testId}-search`}
          />
        </span>
        <div
          className="rater-rate-drivers__chips"
          role="group"
          aria-label="Filter by type"
        >
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              type="button"
              className={`rater-rate-drivers__chip${typeFilter === t ? " is-active" : ""}`}
              aria-pressed={typeFilter === t}
              onClick={() => setTypeFilter(t)}
              data-testid={`${testId}-chip-${t}`}
            >
              {t === "all" ? "All" : KIND_LABEL[t]}
            </button>
          ))}
        </div>
        <label className="rater-rate-drivers__sort">
          <span className="rater-rate-drivers__sort-label">Sort</span>
          <select
            className="rater-rate-drivers__sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as RateDriverSort)}
            aria-label="Sort variables"
            data-testid={`${testId}-sort`}
          >
            <option value="impact">Impact</option>
            <option value="share">Premium share</option>
            <option value="name">Name</option>
            <option value="type">Type</option>
          </select>
        </label>
      </div>

      <div className="rater-rate-drivers__head" aria-hidden="true">
        <span>#</span>
        <span>Variable</span>
        <span>Premium spread · bar at book avg {formatValue(bookAvg)}</span>
        <span className="rater-rate-drivers__col-r">Range</span>
        <span className="rater-rate-drivers__col-r">Swing</span>
      </div>

      <ol className="rater-rate-drivers__rows">
        {visible.map((v, i) => {
          const isFlat = v.flat || v.minLevel === null || v.maxLevel === null;
          return (
            <li key={v.id} className="rater-rate-drivers__li">
              <button
                type="button"
                className={`rater-rate-drivers__row${v.id === selectedId ? " is-selected" : ""}`}
                onClick={() => onSelect?.(v.id)}
                aria-label={driverAriaLabel(v, formatValue)}
                data-testid={`${testId}-row-${v.id}`}
              >
                <span className="rater-rate-drivers__rank">{i + 1}</span>
                <span className="rater-rate-drivers__id">
                  <span className="rater-rate-drivers__name">{v.label}</span>
                  <span
                    className={`rater-rate-drivers__kind rater-rate-drivers__kind--${v.kind}`}
                  >
                    {KIND_LABEL[v.kind]}
                  </span>
                  <span className="rater-rate-drivers__lvls">
                    {v.levelCount} {v.levelCount === 1 ? "level" : "levels"}
                  </span>
                </span>
                <span className="rater-rate-drivers__track">
                  {isFlat ? (
                    <span className="rater-rate-drivers__flat">
                      doesn’t differentiate premium
                    </span>
                  ) : (
                    <>
                      <span
                        className="rater-rate-drivers__avg"
                        style={{ left: `${avgPct}%` }}
                        aria-hidden="true"
                      />
                      <span
                        className="rater-rate-drivers__bar"
                        style={barStyle(v.minLevel!, v.maxLevel!, domainMax, bookAvg)}
                      />
                    </>
                  )}
                </span>
                <span className="rater-rate-drivers__range rater-rate-drivers__col-r">
                  {isFlat
                    ? "—"
                    : `${formatValue(v.minLevel)}–${formatValue(v.maxLevel)}`}
                </span>
                <span className="rater-rate-drivers__swing rater-rate-drivers__col-r">
                  {v.swing === null ? "—" : formatSwing(v.swing)}
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li
            className="rater-rate-drivers__empty"
            data-testid={`${testId}-empty`}
          >
            No variables match this filter.
          </li>
        )}
      </ol>

      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          className="rater-rate-drivers__more"
          onClick={() => setShowAll(true)}
          data-testid={`${testId}-show-all`}
        >
          Show all {sorted.length} variables
        </button>
      )}
      {showAll && sorted.length > topN && (
        <button
          type="button"
          className="rater-rate-drivers__more"
          onClick={() => setShowAll(false)}
          data-testid={`${testId}-show-less`}
        >
          Show top {topN}
        </button>
      )}
      {/* Header KPI hint for screen readers — the bars encode this KPI. */}
      <span className="rater-rate-drivers__sr-only">Ranked by {kpiLabel} spread.</span>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// Helpers (pure)
// ──────────────────────────────────────────────────────────────────

export function sortVariables(
  variables: readonly VariableOverview[],
  sort: RateDriverSort,
): VariableOverview[] {
  const arr = [...variables];
  arr.sort((a, b) => {
    switch (sort) {
      case "impact": {
        if (a.swing === null && b.swing === null) return a.label.localeCompare(b.label);
        if (a.swing === null) return 1;
        if (b.swing === null) return -1;
        if (b.swing !== a.swing) return b.swing - a.swing;
        return a.label.localeCompare(b.label);
      }
      case "share":
        if (b.total !== a.total) return b.total - a.total;
        return a.label.localeCompare(b.label);
      case "name":
        return a.label.localeCompare(b.label);
      case "type":
        return a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label);
    }
  });
  return arr;
}

function barStyle(
  minLevel: number,
  maxLevel: number,
  domainMax: number,
  bookAvg: number,
): CSSProperties {
  const lo = domainMax > 0 ? clampPct((minLevel / domainMax) * 100) : 0;
  const hi = domainMax > 0 ? clampPct((maxLevel / domainMax) * 100) : 0;
  const width = Math.max(hi - lo, 1.5);
  return {
    left: `${lo}%`,
    width: `${width}%`,
    backgroundImage: `linear-gradient(90deg, ${factorGradient(minLevel, bookAvg)}, ${factorGradient(maxLevel, bookAvg)})`,
  };
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

export function formatSwing(swing: number): string {
  if (!Number.isFinite(swing)) return "—";
  if (swing >= 100) return `${Math.round(swing)}×`;
  if (swing >= 10) return `${swing.toFixed(0)}×`;
  return `${swing.toFixed(1)}×`;
}

function driverAriaLabel(
  v: VariableOverview,
  formatValue: (value: number | null) => string,
): string {
  if (v.flat || v.swing === null || v.minLevel === null || v.maxLevel === null) {
    return `${v.label}, ${KIND_LABEL[v.kind]}, does not differentiate premium`;
  }
  return `${v.label}, ${KIND_LABEL[v.kind]}, ${v.levelCount} levels, premium ${formatValue(
    v.minLevel,
  )} to ${formatValue(v.maxLevel)}, ${formatSwing(v.swing)} swing`;
}

function SearchGlyph(): JSX.Element {
  return (
    <svg
      className="rater-rate-drivers__search-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
