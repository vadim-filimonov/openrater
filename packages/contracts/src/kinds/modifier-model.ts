/**
 * `modifier.model` kind — model-wrapped IRPM.
 *
 * Brief 41 (model-wrapped IRPM). A modifier whose factor comes from
 * an external pricing model (GLM, gradient-boosted, neural, etc.)
 * but is gated by filed safeguards: a clamp envelope (min/max
 * factor) + a fallback factor when any required input is missing.
 *
 * Per Brief 41 §−1 Q4-Q7 + Brief 42 §−1 Q6, the runtime contract:
 *
 *   1. Read each `declared_inputs[i]` from ctx.externalInputs (using
 *      its `variable` name).
 *
 *   2. If ANY declared_input is missing → FALLBACK path:
 *      - factor_used = fallback_factor
 *      - fallback_fired = true
 *      - fallback_reason = "missing_input:{first_missing_variable}"
 *      - The clamp is NOT evaluated (the model never ran; nothing to
 *        clamp). The fallback factor is applied verbatim.
 *
 *   3. If all declared_inputs are present → NORMAL path:
 *      - In v1 the actual model evaluation is a STUB returning 1.0
 *        (the substrate exists; real model integration lands when
 *        Model Lab ships).
 *      - The clamp envelope IS applied: factor_used =
 *        clamp(model_factor, min_factor, max_factor).
 *      - fallback_fired = false; fallback_reason = null.
 *
 *   4. Output: premium_out = premium × factor_used.
 *
 * The output port set mirrors Brief 41's 3-line trace contract:
 *   declared_inputs / fallback_fired / factor_used. The renderer
 *   surfaces these three lines on the modifier chip + trace step.
 *
 * No special-casing in the runtime — execute is pure + deterministic
 * + reads from `ctx.externalInputs` directly.
 *
 * V19 conformance vector locks the fallback path verbatim. The
 * present-input path is exercised by an internal stub test (1.0
 * factor returned) until Model Lab ships the actual evaluator.
 */

import type { BlockKind, PortSpec } from "../block-types";

/** Where a model input comes from. v1 only "input" (externalInputs);
 *  v2 could add "trace" (an upstream node's output) when the user
 *  wants to feed model an internal signal. */
export type ModelInputSource = "input";

export interface ModelInputDeclaration {
  /** The externalInputs key the runtime reads. */
  readonly variable: string;
  /** Where the input comes from. v1 always "input". */
  readonly source: ModelInputSource;
}

export interface ModelClampEnvelope {
  /** Inclusive lower bound on the model's output factor. */
  readonly min_factor: number;
  /** Inclusive upper bound on the model's output factor. */
  readonly max_factor: number;
}

export interface ModifierModelParams {
  /** Stable identifier for the model — surfaces in audit + trace. */
  readonly model_id: string;
  /** Version of the model (e.g., "2026.05"). */
  readonly version: string;
  /** The inputs the model REQUIRES. Missing any → fallback path. */
  readonly declared_inputs: readonly ModelInputDeclaration[];
  /** Filed clamp envelope. min ≤ max enforced at validation time. */
  readonly clamp: ModelClampEnvelope;
  /** Why this clamp envelope was filed (carrier audit trail). */
  readonly rationale: string;
  /** Factor applied when ANY declared_input is missing. */
  readonly fallback_factor: number;
}

export interface ModifierModelInputs {
  /** Premium to apply the model factor to. */
  readonly premium: number;
}

export interface ModifierModelOutputs {
  /** Final factor applied (clamped model factor OR fallback_factor). */
  factor_used: number;
  /** Premium after applying the factor. */
  premium_out: number;
  /** True when fallback fired (missing input). */
  fallback_fired: boolean;
  /** When fallback fired: "missing_input:{variable}"; null otherwise. */
  fallback_reason: string | null;
}

export const ModifierModelKind: BlockKind<
  ModifierModelParams,
  ModifierModelInputs,
  ModifierModelOutputs
> = {
  id: "modifier.model",
  category: "chain",
  label: "Model modifier",
  description:
    "Model-driven multiplicative factor with filed clamp + fallback safeguards (Brief 41).",
  inputs: [
    {
      name: "premium",
      type: "float",
      description: "Premium to apply the model factor to.",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "factor_used",
      type: "factor",
      description:
        "Final factor applied — clamped model output OR fallback when triggered.",
    } as PortSpec,
    {
      name: "premium_out",
      type: "float",
      description: "Premium × factor_used.",
    } as PortSpec,
    {
      name: "fallback_fired",
      type: "bool",
      description: "True when fallback path fired (any declared_input missing).",
    } as PortSpec,
    {
      name: "fallback_reason",
      type: "string",
      description:
        "When fallback fired: `missing_input:{variable}`. Null otherwise.",
    } as PortSpec,
  ],
  defaultParams: {
    model_id: "untitled_model",
    version: "0.0.1",
    declared_inputs: [],
    clamp: { min_factor: 0.85, max_factor: 1.25 },
    rationale: "Default conservative envelope; filed cap pending.",
    fallback_factor: 1.0,
  },
  defaultSize: "regular",
  execute: (inputs, params, ctx) => {
    const externalInputs = ctx?.externalInputs ?? {};

    // Walk declared_inputs in order. The first missing one fires
    // fallback. Brief 41 §−1 Q6 case 2 — the runtime stops at the
    // first missing input rather than collecting all of them; the
    // user only needs to know about the first hole to know the
    // model can't run.
    for (const decl of params.declared_inputs) {
      if (externalInputs[decl.variable] === undefined) {
        const factor_used = params.fallback_factor;
        return {
          factor_used,
          premium_out: inputs.premium * factor_used,
          fallback_fired: true,
          fallback_reason: `missing_input:${decl.variable}`,
        };
      }
    }

    // All declared_inputs present → normal path. v1 STUB returns 1.0
    // (the substrate is in place; Model Lab integration is what
    // turns this into a real evaluation). The clamp IS applied so
    // the filed envelope is enforced even on the stub path —
    // important for the cold-test (a misconfigured clamp surfaces
    // early instead of waiting for Model Lab).
    const modelStubFactor = 1.0;
    const { min_factor, max_factor } = params.clamp;
    const factor_used = Math.min(
      Math.max(modelStubFactor, min_factor),
      max_factor,
    );
    return {
      factor_used,
      premium_out: inputs.premium * factor_used,
      fallback_fired: false,
      fallback_reason: null,
    };
  },
  validate: (params) => {
    if (!params.model_id || params.model_id.trim() === "") {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "model_id is required.",
            field: "model_id",
          },
        ],
      };
    }
    if (params.clamp.min_factor > params.clamp.max_factor) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: `clamp.min_factor (${params.clamp.min_factor}) must be ≤ clamp.max_factor (${params.clamp.max_factor}).`,
            field: "clamp",
          },
        ],
      };
    }
    if (
      typeof params.fallback_factor !== "number" ||
      !Number.isFinite(params.fallback_factor)
    ) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "fallback_factor must be a finite number.",
            field: "fallback_factor",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (_inputs, params, outputs) => {
    if (outputs.fallback_fired) {
      return `${params.model_id} v${params.version}: fallback fired (${outputs.fallback_reason}) → factor ${outputs.factor_used.toFixed(4)}.`;
    }
    return `${params.model_id} v${params.version}: model factor ${outputs.factor_used.toFixed(4)} (clamped to [${params.clamp.min_factor}, ${params.clamp.max_factor}]).`;
  },
};
