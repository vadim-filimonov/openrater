/**
 * `endorsement.factor` / `endorsement.additive` / `endorsement.sublimit`
 * kinds — form-based add-ons that auto-attach when their trigger
 * condition fires.
 *
 * Endorsements are post-rate adjustments: each one has a form_number
 * (e.g., "MS 10 02"), a
 * display name, an optional trigger condition over externalInputs,
 * and an effect kind. When the trigger matches (or is empty,
 * meaning "always attach"), the endorsement's effect is applied to
 * the input premium / coverages and the result flows downstream.
 *
 * Three discrete kinds keep the discriminated union clean — every
 * endorsement has the same metadata, the kind differentiates the
 * effect math:
 *
 *   - `endorsement.factor`     — multiply premium by `factor`
 *     (e.g., ×1.15 surcharge, ×0.85 discount)
 *   - `endorsement.additive`   — add `amount` to premium
 *     (e.g., +$250 deductible buyback)
 *   - `endorsement.sublimit`   — cap `coverage` at `sublimit`
 *     (writes to a sub-limits map; does NOT modify premium)
 *
 * Trigger shape mirrors eligibility.gate's single-rule format
 * (variable + op + value). For multi-condition triggers, the
 * authoring UX can compose conditions through a richer expression tree.
 * V1 ships the single-condition shape; multi-condition support remains
 * a backward-compatible extension.
 *
 * Inputs come from `ctx.externalInputs` for trigger evaluation +
 * the wired `premium` port for effect application. The kind has
 * one input port (`premium`) and three outputs (`attached`,
 * `premium_out`, `sublimit_out`); the runtime applies the
 * effect based on `kind`.
 *
 *   Example (endorsement.factor):
 *     Trigger:
 *       { variable: "tiv", op: "gt", value: 1000000 }
 *     Effect:
 *       { factor: 1.15 }
 *
 *     externalInputs: { tiv: 4200000 }
 *     premium input: 12500
 *
 *     Outputs:
 *       attached: true
 *       premium_out: 14375 (12500 × 1.15)
 *       sublimit_out: null
 *
 * Pure. No special-casing in the runtime — `execute` reads from
 * `ctx.externalInputs` directly.
 */

import type { BlockKind, PortSpec } from "../block-types";
import {
  type EligibilityOp,
  evaluateEligibilityComparator,
} from "../tier-types";

// ────────────────────────────────────────────────────────────────
// Shared trigger shape — single-condition v1
// ────────────────────────────────────────────────────────────────

/**
 * Endorsement trigger. When `null`, the endorsement always attaches.
 * When set, evaluates `externalInputs[variable] op value`; attaches
 * only when the condition is true. Missing variables degrade
 * gracefully to "doesn't attach" (matches eligibility.gate's
 * graceful-on-missing behavior).
 */
export interface EndorsementTrigger {
  readonly variable: string;
  readonly op: EligibilityOp;
  readonly value: unknown;
}

/** Evaluate a trigger. Null trigger = always true. */
export function evaluateEndorsementTrigger(
  trigger: EndorsementTrigger | null,
  externalInputs: Record<string, unknown>,
): boolean {
  if (trigger === null) return true;
  const left = externalInputs[trigger.variable];
  if (left === undefined) return false;
  return evaluateEligibilityComparator(trigger.op, left, trigger.value);
}

// ────────────────────────────────────────────────────────────────
// endorsement.factor — multiply premium by N
// ────────────────────────────────────────────────────────────────

export interface EndorsementFactorParams {
  /** Filing form number or custom string (e.g., "MS 10 02"). */
  readonly form_number: string;
  /** Human-readable name surfaced in trace + UI. */
  readonly display_name: string;
  /** Trigger condition; null = always attach. */
  readonly trigger: EndorsementTrigger | null;
  /** Multiplier applied to premium when attached. */
  readonly factor: number;
  /** Optional citation (e.g., "Meridian form MS 10 02 — 2026 ed."). */
  readonly citation?: string;
}

export interface EndorsementFactorInputs {
  /** The premium to multiply (typically wired from the tower's
   *  output node). */
  readonly premium: number;
}

export interface EndorsementFactorOutputs {
  /** Whether the endorsement attached (trigger matched). */
  attached: boolean;
  /** Modified premium when attached, unchanged premium when not. */
  premium_out: number;
}

export const EndorsementFactorKind: BlockKind<
  EndorsementFactorParams,
  EndorsementFactorInputs,
  EndorsementFactorOutputs
> = {
  id: "endorsement.factor",
  category: "transform",
  label: "Endorsement (factor)",
  description:
    "Multiplies premium by a factor when the trigger condition fires.",
  inputs: [
    {
      name: "premium",
      type: "float",
      description: "Premium to apply the factor to.",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "attached",
      type: "bool",
      description: "True when the trigger matched and the factor was applied.",
    } as PortSpec,
    {
      name: "premium_out",
      type: "float",
      description: "Premium after applying the factor (unchanged when not attached).",
    } as PortSpec,
  ],
  defaultParams: {
    form_number: "",
    display_name: "",
    trigger: null,
    factor: 1,
  },
  defaultSize: "regular",
  execute: (inputs, params, ctx) => {
    const externalInputs = ctx?.externalInputs ?? {};
    const attached = evaluateEndorsementTrigger(
      params.trigger,
      externalInputs,
    );
    const premium = inputs.premium;
    const premium_out = attached ? premium * params.factor : premium;
    return { attached, premium_out };
  },
};

