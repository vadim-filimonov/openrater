/**
 * `model.rating` kind — ML-derived rating factor (STUB).
 *
 * Per Plan Format Spec v1 §4.5: takes a record of feature values and
 * a trained ML model reference, returns a single multiplicative
 * `factor` to apply in a rating chain. Distinct from `model.glm`
 * which returns a structured `model_output` — `model.rating` is the
 * "give me one number to multiply" convenience kind for chains that
 * consume models as factors.
 *
 * STUB IMPLEMENTATION — same story as `model.glm`: the kind exists so
 * plans can declare model references; the real impl is gated on
 * Model Lab (W4 amendment Phase 4 / V.23.A2). Until then, returns
 * 1.0 (identity factor) so the chain still runs.
 *
 * `clampLo` / `clampHi` apply to the stub's output too, so a chain
 * that wraps the model factor with a [0.5, 2.0] guardrail still
 * sees the guardrail respected even when the model is mocked.
 *
 * Ported from `<prototype>/plan-builder/src/blocks/kinds/
 * model-rating.tsx` (Phase A.1 PR 9). PURE half only.
 */

import type { BlockKind, PortSpec } from "../block-types";

export interface RatingModelParams {
  /** Model registry id (resolved against Model Lab when it exists). */
  modelId: string;
  /** Model version pin (content hash or version tag). */
  version?: string;
  /** Optional clamp on the returned factor (e.g., [0.5, 2.0]). */
  clampLo?: number;
  clampHi?: number;
  /** Human-readable model name. */
  modelName?: string;
  /** Citation reference. */
  citation?: string;
}

export type RatingModelInputs = {
  features: Readonly<Record<string, number>>;
};
export type RatingModelOutputs = { value: number };

export const RatingModelKind: BlockKind<
  RatingModelParams,
  RatingModelInputs,
  RatingModelOutputs
> = {
  id: "model.rating",
  category: "model",
  label: "Rating model (stub)",
  description:
    "ML-derived rating factor — placeholder until Model Lab lands",
  inputs: [
    {
      name: "features",
      type: "record",
      description: "Feature values keyed by feature name",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "value",
      type: "factor",
      description: "The rating factor returned by the model",
    } as PortSpec,
  ],
  defaultParams: {
    modelId: "",
  },
  defaultSize: "compact",
  provenance: "core",
  certainty: "experimental",
  determinism: "strict",
  sideEffects: "none",
  execute: (_inputs, params) => {
    const raw = 1.0;
    let clamped = raw;
    if (typeof params.clampLo === "number" && clamped < params.clampLo) {
      clamped = params.clampLo;
    }
    if (typeof params.clampHi === "number" && clamped > params.clampHi) {
      clamped = params.clampHi;
    }
    return { value: clamped };
  },
  validate: (params) => {
    if (!params.modelId || params.modelId.trim() === "") {
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message:
              "modelId is empty; the stub will return 1.0 until Model Lab is available",
            field: "modelId",
          },
        ],
      };
    }
    if (
      typeof params.clampLo === "number" &&
      typeof params.clampHi === "number" &&
      params.clampLo > params.clampHi
    ) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "clampLo must be ≤ clampHi",
            field: "clampLo",
          },
        ],
      };
    }
    return {
      valid: true,
      issues: [
        {
          severity: "warning",
          message:
            "Rating model is a stub; the real implementation is gated on Model Lab (W4 Phase 4)",
          field: "modelId",
        },
      ],
    };
  },
};
