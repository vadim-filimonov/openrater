/**
 * <ProbeBookCard> — Brief 89 §3.2 B3 (89.4): the probe book.
 *
 * One click scores a synthetic sweep of the plan's OWN variable space
 * — every level of every rated variable off the representative risk,
 * plus the top-2-axes cross — server-side, persisted as a `probe` run.
 * The readout answers the pre-data questions: what premium range the
 * plan can produce, how much of its own space it declines (and which
 * gate values do it), and each variable's observed premium swing.
 *
 * Pure presentation (§2B): the mount owns the sweep build, the run
 * POST, the polling, and the rows fetch; this renders the five states.
 * Invalidation is the plan fingerprint — a `stale` probe names the
 * drift and offers the regenerate, it never silently re-scores.
 */

import type { JSX } from "react";
import { FlaskConical, RefreshCw } from "lucide-react";
import { Button } from "@openrater/design-system";
import type { ProbeReadout } from "./probe-math";
import "./AnalyticsProbe.css";

export type ProbeBookState =
  /** Substrate can't sweep yet — `reason` names the missing piece. */
  | { readonly phase: "empty"; readonly reason: string }
  | {
      readonly phase: "idle";
      readonly plannedCells: number;
      readonly plannedVariables: number;
    }
  | { readonly phase: "running"; readonly cellCount: number }
  | { readonly phase: "error"; readonly message: string }
  | {
      readonly phase: "done";
      readonly readout: ProbeReadout;
      /** inputKey → display label (dim names; falls back to the key). */
      readonly labels: ReadonlyMap<string, string>;
      /** "512 cells · draft@ab12cd34 · Jul 13, 14:02". */
      readonly metaLabel: string;
      /** Plan fingerprint moved since this probe was scored. */
      readonly stale: boolean;
    };