// ────────────────────────────────────────────────────────────────
// endorsement.additive — add flat amount to premium
// ────────────────────────────────────────────────────────────────

export interface EndorsementAdditiveParams {
  readonly form_number: string;
  readonly display_name: string;
  readonly trigger: EndorsementTrigger | null;
  /** Amount added to premium when attached. Currency assumed to
   *  match the premium's currency. */
  readonly amount: number;
  readonly citation?: string;
}

export interface EndorsementAdditiveInputs {
  readonly premium: number;
}

export interface EndorsementAdditiveOutputs {
  attached: boolean;
  premium_out: number;
}

export const EndorsementAdditiveKind: BlockKind<
  EndorsementAdditiveParams,
  EndorsementAdditiveInputs,
  EndorsementAdditiveOutputs
> = {
  id: "endorsement.additive",
  category: "transform",
  label: "Endorsement (additive)",
  description:
    "Adds a flat amount to premium when the trigger condition fires.",
  inputs: [
    {
      name: "premium",
      type: "float",
      description: "Premium to add the amount to.",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "attached",
      type: "bool",
      description: "True when the trigger matched and the amount was added.",
    } as PortSpec,
    {
      name: "premium_out",
      type: "float",
      description: "Premium after adding the amount (unchanged when not attached).",
    } as PortSpec,
  ],
  defaultParams: {
    form_number: "",
    display_name: "",
    trigger: null,
    amount: 0,
  },
  defaultSize: "regular",
  execute: (inputs, params, ctx) => {
    const externalInputs = ctx?.externalInputs ?? {};
    const attached = evaluateEndorsementTrigger(
      params.trigger,
      externalInputs,
    );
    const premium = inputs.premium;
    const premium_out = attached ? premium + params.amount : premium;
    return { attached, premium_out };
  },
};

// ────────────────────────────────────────────────────────────────
// endorsement.sublimit — cap a coverage at $N
// ────────────────────────────────────────────────────────────────

export interface EndorsementSublimitParams {
  readonly form_number: string;
  readonly display_name: string;
  readonly trigger: EndorsementTrigger | null;
  /** Coverage name being capped (e.g., "peak_items", "computer_eq"). */
  readonly coverage: string;
  /** The cap value. */
  readonly sublimit: number;
  readonly citation?: string;
}

export interface EndorsementSublimitInputs {
  /** Premium passes through unchanged — sublimits don't modify
   *  premium directly. */
  readonly premium: number;
}

export interface EndorsementSublimitOutputs {
  attached: boolean;
  /** Premium passes through unchanged. */
  premium_out: number;
  /** Sublimit metadata when attached, null when not. */
  sublimit_out: { readonly coverage: string; readonly value: number } | null;
}

export const EndorsementSublimitKind: BlockKind<
  EndorsementSublimitParams,
  EndorsementSublimitInputs,
  EndorsementSublimitOutputs
> = {
  id: "endorsement.sublimit",
  category: "transform",
  label: "Endorsement (sublimit)",
  description:
    "Caps a named coverage at a $-value when the trigger condition fires. Premium passes through unchanged.",
  inputs: [
    {
      name: "premium",
      type: "float",
      description: "Premium passes through unchanged.",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "attached",
      type: "bool",
      description: "True when the trigger matched and the sublimit was applied.",
    } as PortSpec,
    {
      name: "premium_out",
      type: "float",
      description: "Premium (unchanged — sublimits don't modify premium directly).",
    } as PortSpec,
    {
      name: "sublimit_out",
      type: {
        kind: "optional",
        of: {
          kind: "record",
          fields: { coverage: "string", value: "money" },
        },
      },
      description:
        "Sublimit metadata { coverage, value } when attached; null otherwise.",
    } as PortSpec,
  ],
  defaultParams: {
    form_number: "",
    display_name: "",
    trigger: null,
    coverage: "",
    sublimit: 0,
  },
  defaultSize: "regular",
  execute: (inputs, params, ctx) => {
    const externalInputs = ctx?.externalInputs ?? {};
    const attached = evaluateEndorsementTrigger(
      params.trigger,
      externalInputs,
    );
    const premium = inputs.premium;
    return {
      attached,
      premium_out: premium,
      sublimit_out: attached
        ? { coverage: params.coverage, value: params.sublimit }
        : null,
    };
  },
};

// ────────────────────────────────────────────────────────────────
// endorsement.rate_branch — additive branch via mini-chain
// ────────────────────────────────────────────────────────────────

