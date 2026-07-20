/**
 * BuildReportView — Brief 92 scene 5, and the Overview drawer's body.
 *
 * Pure presentation over a persisted `BuildReport`: the built-in-Ns
 * line, the verdict tiles, the verification table (the filing's own
 * examples vs the engine), the plan checks that rode along, and the
 * transcriber's gaps_and_assumptions echoed verbatim. The same
 * component renders at the end of the build flow and a month later
 * from "View build report" — one voice for "where did this plan come
 * from and how good was the transcription."
 */

import type { BuildReportLike, WorkbookVectorResult } from "./types";
import { VECTOR_DELTA_NOTE, formatVectorDelta } from "./vectorDelta";

const GAP_KIND_LABEL: Record<string, string> = {
  assumption: "Assumption",
  gap: "Gap",
  unsupported: "Unsupported",
};

export function vectorsVerdictLine(report: BuildReportLike): string {
  const v = report.vectors;
  if (v.status === "none") return "The workbook carried no test cases.";
  if (v.status !== "ran") {
    return `Verification didn't run — ${v.detail ?? "the scoring service was unreachable"}.`;
  }
  const total = v.checks.length;
  if (v.mismatched === 0 && v.near === 0) {
    return `All ${total} checks across ${v.total_cases} filing examples match.`;
  }
  const parts = [`${v.matched} of ${total} checks match`];
  if (v.near > 0) parts.push(`${v.near} within $1`);
  if (v.mismatched > 0) parts.push(`${v.mismatched} mismatched`);
  return parts.join(" · ") + ".";
}

export function builtLine(report: BuildReportLike): string {
  const c = report.manifest.counts;
  const bits = [
    `${c.dimensions} dimensions (${c.dimension_levels} levels)`,
    `${c.factor_tables} tables (${c.factor_cells} cells)`,
    `${c.chains} chains (${c.chain_stages} stages)`,
  ];
  if (c.gates > 0) bits.push(`${c.gates} gates`);
  bits.push(`${c.inputs} inputs (${c.inputs_with_defaults} defaulted)`);
  bits.push(`${c.test_cases} vectors run through the production engine`);
  return bits.join(" · ");
}

