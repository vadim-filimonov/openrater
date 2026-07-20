/**
 * <Stage> — the workbench's center (current Exhibits design).
 *
 * One variable at a time, drawn the way a graphics desk would:
 *
 *   · 1-D tables → horizontal DIVERGING bars around a labeled ×1.00
 *     base (rows.tsx) — surcharges warm, credits azure, intensity
 *     scaled by distance from par, every row directly labeled.
 *   · banded curves → a large line with the band labels, endpoint
 *     values, and the ×1.00 rule.
 *   · geographic dims with territories → the territory MAP (P6,
 *     MapStage.tsx) — members placed on real geography, painted in
 *     the same diverging language.
 *   · 2-D tables → the azure-tinted grid, roomy.
 *
 * The B side (compare) rides as violet — a dashed curve, a tick at
 * each row's B position, a ring around changed map members. Above
 * every chart sits ONE annotation sentence (story.ts) —
 * deterministic, computed, never prose-by-AI.
 */

import { useMemo, type JSX, type ReactNode } from "react";
import type { ExhibitTile, LevelValue } from "./anatomy";
import { compareDrawnOrder, drawnValuesFor } from "./anatomy";
import { stageStory } from "./story";
import { DivergingRows, makeDomain } from "./rows";
import { MapStage } from "./MapStage";
import { mapTerritoriesOf } from "./geo";

