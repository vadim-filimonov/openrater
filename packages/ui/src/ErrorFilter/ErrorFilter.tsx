/**
 * <ErrorFilter> — filter chip strip for the unified error drawer.
 *
 * Brief 13 P-UE7 — multi-select filters along three axes:
 *   - severity (error / warning / info)
 *   - source (compile / runtime / authoring / reference / conformance)
 *   - section (1-N — only sections that have issues in the current
 *     list are shown)
 *
 * Each axis is its own chip row; selecting multiple chips within an
 * axis broadens the match (OR within axis); across axes the filters
 * AND together. Empty selection in an axis means "all" for that axis
 * (no filter applied).
 *
 *   <ErrorFilter
 *     issues={issues}
 *     filters={filters}
 *     onFiltersChange={setFilters}
 *   />
 *
 * The component computes per-chip counts from `issues` so the user
 * sees "⊖ 3 errors" / "compile (2)" / "Rating Chains (4)" at a
 * glance.
 *
 * BEM:
 *   .rater-error-filter
 *   .rater-error-filter__row
 *   .rater-error-filter__row-label
 *   .rater-error-filter__chip
 *   .rater-error-filter__chip--active
 */

import { useMemo, type ReactNode } from "react";
import type {
  Issue,
  IssueSeverity,
  IssueSource,
} from "@openrater/contracts";
import { ISSUE_SEVERITIES, ISSUE_SOURCES, PLAN_SECTIONS_BY_ID } from "@openrater/contracts";
import { IssueSeverityChip } from "../IssueSeverityChip/IssueSeverityChip";
import "./ErrorFilter.css";

export interface ErrorFilterState {
  /** When non-empty, only issues whose severity is in this set match. */
  readonly severities: ReadonlySet<IssueSeverity>;
  /** When non-empty, only issues whose source is in this set match. */
  readonly sources: ReadonlySet<IssueSource>;
  /** When non-empty, only issues whose section is in this set match. */
  readonly sections: ReadonlySet<string>;
}

export const EMPTY_FILTER_STATE: ErrorFilterState = Object.freeze({
  severities: new Set<IssueSeverity>(),
  sources: new Set<IssueSource>(),
  sections: new Set<string>(),
});

export interface ErrorFilterProps {
  /** The full issue list. Used to compute per-chip counts. */
  readonly issues: readonly Issue[];
  /** Current filter state (controlled). */
  readonly filters: ErrorFilterState;
  /** Fires with the next state when the user toggles a chip. */
  readonly onFiltersChange: (next: ErrorFilterState) => void;
}

/**
 * Apply a filter state to an issue list. Pure + reusable by callers
 * outside the component (e.g., the panel uses this to compute the
 * displayed list).
 */
export function applyErrorFilter(
  issues: readonly Issue[],
  filters: ErrorFilterState,
): readonly Issue[] {
  return issues.filter((issue) => {
    if (
      filters.severities.size > 0 &&
      !filters.severities.has(issue.severity)
    ) {
      return false;
    }
    if (filters.sources.size > 0 && !filters.sources.has(issue.source)) {
      return false;
    }
    if (
      filters.sections.size > 0 &&
      !filters.sections.has(issue.location.section)
    ) {
      return false;
    }
    return true;
  });
}

export function ErrorFilter({
  issues,
  filters,
  onFiltersChange,
}: ErrorFilterProps) {
  // Per-axis counts (computed from full list — they don't change when
  // the user toggles a filter, so the actuary sees a stable view).
  const severityCounts = useMemo(() => {
    const m = { error: 0, warning: 0, info: 0 } as Record<IssueSeverity, number>;
    for (const i of issues) m[i.severity]++;
    return m;
  }, [issues]);

  const sourceCounts = useMemo(() => {
    const m = {
      compile: 0,
      runtime: 0,
      authoring: 0,
      reference: 0,
      conformance: 0,
    } as Record<IssueSource, number>;
    for (const i of issues) m[i.source]++;
    return m;
  }, [issues]);

  // Sections that have AT LEAST one issue. Order by spine declaration
  // order so the chip list is stable + predictable.
  const sectionsInView = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of issues) {
      counts.set(
        i.location.section,
        (counts.get(i.location.section) ?? 0) + 1,
      );
    }
    // Sort by spine order if known; fall back to alpha
    return Array.from(counts.entries())
      .sort(([a], [b]) => {
        const aIdx = sectionOrder(a);
        const bIdx = sectionOrder(b);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.localeCompare(b);
      })
      .map(([id, count]) => ({ id, count }));
  }, [issues]);

  const toggleSeverity = (s: IssueSeverity) => {
    const next = new Set(filters.severities);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onFiltersChange({ ...filters, severities: next });
  };
  const toggleSource = (s: IssueSource) => {
    const next = new Set(filters.sources);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onFiltersChange({ ...filters, sources: next });
  };
  const toggleSection = (s: string) => {
    const next = new Set(filters.sections);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onFiltersChange({ ...filters, sections: next });
  };

  return (
    <div className="rater-error-filter" role="region" aria-label="Filter issues">
      <FilterRow label="Severity">
        {ISSUE_SEVERITIES.map((sev) => (
          <IssueSeverityChip
            key={sev}
            severity={sev}
            count={severityCounts[sev]}
            active={filters.severities.has(sev)}
            onClick={() => toggleSeverity(sev)}
          />
        ))}
      </FilterRow>
      <FilterRow label="Source">
        {ISSUE_SOURCES.map((src) => (
          <button
            key={src}
            type="button"
            className={[
              "rater-error-filter__chip",
              filters.sources.has(src) ? "rater-error-filter__chip--active" : null,
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => toggleSource(src)}
            aria-pressed={filters.sources.has(src)}
          >
            <span>{src}</span>
            <span className="rater-error-filter__chip-count">{sourceCounts[src]}</span>
          </button>
        ))}
      </FilterRow>
      {sectionsInView.length > 0 ? (
        <FilterRow label="Section">
          {sectionsInView.map(({ id, count }) => {
            const label = PLAN_SECTIONS_BY_ID[id]?.name ?? id;
            return (
              <button
                key={id}
                type="button"
                className={[
                  "rater-error-filter__chip",
                  filters.sections.has(id)
                    ? "rater-error-filter__chip--active"
                    : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => toggleSection(id)}
                aria-pressed={filters.sections.has(id)}
              >
                <span>{label}</span>
                <span className="rater-error-filter__chip-count">{count}</span>
              </button>
            );
          })}
        </FilterRow>
      ) : null}
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="rater-error-filter__row">
      <span className="rater-error-filter__row-label">{label}</span>
      <div className="rater-error-filter__row-chips">{children}</div>
    </div>
  );
}

/**
 * Return the spine-order index of a section id, or a large number if
 * the id isn't in the canonical spine (custom sections sort after
 * the standard 14). Pure.
 */
function sectionOrder(id: string): number {
  // PLAN_SECTIONS_BY_ID provides {[id]: Section}; the section's
  // `num` is its 1-indexed spine position. Fall back to large number
  // for unknown ids.
  const section = PLAN_SECTIONS_BY_ID[id];
  return section?.num ?? Number.MAX_SAFE_INTEGER;
}
