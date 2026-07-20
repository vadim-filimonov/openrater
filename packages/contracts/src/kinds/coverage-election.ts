/**
 * `coverage.election` kind — Brief 95 C4 (spec §4.1 election markers).
 *
 * Reads a tower's resolved exposure value and decides the tower's
 * election state. The signal is an EXPLICIT zero — a submitted 0
 * exposure is a statement ("no building coverage bought"); an absent
 * exposure is not (you can't tell "didn't buy" from "didn't fill in"),
 * so absence keeps today's withhold posture (spec §12.4).
 *
 *   · elective + exposure EXPLICITLY 0 → elected OUT. The projector
 *     gates the tower's own nodes on `elected` (they skip via the
 *     reserved `__guard__` port) and routes the tower output through
 *     branch(elected_out ? 0 : premium) — the tower contributes $0 and
 *     the trace says why.
 *   · elective + exposure > 0          → elected; the tower runs.
 *   · elective + exposure absent/NaN   → elected; the tower runs and
 *     withholds naturally (absence is never an election).
 *   · required + exposure EXPLICITLY 0 → the tower RUNS and the
 *     arithmetic yields its $0 — that is the audited filed behavior
 *     (the KS oracle's TV-28 floors a zero-limit tower's book to the
 *     $500 minimum; refusing here contradicted the oracle) — but a
 *     WARNING issue (`zero_exposure_required`) names the ambiguity:
 *     if "no coverage" was meant, the plan should mark the coverage
 *     electable (§4.1 `?`).
 *   · required + anything else         → elected (absence withholds
 *     downstream exactly as today).
 */

import type { BlockKind, PortSpec } from "../block-types";
import { toFiniteNumber } from "./coerce-numeric";

export interface CoverageElectionParams {
  /** The coverage this tower prices (e.g. "building"). Audit-facing. */
  coverage: string;
  /** Whether the plan marked the coverage electable (spec §4.1 `?`). */
  elective: boolean;
}

export type CoverageElectionInputs = { exposure: unknown };
export type CoverageElectionOutputs = {
  elected: boolean;
  elected_out: boolean;
};

export const CoverageElectionKind: BlockKind<
  CoverageElectionParams,
  CoverageElectionInputs,
  CoverageElectionOutputs
> = {
  id: "coverage.election",
  category: "branch",
  label: "Coverage election",
  description:
    "Elect a coverage in or out from its exposure — explicit 0 on an electable coverage skips its tower",
  inputs: [
    {
      name: "exposure",
      type: "money",
      description: "The tower's resolved exposure value",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "elected",
      type: "bool",
      description: "true → the tower runs (gates its nodes)",
    } as PortSpec,
    {
      name: "elected_out",
      type: "bool",
      description: "true → the tower contributes $0 (not elected)",
    } as PortSpec,
  ],
  defaultParams: { coverage: "coverage", elective: false },
  defaultSize: "regular",
  execute: (inputs, params) => {
    const v = toFiniteNumber(inputs.exposure);
    const explicitZero = v === 0;
    // A required tower with an explicit 0 still RUNS (elected): the
    // arithmetic yields its $0, exactly the audited filed behavior.
    // Only an ELECTABLE coverage's explicit zero elects out.
    const electedOut = explicitZero && params.elective;
    return { elected: !electedOut, elected_out: electedOut };
  },
  collectRowIssues: (inputs, params, outputs) => {
    const v = toFiniteNumber(inputs.exposure);
    if (v === 0 && !params.elective && !outputs.elected_out) {
      return [
        {
          severity: "warning",
          code: "zero_exposure_required",
          message:
            `Coverage \`${params.coverage}\` has an explicit 0 exposure ` +
            "and prices $0 — this plan does not mark it electable, so " +
            "the zero is priced, not an elect-out. If “no " +
            `${params.coverage} coverage” was meant, mark the ` +
            `coverage \`${params.coverage}?\` in the plan's coverages.`,
          detail: { coverage: params.coverage },
        },
      ];
    }
    return undefined;
  },
  validate: (params) => {
    if (!params.coverage || params.coverage.trim() === "") {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "Coverage name is required",
            field: "coverage",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    if (outputs.elected_out) {
      return `${params.coverage}: not elected — exposure explicitly 0; the tower contributes $0`;
    }
    const v = toFiniteNumber(inputs.exposure);
    if (Number.isNaN(v)) {
      return `${params.coverage}: elected (no exposure supplied — the tower runs and withholds if it cannot rate)`;
    }
    if (v === 0) {
      return `${params.coverage}: explicit 0 exposure PRICED ($0 tower) — the coverage is required, so zero is not an elect-out`;
    }
    return `${params.coverage}: elected — exposure ${v}`;
  },
};
