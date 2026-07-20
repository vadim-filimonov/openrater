/**
 * `uw.report` kind — sources a structured UW Report from external
 * inputs.
 *
 * Brief 7 (UW Report integration). The UW Report is assembled
 * upstream (out of scope for the rating engine — typically by an
 * AI/API service that aggregates Google Business Profile, OSHA
 * history, broker notes, etc.). This kind makes it available in the
 * rating plan as a typed value, ready to feed into:
 *
 *   - `chain.from_report` — multiply premium by accepted adjustments
 *   - `modifier.schedule` (via the UI auto-suggest bridge) —
 *     populate per-category values from matching adjustments
 *   - any plan-author authored wires (e.g., extract a summary
 *     string into the final quote)
 *
 * Like `input.class_exposure`, this kind reads from
 * `ctx.externalInputs`. The kind's execute is a pure pass-through
 * that:
 *   - reads externalInputs[params.reportFieldName]
 *   - validates the shape via isUwReport()
 *   - returns it on the `report` output port
 *
 * When the report is missing or malformed, the kind outputs
 * `{ report: null }` rather than throwing — downstream kinds
 * `chain.from_report` handle null gracefully (factor 1, no
 * applied adjustments). This lets a plan ship without requiring
 * every account to have a report.
 *
 * Per Brief 7 (no-gimmicks: NO inferred report content; NO LLM-
 * authored values without explicit underwriter acceptance — that
 * acceptance check happens DOWNSTREAM in chain.from_report).
 */

import type { BlockKind, PortSpec } from "../block-types";
import { isUwReport, type UwReport } from "../report-types";

export interface UwReportParams {
  /**
   * External-inputs key to read the report from. Defaults to
   * "uw_report"; integrators with multiple reports per account
   * may name them e.g. "uw_report_property" + "uw_report_liability".
   */
  readonly reportFieldName?: string;
}

/** No wire inputs — reads from ctx.externalInputs. */
export type UwReportInputs = Record<string, never>;

export interface UwReportOutputs {
  /** The parsed report, or null when missing/malformed. */
  report: UwReport | null;
}

export const UwReportKind: BlockKind<
  UwReportParams,
  UwReportInputs,
  UwReportOutputs
> = {
  id: "uw.report",
  category: "input",
  label: "UW Report",
  description:
    "Sources a structured UW Report (AI/API-driven underwriting evidence) from externalInputs.",
  inputs: [],
  outputs: [
    {
      name: "report",
      type: "record",
      description: "The parsed UwReport, or null when missing.",
    } as PortSpec,
  ],
  defaultParams: { reportFieldName: "uw_report" },
  defaultSize: "regular",
  execute: (_inputs, params, ctx) => {
    const fieldName = params.reportFieldName ?? "uw_report";
    const raw = ctx?.externalInputs?.[fieldName];
    if (!isUwReport(raw)) {
      return { report: null };
    }
    return { report: raw };
  },
  validate: (params) => {
    if (
      params.reportFieldName !== undefined &&
      params.reportFieldName.trim() === ""
    ) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "reportFieldName must be a non-empty string when set.",
            field: "reportFieldName",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (_inputs, params, outputs) => {
    const fieldName = params.reportFieldName ?? "uw_report";
    if (outputs.report === null) {
      return `No UW Report supplied at externalInputs.${fieldName} (continuing without report context).`;
    }
    const adj = outputs.report.adjustments.length;
    const accepted = outputs.report.adjustments.filter((a) => a.accepted).length;
    const src = outputs.report.sources.length;
    return `UW Report ${outputs.report.report_id} loaded: ${adj} adjustment${adj === 1 ? "" : "s"} (${accepted} accepted), ${src} source${src === 1 ? "" : "s"}.`;
  },
};
