/**
 * report-facts — Brief 93 §1.1.2: the counted facts behind the plan
 * report's generated paragraph. Pure + deterministic: a template over
 * counts (zero AI, R3), so the lede is verifiable against the
 * substrate it describes.
 */

import { countPublicAlgorithm } from "../CalculationTower/public-counts";

export interface ReportStageLike {
  readonly stage_id: string;
  readonly stage_kind: string;
  readonly display_name?: string;
  /** Present on real StageSummary rows; the public counting reads it. */
  readonly config_json?: unknown;
  readonly sequence?: number;
}

function asConfig(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

export interface PlanReportFacts {
  /** Application inputs the plan asks for (`input_node` stages). */
  readonly inputCount: number;
  /** THE public step count (MVP-013): the rows the Rating tab shows —
   *  chain build-up steps + Final-adjustment rows. Never the wire
   *  stage count. */
  readonly stepCount: number;
  /** Per-coverage premium chains (the same counting's other half). */
  readonly chainCount: number;
  /** Factor tables in the plan's catalog. */
  readonly tableCount: number;
  /** Interpolated curves (`interpolate` stages). */
  readonly curveCount: number;
  /** Eligibility rules that can decline/refer a risk. */
  readonly gateCount: number;
}

export function computePlanReportFacts(
  stages: readonly ReportStageLike[],
  factorTables: readonly unknown[],
): PlanReportFacts {
  let inputCount = 0;
  let curveCount = 0;
  let gateCount = 0;
  for (const s of stages) {
    if (s.stage_kind === "input_node") inputCount += 1;
    else if (s.stage_kind === "interpolate") curveCount += 1;
    else if (s.stage_kind === "eligibility.gate") {
      // MVP-013 — one counting: a gate stage holds N filed RULES
      // (config_json.rules), the same number the Overview checklist
      // states and the report's gates section lists. A config-less
      // stage still counts as one rule.
      const rules = asConfig(s.config_json)?.["rules"];
      gateCount += Array.isArray(rules) && rules.length > 0 ? rules.length : 1;
    }
  }
  // MVP-013 — one public counting everywhere: the lede states the same
  // "chains · steps" the Rating tab renders and the Overview checklist
  // prints, via the shared derivation.
  const algo = countPublicAlgorithm(
    stages.map((s, i) => ({
      stage_id: s.stage_id,
      sequence: s.sequence ?? i,
      stage_kind: s.stage_kind,
      display_name: s.display_name ?? s.stage_id,
      config_json: asConfig(s.config_json),
    })),
  );
  return {
    inputCount,
    stepCount: algo.steps,
    chainCount: algo.chains,
    tableCount: factorTables.length,
    curveCount,
    gateCount,
  };
}

/**
 * The provenance clause of the lede. A workbook-built plan (Brief 92)
 * is one with a persisted build report (the receipt); anything else
 * states nothing rather than guessing (a copy vs blank distinction
 * isn't in the substrate).
 */
export function buildProvenanceClause(args: {
  readonly workbookBuilt: boolean;
}): string | null {
  if (args.workbookBuilt) {
    return "Built from a transcribed workbook — every table and chain carried over from the source, nothing hand-typed.";
  }
  return null;
}

/** "3 chains · 24 steps · 9 inputs · 12 tables" — the title-block
 *  meta, leading with the public counting (MVP-013). */
export function buildReportMetaLine(facts: PlanReportFacts): string {
  const parts = [
    ...(facts.chainCount > 0
      ? [`${facts.chainCount} ${facts.chainCount === 1 ? "chain" : "chains"}`]
      : []),
    `${facts.stepCount} ${facts.stepCount === 1 ? "step" : "steps"}`,
    `${facts.inputCount} ${facts.inputCount === 1 ? "input" : "inputs"}`,
  ];
  if (facts.tableCount > 0) {
    parts.push(
      `${facts.tableCount} ${facts.tableCount === 1 ? "table" : "tables"}`,
    );
  }
  return parts.join(" · ");
}