export interface ProbeBookCardProps {
  readonly state: ProbeBookState;
  /** Generate (idle) / regenerate (done). Absent → read-only plan. */
  readonly onGenerate?: (() => void) | undefined;
  /** POST in flight (before the run shows up as `running`). */
  readonly busy?: boolean | undefined;
  readonly testId?: string | undefined;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

const CLUSTER_CAP = 5;

export function ProbeBookCard(props: ProbeBookCardProps): JSX.Element {
  const { state, onGenerate, busy = false, testId = "rater-probe-book" } = props;

  if (state.phase === "empty") {
    return (
      <p className="rater-probe__degrade" data-testid={`${testId}-empty`}>
        {state.reason}
      </p>
    );
  }

  if (state.phase === "idle") {
    return (
      <div className="rater-probe__book" data-testid={testId}>
        <p className="rater-probe__book-intro">
          Sweep the plan's own variable space — every level of every rated
          variable off the representative risk, plus the top-two-axes cross:{" "}
          <b>
            {state.plannedCells} cell{state.plannedCells === 1 ? "" : "s"}
          </b>{" "}
          across {state.plannedVariables} variable
          {state.plannedVariables === 1 ? "" : "s"}, scored server-side and
          saved as a probe run. It shows the premium range the plan can
          produce and how much of its own space the gates decline — before
          any book exists.
        </p>
        {onGenerate ? (
          <div className="rater-probe__book-actions">
            {/* The probe pane's one filled action — the blocked-state
                CTA this mode replaced was the pane's primary before. */}
            <Button
              variant="primary"
              size="sm"
              icon={<FlaskConical />}
              onClick={onGenerate}
              disabled={busy}
              data-testid={`${testId}-generate`}
            >
              {busy ? "Submitting…" : "Generate probe book"}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (state.phase === "running") {
    return (
      <div className="rater-probe__book" data-testid={testId}>
        <p className="rater-probe__book-intro" role="status">
          Scoring {state.cellCount} cell{state.cellCount === 1 ? "" : "s"}{" "}
          through the engine… the readout lands here when the run finishes.
        </p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="rater-probe__book" data-testid={testId}>
        <p className="rater-probe__book-error" data-testid={`${testId}-error`}>
          {state.message}
        </p>
        {onGenerate ? (
          <div className="rater-probe__book-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw />}
              onClick={onGenerate}
              disabled={busy}
            >
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const { readout, labels, metaLabel, stale } = state;
  const label = (key: string): string => labels.get(key) ?? key;
  const clusters = readout.variables
    .filter((v) => v.declined > 0)
    .flatMap((v) =>
      v.declinedValues.map((dv) => ({
        variable: label(v.inputKey),
        value: dv.value,
        count: dv.count,
      })),
    )
    .sort((a, b) => b.count - a.count);
  const observed = readout.variables.filter((v) => v.swing !== null);
  const flat = readout.variables.length - observed.length;
  const maxSwing = observed.reduce(
    (m, v) => (v.swing !== null && v.swing > m ? v.swing : m),
    1,
  );

  return (
    <div className="rater-probe__book" data-testid={testId}>
      <dl className="rater-probe__book-stats">
        <div className="rater-probe__book-stat">
          <dt>Premium range</dt>
          <dd data-testid={`${testId}-range`}>
            {readout.premiumMin !== null && readout.premiumMax !== null
              ? `${fmtMoney(readout.premiumMin)} – ${fmtMoney(readout.premiumMax)}`
              : "—"}
          </dd>
        </div>
        <div className="rater-probe__book-stat">
          <dt>Declined</dt>
          <dd data-testid={`${testId}-declined`}>
            {pct(readout.declined, readout.total)}
            <span className="rater-probe__book-substat">
              {readout.declined} of {readout.total} cells
            </span>
          </dd>
        </div>
        <div className="rater-probe__book-stat">
          <dt>Cells</dt>
          <dd>
            {readout.total}
            {readout.errors > 0 ? (
              <span className="rater-probe__book-substat">
                {readout.errors} cannot be rated
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {readout.baseDeclined ? (
        <p className="rater-probe__book-note" data-testid={`${testId}-base-declined`}>
          The representative risk itself declines — every sweep line
          inherits that verdict until the base passes the gates.
        </p>
      ) : null}

      {clusters.length > 0 ? (
        <div className="rater-probe__book-clusters" data-testid={`${testId}-clusters`}>
          <h4 className="rater-probe__book-subtitle">Where the gates fire</h4>
          <ul>
            {clusters.slice(0, CLUSTER_CAP).map((c) => (
              <li key={`${c.variable} ${c.value}`}>
                <b>{c.variable}</b> = {c.value} → {c.count} cell
                {c.count === 1 ? "" : "s"} declined
              </li>
            ))}
          </ul>
          {clusters.length > CLUSTER_CAP ? (
            <p className="rater-probe__book-substat">
              {clusters.length - CLUSTER_CAP} more declining value
              {clusters.length - CLUSTER_CAP === 1 ? "" : "s"} in the run.
            </p>
          ) : null}
        </div>
      ) : null}

      {observed.length > 0 ? (
        <div className="rater-probe__book-observed" data-testid={`${testId}-observed`}>
          <h4 className="rater-probe__book-subtitle">
            Observed premium swing — scored, per variable
          </h4>
          <div className="rater-probe__tornado">
            {observed.map((v) => (
              <div
                key={v.inputKey}
                className="rater-probe__trow"
                aria-label={`${label(v.inputKey)} — observed swing ${v.swing!.toFixed(2)} times`}
              >
                <span className="rater-probe__trow-name">{label(v.inputKey)}</span>
                <span className="rater-probe__trow-bar" aria-hidden>
                  <span
                    className="rater-probe__trow-fill"
                    style={{ width: `${Math.max(6, (v.swing! / maxSwing) * 100)}%` }}
                  />
                </span>
                <span className="rater-probe__trow-swing">
                  {v.swing!.toFixed(2)}×
                </span>
              </div>
            ))}
          </div>
          {flat > 0 ? (
            <p className="rater-probe__book-substat">
              {flat} variable{flat === 1 ? "" : "s"} showed no premium spread
              in this sweep.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="rater-probe__book-meta">
        <span data-testid={`${testId}-meta`}>{metaLabel}</span>
        {stale ? (
          <span
            className="rater-probe__book-stale"
            data-testid={`${testId}-stale`}
          >
            plan changed since this probe
          </span>
        ) : null}
        {onGenerate ? (
          <Button
            variant="ghost"
            size="xs"
            icon={<RefreshCw />}
            onClick={onGenerate}
            disabled={busy}
            data-testid={`${testId}-regenerate`}
          >
            {busy ? "Submitting…" : "Regenerate"}
          </Button>
        ) : null}
      </p>
    </div>
  );
}