/**
 * Authored shape of a branch chain (a self-contained mini-chain). The
 * structure mirrors a top-level multiplicative_chain spec so the
 * authoring layer can reuse the same form. The branch's LCM is
 * independent of the main chain's LCM — the branch
 * applies its own loss-cost multiplier to its own exposure.
 *
 * `factor_lookups` is reserved for v2 work — v1 evaluates only base ×
 * lcm / exposure_unit_divisor. When the branch needs factor tables
 * (e.g., territory-driven liquor rates), the runtime would resolve
 * them from a factor-table catalog passed via ctx. V18 conformance
 * fixture exercises the v1 path (empty factor_lookups).
 */
export interface BranchChainLcm {
  readonly factor_kind: "lcm";
  readonly input_path: string;
  readonly citation_rule?: string;
  readonly citation_page?: string;
  readonly description_template?: string;
}

export interface BranchChain {
  readonly name: string;
  readonly base_input: string;
  // v1 ignores factor_lookups; the runtime treats them as an empty
  // list. v2 will resolve them via ctx-provided factor tables.
  readonly factor_lookups: readonly unknown[];
  readonly lcm: BranchChainLcm;
  readonly exposure_input: string;
  readonly exposure_unit_divisor: number;
  readonly output_field: string;
}

export interface EndorsementRateBranchParams {
  readonly form_number: string;
  readonly display_name: string;
  readonly trigger: EndorsementTrigger | null;
  /** The mini-chain that produces the branch's premium contribution. */
  readonly branch_chain: BranchChain;
  readonly citation?: string;
}

export interface EndorsementRateBranchInputs {
  /** Upstream policy premium that this branch adds to. */
  readonly premium: number;
}

export interface EndorsementRateBranchOutputs {
  /** Whether the trigger fired + branch contributed. */
  fired: boolean;
  /** Amount the branch added to the upstream premium (0 when not fired). */
  contribution: number;
  /** Upstream premium + contribution. */
  premium_out: number;
}

/**
 * Read a numeric value from externalInputs given a "form_input.foo"-
 * shaped path. Returns 0 when the path doesn't resolve or the value
 * is not a finite number. Mirrors how the main projector normalizes
 * paths — keep the runtime forgiving so a missing field degrades
 * gracefully rather than throwing.
 */
function readBranchNumeric(
  path: string,
  externalInputs: Record<string, unknown>,
): number {
  if (!path) return 0;
  const field = path.startsWith("form_input.") ? path.slice(11) : path;
  const v = externalInputs[field];
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return v;
}

export const EndorsementRateBranchKind: BlockKind<
  EndorsementRateBranchParams,
  EndorsementRateBranchInputs,
  EndorsementRateBranchOutputs
> = {
  id: "endorsement.rate_branch",
  category: "transform",
  label: "Endorsement (rate branch)",
  description:
    "Evaluates a mini-chain when the trigger fires; the branch's result is added to the incoming premium.",
  inputs: [
    {
      name: "premium",
      type: "float",
      description: "Upstream policy premium the branch contribution adds to.",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "fired",
      type: "bool",
      description: "True when the trigger matched and the branch contributed.",
    } as PortSpec,
    {
      name: "contribution",
      type: "float",
      description:
        "Amount the branch contributed (0 when not fired); composition is additive.",
    } as PortSpec,
    {
      name: "premium_out",
      type: "float",
      description: "Upstream premium + contribution.",
    } as PortSpec,
  ],
  defaultParams: {
    form_number: "",
    display_name: "",
    trigger: null,
    branch_chain: {
      name: "untitled_branch",
      base_input: "",
      factor_lookups: [],
      lcm: {
        factor_kind: "lcm",
        input_path: "",
      },
      exposure_input: "",
      exposure_unit_divisor: 1,
      output_field: "branch_premium",
    },
  },
  defaultSize: "regular",
  execute: (inputs, params, ctx) => {
    const externalInputs = ctx?.externalInputs ?? {};
    const fired = evaluateEndorsementTrigger(params.trigger, externalInputs);
    const premium = inputs.premium;
    if (!fired) {
      return { fired: false, contribution: 0, premium_out: premium };
    }
    const branch = params.branch_chain;
    const base = readBranchNumeric(branch.base_input, externalInputs);
    const lcm = readBranchNumeric(branch.lcm.input_path, externalInputs);
    const divisor =
      typeof branch.exposure_unit_divisor === "number" &&
      branch.exposure_unit_divisor !== 0
        ? branch.exposure_unit_divisor
        : 1;
    // The branch's product is added, not multiplied, into the upstream
    // premium. v1 evaluates only base ×
    // lcm / divisor; factor_lookups support is a v2 extension that
    // requires the runtime to receive a factor-table catalog through
    // ctx.
    const contribution = (base * lcm) / divisor;
    return {
      fired: true,
      contribution,
      premium_out: premium + contribution,
    };
  },
  explainStep: (_inputs, params, outputs) => {
    if (!outputs.fired) {
      return `${params.display_name}: trigger did not match — branch did not fire.`;
    }
    const c = outputs.contribution.toFixed(2);
    return `${params.display_name}: trigger fired — branch contributed $${c}.`;
  },
};
