/**
 * <ClampVisualizer> — Phase H.6 (Brief 41 §−1 Q3 lock).
 *
 * Hand-rolled SVG number-line showing the filed clamp envelope on a
 * model.* modifier:
 *
 *   0.5            1.0            1.5
 *    │              │              │
 *    │   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓           │     ← shaded clamp band
 *    │              ◆               │     ← fallback factor marker
 *    │              ●               │     ← actual factor (when shown)
 *
 * Inputs:
 *   - min_factor + max_factor  → the shaded band
 *   - fallback_factor (opt)    → small diamond marker
 *   - actual_factor (opt)      → solid dot marker (for "this row's
 *                                applied factor" in the trace step)
 *
 * The X-axis spans 0.5 to 1.5 by default. When any value falls
 * outside that range, the axis auto-extends with 10% padding on
 * the relevant side. The baseline (1.0) is always rendered.
 *
 * Pure presentation. BEM CSS + design tokens; no inline styles
 * (per repo convention from CLAUDE.md). Hand-rolled SVG per ADR-0019
 * (Brief 19's curve-plot precedent — no third-party charting libs).
 */

import { useMemo, type JSX } from "react";
import "./ClampVisualizer.css";

export interface ClampVisualizerProps {
  /** Lower bound of the clamp envelope. */
  readonly minFactor: number;
  /** Upper bound of the clamp envelope. */
  readonly maxFactor: number;
  /** Optional fallback factor marker (diamond glyph). */
  readonly fallbackFactor?: number;
  /** Optional actual applied factor (solid dot — surfaces in trace). */
  readonly actualFactor?: number;
  /** Optional override for the visualizer width in CSS pixels. */
  readonly width?: number;
  /** Optional override for the visualizer height in CSS pixels. */
  readonly height?: number;
  /** Optional test id. */
  readonly testId?: string;
}

const DEFAULT_WIDTH = 280;
const DEFAULT_HEIGHT = 64;
const PAD_LEFT = 16;
const PAD_RIGHT = 16;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

/** Default X-axis range — the typical factor band. */
const DEFAULT_X_MIN = 0.5;
const DEFAULT_X_MAX = 1.5;

/**
 * Compute the actual X-axis bounds given the configured envelope +
 * optional markers. Auto-extends with 10% padding when any value
 * falls outside the default range. Pure function — exported so
 * tests can pin the auto-extension behavior.
 */
export function computeXBounds(
  minFactor: number,
  maxFactor: number,
  fallbackFactor: number | undefined,
  actualFactor: number | undefined,
): { readonly xMin: number; readonly xMax: number } {
  const values = [minFactor, maxFactor];
  if (fallbackFactor !== undefined && Number.isFinite(fallbackFactor)) {
    values.push(fallbackFactor);
  }
  if (actualFactor !== undefined && Number.isFinite(actualFactor)) {
    values.push(actualFactor);
  }
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // Always include 1.0 baseline + the default range when the data
  // fits within it. Auto-extend only when data spills outside.
  let xMin = Math.min(DEFAULT_X_MIN, dataMin);
  let xMax = Math.max(DEFAULT_X_MAX, dataMax);
  // Add a touch of padding when the data forced an extension so the
  // markers don't sit on the edge.
  if (dataMin < DEFAULT_X_MIN) xMin = dataMin - (DEFAULT_X_MIN - dataMin) * 0.1;
  if (dataMax > DEFAULT_X_MAX) xMax = dataMax + (dataMax - DEFAULT_X_MAX) * 0.1;
  return { xMin, xMax };
}

/** Project a factor value onto an X pixel coordinate within the plot. */
export function factorToX(
  factor: number,
  xMin: number,
  xMax: number,
  plotWidth: number,
  padLeft: number,
): number {
  if (xMax === xMin) return padLeft + plotWidth / 2;
  const t = (factor - xMin) / (xMax - xMin);
  return padLeft + t * plotWidth;
}