function formatValue(v: number | string | null): string {
  if (v === null) return "—";
  if (typeof v === "string") return v;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function vectorRowTone(status: WorkbookVectorResult["status"]): string {
  if (status === "match") return "";
  if (status === "near") return " rater-build-report__vec-row--near";
  return " rater-build-report__vec-row--miss";
}

export interface BuildReportViewProps {
  readonly report: BuildReportLike;
}

export function BuildReportView({ report }: BuildReportViewProps) {
  const v = report.vectors;
  const nonMatching = v.checks.filter((c) => c.status !== "match");
  const leading = v.checks.slice(0, 2);
  const shown =
    nonMatching.length > 0
      ? [...leading.filter((c) => c.status === "match"), ...nonMatching]
      : leading;
  const folded = v.checks.length - shown.length;
  const vectorsTone =
    v.status !== "ran" || v.mismatched > 0
      ? "warn"
      : v.near > 0
        ? "warn"
        : "ok";

  return (
    <div className="rater-build-report">
      <p className="rater-build-report__built">{builtLine(report)}</p>

      <div className="rater-build-report__verdict">
        <div
          className={`rater-build-report__stat rater-build-report__stat--${vectorsTone}`}
        >
          <span className="rater-build-report__stat-value">
            {v.status === "ran" ? `${v.matched} of ${v.checks.length}` : "—"}
          </span>
          <span className="rater-build-report__stat-label">
            {vectorsVerdictLine(report)}
          </span>
        </div>
        <div className="rater-build-report__stat">
          <span className="rater-build-report__stat-value">
            {report.issues.length}
          </span>
          <span className="rater-build-report__stat-label">
            {report.issues.length === 1 ? "plan check" : "plan checks"}{" "}
            (warnings + notices)
          </span>
        </div>
        <div className="rater-build-report__stat">
          <span className="rater-build-report__stat-value">
            {report.gaps.length}
          </span>
          <span className="rater-build-report__stat-label">
            flagged by the transcriber
          </span>
        </div>
      </div>

      {report.drift && report.drift.compared > 0 ? (
        <section className="rater-build-report__section">
          <div className="rater-build-report__drift" role="status">
            <span className="rater-build-report__drift-head">
              {report.drift.median_pct !== null
                ? `The filing's examples moved ${report.drift.median_pct > 0 ? "+" : ""}${report.drift.median_pct.toFixed(1)}% median` +
                  (report.drift.max_pct !== null
                    ? ` (${report.drift.max_pct > 0 ? "+" : ""}${report.drift.max_pct.toFixed(1)}% max)`
                    : "")
                : "The filing's examples did not move"}
            </span>
            <span className="rater-build-report__drift-sub">
              {report.drift.compared}{" "}
              {report.drift.compared === 1 ? "check" : "checks"} compared
              against the prior build
              {report.drift.expectations_revised > 0
                ? ` · ${report.drift.expectations_revised} ${report.drift.expectations_revised === 1 ? "expectation" : "expectations"} revised by the filing itself`
                : ""}
            </span>
          </div>
          {report.drift.cases.length > 0 ? (
            <table className="rater-build-report__vec">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Field</th>
                  <th className="rater-build-report__num">Was</th>
                  <th className="rater-build-report__num">Now</th>
                  <th className="rater-build-report__num">Move</th>
                </tr>
              </thead>
              <tbody>
                {report.drift.cases.slice(0, 8).map((c) => (
                  <tr key={`${c.case_id}:${c.field}`}>
                    <td className="rater-build-report__mono">{c.case_id}</td>
                    <td>{c.field}</td>
                    <td className="rater-build-report__num rater-build-report__mono">
                      {formatValue(c.was)}
                    </td>
                    <td className="rater-build-report__num rater-build-report__mono">
                      {formatValue(c.now)}
                    </td>
                    <td className="rater-build-report__num rater-build-report__mono">
                      {c.pct !== null
                        ? `${c.pct > 0 ? "+" : ""}${c.pct.toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {report.drift.cases.length > 8 ? (
            <p className="rater-build-report__fold">
              …{report.drift.cases.length - 8} more — the report keeps every
              case, old and new.
            </p>
          ) : null}
        </section>
      ) : null}

      {v.status === "ran" && v.checks.length > 0 ? (
        <section className="rater-build-report__section">
          <h4 className="rater-build-report__eyebrow">
            Verification — the filing's own examples
          </h4>
          <table className="rater-build-report__vec">
            <thead>
              <tr>
                <th>Case</th>
                <th>Field</th>
                <th className="rater-build-report__num">Filing says</th>
                <th className="rater-build-report__num">Plan says</th>
                <th className="rater-build-report__num" title={VECTOR_DELTA_NOTE}>
                  Δ
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr
                  key={`${c.case_id}-${c.field}`}
                  className={`rater-build-report__vec-row${vectorRowTone(c.status)}`}
                >
                  <td className="rater-build-report__mono">{c.case_id}</td>
                  <td>{c.field}</td>
                  <td className="rater-build-report__num rater-build-report__mono">
                    {formatValue(c.expected)}
                  </td>
                  <td className="rater-build-report__num rater-build-report__mono">
                    {formatValue(c.actual)}
                  </td>
                  <td className="rater-build-report__num rater-build-report__mono">
                    {formatVectorDelta(c)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {folded > 0 ? (
            <p className="rater-build-report__fold">
              …{folded} more, all matching. Download the report for the full
              table.
            </p>
          ) : null}
        </section>
      ) : null}

      {report.issues.length > 0 ? (
        <section className="rater-build-report__section">
          <h4 className="rater-build-report__eyebrow">Plan checks</h4>
          <ul className="rater-build-report__issues">
            {report.issues.map((issue, i) => (
              <li key={i} className="rater-build-report__issue">
                <span
                  className={`rater-build-report__dot rater-build-report__dot--${issue.severity}`}
                  aria-hidden
                />
                <span>
                  {issue.sheet ? (
                    <code className="rater-build-report__mono">
                      {issue.sheet}
                      {issue.cell ? `!${issue.cell}` : ""}
                    </code>
                  ) : null}{" "}
                  {issue.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* A re-ingested build carries its applied diff; the
          drawer's history pager makes every yesterday's diff reachable
          (it was API-only). The summaries are the server's own diff
          voice — one line per changed construct. */}
      {report.diff && report.diff.totals.sections_changed > 0 ? (
        <section className="rater-build-report__section">
          <h4 className="rater-build-report__eyebrow">
            What this build changed
          </h4>
          <p className="rater-build-report__diff-totals">
            {report.diff.totals.changed} changed ·{" "}
            {report.diff.totals.added} added · {report.diff.totals.removed}{" "}
            removed, across {report.diff.totals.sections_changed} section
            {report.diff.totals.sections_changed === 1 ? "" : "s"} — against
            the workbook this build replaced.
          </p>
          <ul className="rater-build-report__diff">
            {report.diff.sections
              .filter((s) => s.items.length > 0)
              .flatMap((s) =>
                s.items.slice(0, 8).map((item, i) => (
                  <li
                    key={`${s.section}-${i}`}
                    className="rater-build-report__diff-item"
                  >
                    <span className="rater-build-report__diff-label">
                      {s.label}
                    </span>
                    <span>{item.summary}</span>
                  </li>
                )),
              )}
          </ul>
        </section>
      ) : null}

      {report.gaps.length > 0 ? (
        <section className="rater-build-report__section">
          <h4 className="rater-build-report__eyebrow">
            What the transcriber flagged
          </h4>
          <ul className="rater-build-report__gaps">
            {report.gaps.map((gap, i) => {
              const kind = String(gap.kind ?? "gap");
              return (
                <li key={i} className="rater-build-report__gap">
                  <span
                    className={`rater-build-report__gap-kind rater-build-report__gap-kind--${kind}`}
                  >
                    {GAP_KIND_LABEL[kind] ?? kind}
                  </span>
                  <span className="rater-build-report__gap-body">
                    <span>{String(gap.description ?? "")}</span>
                    {gap.impact ? (
                      <span className="rater-build-report__gap-impact">
                        {String(gap.impact)}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
