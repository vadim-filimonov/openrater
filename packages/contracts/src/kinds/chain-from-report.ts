/**
 * `chain.from_report` kind — expand UW Report into a chain factor.
 *
 * Brief 7 (UW Report integration). Consumes a UwReport (from
 * `uw.report` or any upstream record source) and produces a
 * cumulative multiplicative factor from the accepted adjustments.
 *
 *   Given a UwReport with N adjustments (some accepted, some not),
 *   chain.from_report:
 *     1. Filters by `require_acceptance` (default true — only
 *        adjustments explicitly accepted by the underwriter apply).
 *     2. Filters by `category_filter` if set.
 *     3. Optionally caps the absolute cumulative percentage at
 *        `total_cap_pct` (default 100, effectively uncapped).
 *     4. Sums the value_pct of remaining adjustments.
 *     5. Returns factor = 1 + sum/100.
 *
 *   The trace surfaces:
 *     - The cumulative factor
 *     - Per-adjustment values + reasoning + citation (verbatim)
 *     - Whether the cap was hit
 *
 * THE no-gimmicks line: `require_acceptance: true` is the DEFAULT.
 * Setting it to false (apply un-accepted suggestions) is a
 * configuration choice with explicit semantics — and the trace
 * surfaces it via the adjustment's `accepted` field so the audit
 * captures it.
 *
 * Pure execute. No runtime special-casing. Per Brief 7 design
 * (UW Report data is just data; the chain rendering it into a
 * factor is the same as any other multiplicative factor).
 *
 * See `docs/design-briefs/uw-report-integration.md` for the design.
 */

import type { BlockKind, PortSpec } from "../block-types";
import type {
  AppliedReportAdjustment,
  UwReport,
} from "../report-types";

export interface ChainFromReportParams {
  /**
   * Only apply adjustments where `accepted: true`. Default `true`
   * (the no-gimmicks line: AI suggestions don't apply without
   * underwriter acceptance). Set to false explicitly — and surface
   * the choice in the plan author's UI — for "apply all suggestions"
   * use cases (typically only for what-if scenarios).
   */
  readonly require_acceptance?: boolean;
  /**
   * Optional category allowlist. When set, only adjustments whose
   * category matches one of these entries apply. Useful when a
   * single chain.from_report node consumes only a subset of report
   * adjustments (e.g., only operational categories; safety-related
   * adjustments flow into a separate node).
   */
  readonly category_filter?: readonly string[];
  /**
   * Total cap (absolute percentage). When the cumulative sum exceeds
   * this, it's clamped. Default 100 (effectively uncapped). A filed
   * plan with appetite-driven caps should set this explicitly.
   */
  readonly total_cap_pct?: number;
}

export interface ChainFromReportInputs {
  /** The UW Report to expand. Wired from uw.report or a constant. */
  report: UwReport | null;
}

export interface ChainFromReportOutputs {
  /** Cumulative multiplicative factor (1 + applied_pct/100). */
  factor: number;
  /** Sum of all applied adjustment value_pct (signed; pre-cap). */
  applied_pct: number;
  /** Per-adjustment evaluation result — verbatim into the trace. */
  applied: readonly AppliedReportAdjustment[];
  /** True when the cumulative absolute sum hit the cap. */
  cap_hit: boolean;
}

const DEFAULT_CAP_PCT = 100;

export const ChainFromReportKind: BlockKind<
  ChainFromReportParams,
  ChainFromReportInputs,
  ChainFromReportOutputs
> = {
  id: "chain.from_report",
  category: "chain",
  label: "Chain · from UW Report",
  description:
    "Expand UW Report adjustments into a cumulative multiplicative factor (accepted-only by default).",
  inputs: [
    {
      name: "report",
      type: "record",
      description: "Upstream UwReport.",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "factor",
      type: "factor",
      description: "Cumulative factor from applied adjustments.",
    } as PortSpec,
    {
      name: "applied_pct",
      type: "pct",
      description: "Sum of applied value_pct (signed; pre-cap).",
    } as PortSpec,
    {
      name: "applied",
      type: "record",
      description: "Per-adjustment evaluation result.",
    } as PortSpec,
    {
      name: "cap_hit",
      type: "bool",
      description: "True when the cumulative sum hit the cap.",
    } as PortSpec,
  ],
  defaultParams: {
    require_acceptance: true,
    total_cap_pct: DEFAULT_CAP_PCT,
  },
  defaultSize: "regular",
  execute: (inputs, params) => {
    const report = inputs.report;
    if (!report) {
      return { factor: 1, applied_pct: 0, applied: [], cap_hit: false };
    }
    const requireAcceptance = params.require_acceptance ?? true;
    const filter = params.category_filter ?? null;
    const cap = params.total_cap_pct ?? DEFAULT_CAP_PCT;
    const applied: AppliedReportAdjustment[] = [];
    let sum = 0;
    for (const adj of report.adjustments) {
      if (requireAcceptance && !adj.accepted) continue;
      if (filter !== null && !filter.includes(adj.category)) continue;
      applied.push({
        adjustment_id: adj.adjustment_id,
        category: adj.category,
        value_pct: adj.value_pct,
        reasoning: adj.reasoning,
        ...(adj.citation !== undefined ? { citation: adj.citation } : {}),
      });
      sum += adj.value_pct;
    }
    const cap_hit = Math.abs(sum) >= cap;
    const clamped = cap_hit ? (sum >= 0 ? cap : -cap) : sum;
    return {
      factor: 1 + clamped / 100,
      applied_pct: clamped,
      applied,
      cap_hit,
    };
  },
  validate: (params) => {
    if (params.total_cap_pct !== undefined && params.total_cap_pct < 0) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "total_cap_pct must be non-negative.",
            field: "total_cap_pct",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (_inputs, params, outputs) => {
    if (outputs.applied.length === 0) {
      return `No UW Report adjustments applied (factor 1.0000).`;
    }
    const cap_note = outputs.cap_hit
      ? ` (capped at ±${params.total_cap_pct ?? DEFAULT_CAP_PCT}%)`
      : "";
    const requireAccept = params.require_acceptance ?? true;
    const acceptance_note = requireAccept ? " (accepted-only)" : " (all)";
    return `UW Report → ${outputs.applied.length} adjustment${outputs.applied.length === 1 ? "" : "s"}${acceptance_note} → ${outputs.applied_pct >= 0 ? "+" : ""}${outputs.applied_pct.toFixed(1)}%${cap_note} → factor ${outputs.factor.toFixed(4)}.`;
  },
};
