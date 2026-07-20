/**
 * <ChoroplethScaleLegend> — a value-break legend for the map choropleths
 * (maps next-gen, "finish the choropleth").
 *
 * Replaces the abstract "below avg … above" swatch strip with a gradient ramp
 * tied to the REAL data range: a sequential metric reads min → mid → max; a
 * signed/diverging metric reads min → baseline → max (emerald ↓ / orange ↑).
 * Pure presentation — the caller passes the ramp colors + the data domain +
 * the metric's formatter. Shared by the Analytics MapPanel + the Portfolio map.
 */

import type { JSX } from "react";
import "./ChoroplethScaleLegend.css";

export interface ChoroplethScaleLegendProps {
  /** Ramp colors low→high (e.g. SEQUENTIAL_RAMP / DIVERGING_RAMP). */
  readonly ramp: readonly string[];
  /** The data range, for the tick labels. */
  readonly min: number;
  readonly max: number;
  /** Signed metrics center the scale on `baseline` (default 0). */
  readonly diverging?: boolean;
  readonly baseline?: number;
  /** Format a value for a tick. */
  readonly formatValue: (v: number) => string;
  readonly label?: string;
  readonly testId?: string;
}

export function ChoroplethScaleLegend(props: ChoroplethScaleLegendProps): JSX.Element {
  const { ramp, min, max, diverging = false, baseline = 0, formatValue, label, testId = "rater-choro-legend" } = props;
  const hasSpread = Number.isFinite(min) && Number.isFinite(max) && max > min;
  const mid = diverging ? baseline : (min + max) / 2;
  const ticks = hasSpread ? [min, mid, max] : [Number.isFinite(min) ? min : 0];

  return (
    <div className="rater-choro-legend" data-testid={testId}>
      {label && <span className="rater-choro-legend__label">{label}</span>}
      <div
        className="rater-choro-legend__bar"
        style={{ background: `linear-gradient(90deg, ${ramp.join(", ")})` }}
        aria-hidden
      />
      <div className="rater-choro-legend__ticks">
        {ticks.map((v, i) => (
          <span
            key={i}
            className={`rater-choro-legend__tick${i === 0 ? " is-start" : i === ticks.length - 1 ? " is-end" : " is-mid"}`}
          >
            {formatValue(v)}
          </span>
        ))}
      </div>
    </div>
  );
}
