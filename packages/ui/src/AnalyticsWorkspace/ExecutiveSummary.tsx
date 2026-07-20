/**
 * Brief 64 PR 64.5 — <ExecutiveSummary> (the Present act, CEO view).
 *
 * A de-chromed, large-type, projector-ready composition: the headline
 * rate-change (or the book snapshot when no comparison is bound), big
 * KPIs, top movers, and the "Publish vN as Current" action. On-screen
 * only (Q4 lock) — no PDF export in v1.
 *
 * Pure presentation. The consumer feeds book KPIs + (optional) the
 * dislocation summary + top movers (from impact-by-variable). The publish
 * affordance moved to the Ship tab (Brief 76 D-F) — this is pure exhibit
 * callback. Publishing is a status pointer — the plan stays editable.
 */

import { type JSX } from "react";
import { formatKpiValue, formatDeltaPct, formatRelativeTime } from "./exhibit-math";
import "./ExecutiveSummary.css";

export interface ExecMover {
  readonly label: string;
  /** Fractional delta (e.g. 0.24 = +24%). */
  readonly delta: number;
}

export interface ExecutiveSummaryProps {
  /** Eyebrow, e.g. "Meridian BOP · Kansas · Rate review". */
  readonly planLabel: string;
  readonly totalPremium: number;
  readonly policyCount: number;
  readonly avgPremium: number;
  /** ISO scored timestamp — shown as context under the headline. */
  readonly scoredAt?: string;
  /** Present when a comparison is bound → headline becomes the rate change. */
  readonly comparison?: {
    readonly baselineLabel: string;
    readonly comparisonLabel: string;
    readonly weightedAvg: number | null;
    readonly pctWithin10: number;
    readonly maxUp: number | null;
    /** Optional $ change of the book total. */
    readonly totalDelta?: number | null;
  };
  readonly topIncreases?: readonly ExecMover[];
  readonly topDecreases?: readonly ExecMover[];
  readonly now?: Date;
  readonly testId?: string;
}

export function ExecutiveSummary(props: ExecutiveSummaryProps): JSX.Element {
  const {
    planLabel,
    totalPremium,
    policyCount,
    avgPremium,
    scoredAt,
    comparison,
    topIncreases = [],
    topDecreases = [],
    now,
    testId = "rater-exec",
  } = props;

  const cur = (v: number | null): string => formatKpiValue(v, "total");
  const headlineDelta = comparison?.weightedAvg ?? null;
  const deltaDir =
    headlineDelta === null || Math.abs(headlineDelta) < 1e-9
      ? "flat"
      : headlineDelta > 0
        ? "up"
        : "down";

  return (
    <section className="rater-exec" data-testid={testId}>
      <p className="rater-exec__eyebrow">{planLabel}</p>

      {comparison ? (
        <h2 className="rater-exec__headline">
          Proposed rate change:{" "}
          <span className={`rater-exec__delta is-${deltaDir}`}>
            {formatDeltaPct(headlineDelta)}
          </span>
        </h2>
      ) : (
        <h2 className="rater-exec__headline">
          <span className="rater-exec__delta is-flat">{cur(totalPremium)}</span>{" "}
          book premium
        </h2>
      )}

      <p className="rater-exec__context" data-testid={`${testId}-context`}>
        {comparison
          ? `${comparison.comparisonLabel} vs ${comparison.baselineLabel} · `
          : ""}
        {policyCount.toLocaleString("en-US")} policies
        {scoredAt ? ` · scored ${formatRelativeTime(scoredAt, now)}` : ""}
      </p>

      <div className="rater-exec__kpis">
        <div className="rater-exec__kpi">
          <span className="rater-exec__kpi-label">Total premium</span>
          <span className="rater-exec__kpi-val">
            {cur(totalPremium)}
            {comparison?.totalDelta != null && comparison.totalDelta !== 0 && (
              <span
                className={`rater-exec__kpi-delta is-${comparison.totalDelta > 0 ? "up" : "down"}`}
              >
                {comparison.totalDelta > 0 ? "▲" : "▼"} {cur(Math.abs(comparison.totalDelta))}
              </span>
            )}
          </span>
        </div>
        {comparison ? (
          <>
            <div className="rater-exec__kpi">
              <span className="rater-exec__kpi-label">Within ±10%</span>
              <span className="rater-exec__kpi-val">
                {Math.round(comparison.pctWithin10 * 100)}%
              </span>
            </div>
            <div className="rater-exec__kpi">
              <span className="rater-exec__kpi-label">Largest increase</span>
              <span className="rater-exec__kpi-val">
                {formatDeltaPct(comparison.maxUp)}
              </span>
            </div>
          </>
        ) : (
          <div className="rater-exec__kpi">
            <span className="rater-exec__kpi-label">Avg premium</span>
            <span className="rater-exec__kpi-val">{cur(avgPremium)}</span>
          </div>
        )}
      </div>

      {(topIncreases.length > 0 || topDecreases.length > 0) && (
        <div className="rater-exec__movers">
          <MoverList
            title="Top increases"
            dir="up"
            movers={topIncreases}
            testId={`${testId}-increases`}
          />
          <MoverList
            title="Top decreases"
            dir="down"
            movers={topDecreases}
            testId={`${testId}-decreases`}
          />
        </div>
      )}

    </section>
  );
}

function MoverList(props: {
  readonly title: string;
  readonly dir: "up" | "down";
  readonly movers: readonly ExecMover[];
  readonly testId: string;
}): JSX.Element {
  return (
    <div className="rater-exec__mover-col" data-testid={props.testId}>
      <h4 className="rater-exec__mover-title">{props.title}</h4>
      {props.movers.length === 0 ? (
        <p className="rater-exec__mover-empty">—</p>
      ) : (
        props.movers.map((m, i) => (
          <div className="rater-exec__mover" key={`${m.label}-${i}`}>
            <span className="rater-exec__mover-label">{m.label}</span>
            <span className={`rater-exec__mover-delta is-${props.dir}`}>
              {formatDeltaPct(m.delta)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