export function ClampVisualizer(props: ClampVisualizerProps): JSX.Element {
  const {
    minFactor,
    maxFactor,
    fallbackFactor,
    actualFactor,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    testId = "rater-clamp-visualizer",
  } = props;

  // Treat min > max as an authoring error — still render but flag.
  // The editor's own validator catches this; the visualizer makes it
  // visible.
  const inverted = minFactor > maxFactor;

  const { xMin, xMax } = useMemo(
    () => computeXBounds(minFactor, maxFactor, fallbackFactor, actualFactor),
    [minFactor, maxFactor, fallbackFactor, actualFactor],
  );

  const plotWidth = width - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;
  const axisY = PAD_TOP + plotHeight / 2;

  const xToPx = (f: number) =>
    factorToX(f, xMin, xMax, plotWidth, PAD_LEFT);

  // Choose tick positions. Always include 1.0 baseline; include
  // 0.5 + 1.5 when they're inside the visible range; include the
  // clamp endpoints. Dedup + sort.
  const tickValues = useMemo(() => {
    const ticks = new Set<number>();
    if (xMin <= 1.0 && xMax >= 1.0) ticks.add(1.0);
    if (xMin <= 0.5 && xMax >= 0.5) ticks.add(0.5);
    if (xMin <= 1.5 && xMax >= 1.5) ticks.add(1.5);
    if (Number.isFinite(minFactor)) ticks.add(minFactor);
    if (Number.isFinite(maxFactor)) ticks.add(maxFactor);
    return Array.from(ticks).sort((a, b) => a - b);
  }, [xMin, xMax, minFactor, maxFactor]);

  // Clamp band: only render when min ≤ max. When inverted, suppress
  // the band so the visualizer doesn't show a negative-width rect.
  const bandX1 = inverted ? null : xToPx(minFactor);
  const bandX2 = inverted ? null : xToPx(maxFactor);

  return (
    <div
      className={`rater-clamp-visualizer${inverted ? " is-invalid" : ""}`}
      data-testid={testId}
    >
      <svg
        className="rater-clamp-visualizer__svg"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={
          inverted
            ? "Clamp envelope invalid: min exceeds max"
            : `Clamp envelope ${minFactor} to ${maxFactor}${
                fallbackFactor !== undefined
                  ? `, fallback ${fallbackFactor}`
                  : ""
              }`
        }
      >
        {/* Clamp band */}
        {bandX1 !== null && bandX2 !== null ? (
          <rect
            className="rater-clamp-visualizer__band"
            x={bandX1}
            y={axisY - 6}
            width={bandX2 - bandX1}
            height={12}
            data-testid={`${testId}-band`}
          />
        ) : null}

        {/* Axis line */}
        <line
          className="rater-clamp-visualizer__axis"
          x1={PAD_LEFT}
          y1={axisY}
          x2={width - PAD_RIGHT}
          y2={axisY}
        />

        {/* Baseline (1.0) marker */}
        {xMin <= 1.0 && xMax >= 1.0 ? (
          <line
            className="rater-clamp-visualizer__baseline"
            x1={xToPx(1.0)}
            y1={PAD_TOP}
            x2={xToPx(1.0)}
            y2={height - PAD_BOTTOM}
            data-testid={`${testId}-baseline`}
          />
        ) : null}

        {/* Tick marks + labels */}
        {tickValues.map((v) => {
          const x = xToPx(v);
          const isClampEdge = v === minFactor || v === maxFactor;
          return (
            <g key={v} className="rater-clamp-visualizer__tick">
              <line
                className={`rater-clamp-visualizer__tick-line${
                  isClampEdge ? " is-clamp-edge" : ""
                }`}
                x1={x}
                y1={axisY - 4}
                x2={x}
                y2={axisY + 4}
              />
              <text
                className={`rater-clamp-visualizer__tick-label${
                  isClampEdge ? " is-clamp-edge" : ""
                }`}
                x={x}
                y={height - 4}
                textAnchor="middle"
              >
                {formatTick(v)}
              </text>
            </g>
          );
        })}

        {/* Fallback marker (diamond) */}
        {fallbackFactor !== undefined && Number.isFinite(fallbackFactor) ? (
          <g
            className="rater-clamp-visualizer__fallback"
            data-testid={`${testId}-fallback`}
            transform={`translate(${xToPx(fallbackFactor)}, ${axisY})`}
          >
            <polygon
              className="rater-clamp-visualizer__fallback-glyph"
              points="0,-6 6,0 0,6 -6,0"
            />
          </g>
        ) : null}

        {/* Actual factor marker (solid dot — surfaces in trace step) */}
        {actualFactor !== undefined && Number.isFinite(actualFactor) ? (
          <circle
            className="rater-clamp-visualizer__actual"
            cx={xToPx(actualFactor)}
            cy={axisY}
            r={4}
            data-testid={`${testId}-actual`}
          />
        ) : null}
      </svg>
      {inverted ? (
        <p className="rater-clamp-visualizer__warning" role="alert">
          Clamp envelope invalid: min ({minFactor}) exceeds max ({maxFactor}).
        </p>
      ) : null}
    </div>
  );
}

/**
 * Format a tick label. Two-decimal precision for non-integer factors,
 * one-decimal for the baseline (matches how actuaries write factors).
 */
function formatTick(v: number): string {
  if (v === 0.5 || v === 1.0 || v === 1.5) return v.toFixed(1);
  return v.toFixed(2);
}