function CurveStage({
  values,
  bValues,
}: {
  readonly values: readonly LevelValue[];
  readonly bValues: ReadonlyMap<string, number> | null;
}): JSX.Element {
  const W = 640;
  const H = 288;
  const L = 46;
  const R = 54;
  const TOP = 18;
  const BOT = 30;
  const domain = makeDomain(values, bValues);
  const x = (i: number): number =>
    values.length <= 1 ? W / 2 : L + (i * (W - L - R)) / (values.length - 1);
  const y = (v: number): number =>
    TOP + ((domain.hi - v) / (domain.hi - domain.lo)) * (H - TOP - BOT);
  const first = values[0];
  const last = values[values.length - 1];
  const bFirst = first === undefined ? undefined : bValues?.get(first.id);
  const bLast = last === undefined ? undefined : bValues?.get(last.id);
  return (
    <svg
      className="rater-exh__curve"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${values.length} bands, ${domain.lo.toFixed(2)} to ${domain.hi.toFixed(2)}`}
    >
      {domain.crossesOne ? (
        <>
          <line
            className="rater-exh__curve-one"
            x1={L}
            y1={y(1)}
            x2={W - R}
            y2={y(1)}
          />
          <text className="rater-exh__curve-axis" x={4} y={y(1) + 3}>
            ×1.00
          </text>
        </>
      ) : null}
      <polygon
        className="rater-exh__curve-fill"
        points={[
          `${x(0).toFixed(1)},${(H - BOT).toFixed(1)}`,
          ...values.map((v, i) => `${x(i).toFixed(1)},${y(v.value).toFixed(1)}`),
          `${x(values.length - 1).toFixed(1)},${(H - BOT).toFixed(1)}`,
        ].join(" ")}
      />
      <polyline
        className="rater-exh__curve-line"
        points={values
          .map((v, i) => `${x(i).toFixed(1)},${y(v.value).toFixed(1)}`)
          .join(" ")}
      />
      {values.map((v, i) => (
        <circle
          key={v.id}
          className="rater-exh__curve-dot"
          cx={x(i)}
          cy={y(v.value)}
          r={3.5}
        />
      ))}
      {/* Changed bands get a violet vertex — interior moves stop
          hiding between the endpoint labels. */}
      {bValues !== null
        ? values.map((v, i) => {
            const b = bValues.get(v.id);
            return b === undefined || Math.abs(b - v.value) <= 1e-9 ? null : (
              <circle
                key={`b-${v.id}`}
                className="rater-exh__curve-dot-b"
                cx={x(i)}
                cy={y(b)}
                r={3}
              />
            );
          })
        : null}
      {bValues !== null ? (
        <polyline
          className="rater-exh__curve-line-b"
          points={values
            .map((v, i) => {
              const b = bValues.get(v.id);
              return b === undefined
                ? null
                : `${x(i).toFixed(1)},${y(b).toFixed(1)}`;
            })
            .filter((p): p is string => p !== null)
            .join(" ")}
        />
      ) : null}
      {/* Direct endpoint labels — the graphic carries its numbers. */}
      {first !== undefined ? (
        <text
          className="rater-exh__curve-val"
          x={x(0)}
          y={y(first.value) - 10}
          textAnchor="start"
        >
          {first.value.toFixed(2)}
        </text>
      ) : null}
      {last !== undefined ? (
        <text
          className="rater-exh__curve-val"
          x={x(values.length - 1) + 8}
          y={y(last.value) + 4}
          textAnchor="start"
        >
          {last.value.toFixed(2)}
        </text>
      ) : null}
      {bValues !== null && last !== undefined && bLast !== undefined ? (
        <text
          className="rater-exh__curve-val rater-exh__curve-val--b"
          x={x(values.length - 1) + 8}
          y={y(bLast) - 6}
          textAnchor="start"
        >
          {bLast.toFixed(2)}
        </text>
      ) : null}
      {bValues !== null && first !== undefined && bFirst !== undefined && Math.abs(bFirst - first.value) > 1e-9 ? (
        <text
          className="rater-exh__curve-val rater-exh__curve-val--b"
          x={x(0)}
          y={y(bFirst) - 10}
          textAnchor="start"
        >
          {bFirst.toFixed(2)}
        </text>
      ) : null}
      {values.map((v, i) => (
        <text
          key={`x-${v.id}`}
          className="rater-exh__curve-xlabel"
          x={x(i)}
          y={H - 8}
          textAnchor={i === 0 ? "start" : i === values.length - 1 ? "end" : "middle"}
        >
          {v.label}
        </text>
      ))}
    </svg>
  );
}

export interface StageProps {
  readonly tile: ExhibitTile;
  readonly bValues: ReadonlyMap<string, number> | null;
  readonly bCells: Readonly<Record<string, number>> | null;
  /** The 2-D grid, rendered by the route (shares GridTile). */
  readonly gridSlot: ReactNode;
  /** Extra editorial line (the territory verdict) — under the story. */
  readonly extraLine: string | null;
  readonly badge: ReactNode;
  readonly foot: ReactNode;
}

export function Stage({
  tile,
  bValues,
  bCells,
  gridSlot,
  extraLine,
  badge,
  foot,
}: StageProps): JSX.Element {
  // Dense strips reorder in compare: moved levels first, biggest move
  // leading — a 40-class diff reads without scrolling. Exports keep
  // the value-sorted order (same rows, stable for spreadsheets).
  const drawn = useMemo(() => {
    const base = drawnValuesFor(tile);
    return tile.kind === "strip" ? compareDrawnOrder(base, bValues) : base;
  }, [tile, bValues]);
  const story = useMemo(
    () =>
      stageStory({
        kind:
          tile.kind === "curve"
            ? "curve"
            : tile.kind === "grid"
              ? "grid"
              : tile.kind === "flat"
                ? "flat"
                : "bars",
        values: drawn,
        bValues,
        cells: tile.table.cells,
        bCells,
      }),
    [tile, drawn, bValues, bCells],
  );
  const onMap = mapTerritoriesOf(tile.dim) !== null && drawn.length > 0;
  return (
    <section className="rater-exh__stage" aria-label={tile.table.display_name}>
      <div className="rater-exh__stage-head">
        <h2 className="rater-exh__stage-name">{tile.table.display_name}</h2>
        {tile.monotonicity !== null ? (
          <span
            className={
              tile.monotonicity.holds
                ? "rater-exh__mono rater-exh__mono--ok"
                : "rater-exh__mono rater-exh__mono--broken"
            }
          >
            {tile.monotonicity.holds ? "✓ monotone" : "⚠ breaks filed order"}
          </span>
        ) : null}
        <span className="rater-exh__stage-badge">{badge}</span>
      </div>
      {story !== null ? (
        <p className="rater-exh__stage-story">{story}</p>
      ) : null}
      {extraLine !== null ? (
        <p className="rater-exh__stage-extra">{extraLine}</p>
      ) : null}

      <div className="rater-exh__stage-chart">
        {onMap ? (
          <MapStage tile={tile} drawn={drawn} bValues={bValues} />
        ) : tile.kind === "curve" ? (
          <CurveStage values={drawn} bValues={bValues} />
        ) : tile.kind === "grid" ? (
          gridSlot
        ) : tile.kind === "flat" ? (
          <p className="rater-exh__tile-flat">
            {Object.values(tile.table.cells).length === 1
              ? `×${Object.values(tile.table.cells)[0]?.toFixed(2)}`
              : `${Object.values(tile.table.cells).length} cells`}
          </p>
        ) : (
          <DivergingRows values={drawn} bValues={bValues} />
        )}
      </div>
      <div className="rater-exh__stage-foot">{foot}</div>
    </section>
  );
}
