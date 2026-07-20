/**
 * <StructuralDrivers> — Brief 89 §3.2 B2, restyled by Brief 93 §1.1.4
 * (93.2): the swing list.
 *
 * Ranks every variable by its AUTHORED factor spread and renders each
 * as a RANGE — the min→max multiplier band positioned on one shared
 * log scale (0.80×–2.10× reads as "can multiply by anything in this
 * band"), with a 1.00× reference tick so credits vs surcharges read
 * at a glance. Deliberately NOT <RateDriversList>: that surface
 * renders per-level PREMIUM ranges anchored on a book average; these
 * bands are unitless ×-swings — what the plan CAN do to premium,
 * before any book exists. One honest visual per truth (R10).
 *
 * When a real scored book exists, the observed ranking lives on the
 * Book view (R11); the report keeps the structural truth.
 */

import type { JSX } from "react";
import type { StructuralDriver } from "./probe-math";
import "./AnalyticsProbe.css";

export interface StructuralDriversProps {
  readonly drivers: readonly StructuralDriver[];
  /** Rows rendered before the flat group collapses to a line. */
  readonly topN?: number;
  readonly testId?: string;
}

/** Position a ratio on the shared log scale, as a 0–100 percentage. */
function logPos(value: number, lo: number, hi: number): number {
  if (hi <= lo) return 50;
  const p = (Math.log(value) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  return Math.min(100, Math.max(0, p * 100));
}

function fmtSpread(v: number): string {
  return `${v.toFixed(2)}×`;
}

export function StructuralDrivers(props: StructuralDriversProps): JSX.Element {
  const { drivers, topN = 12, testId = "rater-structural-drivers" } = props;
  const ranked = drivers
    .filter((d) => !d.flat && d.spreadMin !== null && d.spreadMax !== null)
    .slice(0, topN);
  const flat = drivers.filter((d) => d.flat);

  if (ranked.length === 0) {
    return (
      <p className="rater-probe__degrade" data-testid={`${testId}-empty`}>
        No authored spread yet — every factor table is flat (or none exist).
        Author factors in Rating and the ranking appears here.
      </p>
    );
  }

  // One shared domain across rows (padded 5% each side in log space so
  // no band touches the rail's edge), always including the 1.0× tick.
  const rawLo = Math.min(1, ...ranked.map((d) => d.spreadMin!));
  const rawHi = Math.max(1, ...ranked.map((d) => d.spreadMax!));
  const pad = Math.exp((Math.log(rawHi) - Math.log(rawLo)) * 0.05 || 0.05);
  const lo = rawLo / pad;
  const hi = rawHi * pad;
  const tick = logPos(1, lo, hi);

  return (
    <div
      className="rater-probe__tornado"
      role="list"
      aria-label="Rate drivers — structural swing per variable"
      data-testid={testId}
    >
      {ranked.map((d) => {
        const left = logPos(d.spreadMin!, lo, hi);
        const right = logPos(d.spreadMax!, lo, hi);
        return (
          <div
            key={d.id}
            className="rater-probe__trow"
            role="listitem"
            aria-label={`${d.label} — swings premium ${fmtSpread(d.spreadMin!)} to ${fmtSpread(d.spreadMax!)}`}
          >
            <span className="rater-probe__trow-name">{d.label}</span>
            <span className="rater-probe__trow-bar" aria-hidden>
              <span
                className="rater-probe__trow-tick"
                style={{ left: `${tick}%` }}
              />
              <span
                className="rater-probe__trow-range"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(1.5, right - left)}%`,
                }}
              />
            </span>
            <span className="rater-probe__trow-swing">
              {fmtSpread(d.spreadMin!)} – {fmtSpread(d.spreadMax!)}
            </span>
          </div>
        );
      })}
      {flat.length > 0 ? (
        <p className="rater-probe__trow-flatnote" data-testid={`${testId}-flat`}>
          {flat.map((d) => d.label).join(" · ")} —{" "}
          {flat.length === 1 ? "carries" : "carry"} no authored spread yet
          (flat).
        </p>
      ) : null}
    </div>
  );
}
