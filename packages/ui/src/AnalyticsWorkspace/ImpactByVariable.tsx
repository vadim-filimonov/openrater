/**
 * Brief 64 PR 64.4 — <ImpactByVariable>.
 *
 * The Compare act's ranked list: which variables drove the dislocation
 * *differentially*. One row per variable, sorted by how differently its
 * levels moved (`deltaSpread`), each a diverging bar spanning its lowest →
 * highest level Δ% around the 0% (no-change) line. Click a row → the
 * consumer opens `<DimensionDetailExhibit>` with a `comparisonRows` for the
 * per-level old-vs-new paired bars.
 *
 * Pure presentation over `computeImpactByVariable`. Variables that moved
 * uniformly (a base-rate shift, not dislocation) show a "no differential"
 * chip and sort last.
 */

import { useMemo, type JSX } from "react";
import { formatDeltaPct } from "./exhibit-math";
import type { VariableImpact } from "./impact";
import type { OverviewVariableKind } from "./overview-math";
import "./ImpactByVariable.css";

export interface ImpactByVariableProps {
  readonly variables: readonly VariableImpact[];
  readonly baselineLabel: string;
  readonly comparisonLabel: string;
  readonly selectedId?: string | null;
  readonly onSelect?: (variableId: string) => void;
  readonly testId?: string;
}

const KIND_LABEL: Readonly<Record<OverviewVariableKind, string>> = {
  categorical: "categorical",
  numeric: "continuous",
  geographic: "geographic",
};

export function ImpactByVariable(props: ImpactByVariableProps): JSX.Element {
  const {
    variables,
    baselineLabel,
    comparisonLabel,
    selectedId = null,
    onSelect,
    testId = "rater-impact",
  } = props;

  // Symmetric ±domain for the diverging bars.
  const domain = useMemo(() => {
    let d = 0.01;
    for (const v of variables) {
      if (v.maxLevelDelta !== null) d = Math.max(d, Math.abs(v.maxLevelDelta));
      if (v.minLevelDelta !== null) d = Math.max(d, Math.abs(v.minLevelDelta));
    }
    return d;
  }, [variables]);

  return (
    <section className="rater-impact" data-testid={testId} aria-label="Impact by variable">
      <header className="rater-impact__head">
        <h3 className="rater-impact__title">Impact by variable</h3>
        <span className="rater-impact__sub">
          level rate change · {baselineLabel} → {comparisonLabel}
        </span>
      </header>

      <div className="rater-impact__axis" aria-hidden="true">
        <span>Variable</span>
        <span>Level Δ% range (0% centered)</span>
        <span className="rater-impact__col-r">Book Δ</span>
      </div>

      <ol className="rater-impact__rows">
        {variables.map((v) => (
          <li key={v.id} className="rater-impact__li">
            <button
              type="button"
              className={`rater-impact__row${v.id === selectedId ? " is-selected" : ""}`}
              onClick={() => onSelect?.(v.id)}
              aria-label={ariaLabel(v)}
              data-testid={`${testId}-row-${v.id}`}
            >
              <span className="rater-impact__id">
                <span className="rater-impact__name">{v.label}</span>
                <span className={`rater-impact__kind rater-impact__kind--${v.kind}`}>
                  {KIND_LABEL[v.kind]}
                </span>
              </span>
              <span className="rater-impact__track">
                <i className="rater-impact__zero" aria-hidden="true" />
                {v.flat || v.minLevelDelta === null || v.maxLevelDelta === null ? (
                  <span className="rater-impact__flat">uniform · no differential</span>
                ) : (
                  segments(v.minLevelDelta, v.maxLevelDelta, domain).map((s, i) => (
                    <i
                      key={i}
                      className={`rater-impact__bar is-${s.dir}`}
                      style={{ left: `${s.left}%`, width: `${s.width}%` }}
                    />
                  ))
                )}
              </span>
              <span className="rater-impact__book rater-impact__col-r">
                {formatDeltaPct(v.bookDelta)}
              </span>
            </button>
          </li>
        ))}
        {variables.length === 0 && (
          <li className="rater-impact__empty" data-testid={`${testId}-empty`}>
            No variables to compare.
          </li>
        )}
      </ol>
    </section>
  );
}

interface BarSegment {
  readonly dir: "down" | "up";
  readonly left: number;
  readonly width: number;
}

/**
 * Split the [min, max] level-Δ range into a decrease (emerald, left of 0)
 * and/or an increase (orange, right of 0) segment around the centered 0%
 * line. Mapping: [-domain, +domain] → [0, 100]%, 0 at 50%.
 */
function segments(
  minDelta: number,
  maxDelta: number,
  domain: number,
): BarSegment[] {
  const pct = (d: number): number =>
    Math.max(0, Math.min(100, 50 + (d / domain) * 50));
  const segs: BarSegment[] = [];
  if (minDelta < 0) {
    const lo = pct(minDelta);
    const hi = pct(Math.min(0, maxDelta));
    segs.push({ dir: "down", left: lo, width: Math.max(1, hi - lo) });
  }
  if (maxDelta > 0) {
    const lo = pct(Math.max(0, minDelta));
    const hi = pct(maxDelta);
    segs.push({ dir: "up", left: lo, width: Math.max(1, hi - lo) });
  }
  return segs;
}

function ariaLabel(v: VariableImpact): string {
  if (v.flat || v.minLevelDelta === null || v.maxLevelDelta === null) {
    return `${v.label}, ${KIND_LABEL[v.kind]}, no differential rate change`;
  }
  return `${v.label}, ${KIND_LABEL[v.kind]}, level rate change from ${formatDeltaPct(
    v.minLevelDelta,
  )} to ${formatDeltaPct(v.maxLevelDelta)}, book ${formatDeltaPct(v.bookDelta)}`;
}
