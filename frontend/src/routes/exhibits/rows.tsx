/**
 * Diverging rows — the stage's 1-D chart, in its own module so both
 * <Stage> and <MapStage> (whose no-map fallback is exactly this) can
 * use it without a cycle.
 *
 * Ranked horizontal bars around a labeled ×1.00 base: surcharges
 * reach right and warm (the loading hue), credits reach left and
 * cool (azure), intensity scaled by how far the factor sits from
 * par. Every row carries its label and its exact value; nothing
 * hides in a tooltip.
 */

import type { JSX } from "react";
import type { LevelValue } from "./anatomy";

/** Rows beyond this scroll inside the chart (long class lists). */
const SCROLL_AFTER = 14;

export interface Domain {
  readonly lo: number;
  readonly hi: number;
  readonly pos: (v: number) => number; // 0..100 (%)
  readonly crossesOne: boolean;
}

export function makeDomain(
  values: readonly LevelValue[],
  bValues: ReadonlyMap<string, number> | null,
): Domain {
  const all = [
    ...values.map((v) => v.value),
    ...(bValues === null ? [] : [...bValues.values()]),
    1,
  ];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.06 || 0.05;
  const lo = min - pad;
  const hi = max + pad;
  return {
    lo,
    hi,
    pos: (v: number) => ((v - lo) / (hi - lo)) * 100,
    crossesOne: lo < 1 && hi > 1,
  };
}

/** Deviation intensity 0..1 within this table's own worst deviation. */
function intensity(v: number, maxDev: number): number {
  return maxDev < 1e-9 ? 0 : Math.abs(v - 1) / maxDev;
}

export function DivergingRows({
  values,
  bValues,
}: {
  readonly values: readonly LevelValue[];
  readonly bValues: ReadonlyMap<string, number> | null;
}): JSX.Element {
  const domain = makeDomain(values, bValues);
  const maxDev = Math.max(...values.map((v) => Math.abs(v.value - 1)), 0);
  const base = domain.pos(1);
  const compare = bValues !== null;
  return (
    <div
      className={
        values.length > SCROLL_AFTER
          ? "rater-exh__rows rater-exh__rows--scroll"
          : "rater-exh__rows"
      }
    >
      {/* The base rule, labeled once — the reader's anchor. */}
      <div className="rater-exh__row rater-exh__row--axis" aria-hidden="true">
        <span />
        <span className="rater-exh__row-track">
          <span
            className="rater-exh__row-baselabel"
            style={{ left: `${base}%` }}
          >
            ×1.00
          </span>
        </span>
        <span />
      </div>
      {values.map((v) => {
        const b = bValues?.get(v.id);
        const changed = b !== undefined && Math.abs(b - v.value) > 1e-9;
        const up = v.value >= 1;
        const from = Math.min(base, domain.pos(v.value));
        const width = Math.abs(domain.pos(v.value) - base);
        const alpha = 0.35 + 0.65 * intensity(v.value, maxDev);
        return (
          <div className="rater-exh__row" key={v.id}>
            <span className="rater-exh__row-label" title={v.id}>
              {v.label}
            </span>
            <span className="rater-exh__row-track">
              <span
                className="rater-exh__row-base"
                style={{ left: `${base}%` }}
              />
              <span
                className={
                  up
                    ? "rater-exh__row-bar rater-exh__row-bar--up"
                    : "rater-exh__row-bar rater-exh__row-bar--down"
                }
                style={{
                  left: `${from}%`,
                  width: `${Math.max(width, 0.4)}%`,
                  opacity: alpha,
                }}
              />
              {b !== undefined && changed ? (
                <span
                  className="rater-exh__row-tickb"
                  style={{ left: `${domain.pos(b)}%` }}
                />
              ) : null}
            </span>
            <span className="rater-exh__row-value">
              {v.value.toFixed(2)}
              {compare ? (
                changed && b !== undefined ? (
                  <>
                    <span className="rater-exh__row-arrow">→</span>
                    <span className="rater-exh__row-bval">{b.toFixed(2)}</span>
                  </>
                ) : (
                  <span className="rater-exh__row-same">=</span>
                )
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
