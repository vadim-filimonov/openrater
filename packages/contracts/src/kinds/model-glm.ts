/**
 * `model.glm` kind — generalized linear model inference.
 *
 * Per Plan Format Spec v1 §4.5: takes a record of feature values and
 * a set of model coefficients (linear predictor + link function),
 * returns a `model_output` with the predicted value and per-feature
 * contributions.
 *
 * Detachment Brief 1 §4 S1 — ONE path in OpenRater:
 *
 *   · **Inline coefficients** (`params.coefficients` + `intercept` +
 *     `link`) evaluate directly through the shared pure GLM core
 *     (`evaluateGlm`, ../glm-math) — `predicted` = link(β₀ + Σ βᵢxᵢ),
 *     with per-feature `contributions`. Zero binary deps (a coefficient
 *     table IS a model — filed coefficients are typed plan data).
 *
 * The registry-governed path (`params.modelId` with no inline
 * coefficients) is RETIRED with the Model Lab cut: OpenRater has no
 * model registry, and per ADR-0056 the kind refuses at execute rather
 * than improvising the old identity-1.0 stub.
 */

import type { BlockKind, PortSpec } from "../block-types";
import { evaluateGlm } from "../glm-math";

/** S1 refusal — a governed-by-id GLM cannot resolve in OpenRater. */
export const GLM_REGISTRY_RETIRED_MESSAGE =
  "model.glm: registry-governed models are not supported in OpenRater — " +
  "provide inline coefficients (a filed coefficient table is typed plan " +
  "data), or supply the score as a declared input.";

export interface GlmModelParams {
  /** Model registry id (resolved against Model Lab when it exists). */
  modelId: string;
  /** Model version pin (content hash or version tag). */
  version?: string;
  /** Optional inline coefficients for ungoverned use (testing, draft plans). */
  coefficients?: Readonly<Record<string, number>>;
  /** Intercept term for the linear predictor. */
  intercept?: number;
  /** Link function. */
  link?: "identity" | "log" | "logit";
  /** Human-readable model name. */
  modelName?: string;
  /** Citation reference. */
  citation?: string;
}

export type GlmModelInputs = { features: Readonly<Record<string, number>> };
export type GlmModelOutputs = {
  predicted: number;
  contributions: Readonly<Record<string, number>>;
};

export const GlmModelKind: BlockKind<
  GlmModelParams,
  GlmModelInputs,
  GlmModelOutputs
> = {
  id: "model.glm",
  category: "model",
  label: "GLM model",
  description:
    "Generalized linear model inference — inline coefficients evaluate directly; governed models resolve via Model Lab",
  inputs: [
    {
      name: "features",
      type: "record",
      description: "Feature values keyed by feature name",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "predicted",
      type: "float",
      description:
        "The linear predictor evaluated through the link function",
    } as PortSpec,
    {
      name: "contributions",
      type: "record",
      description: "Per-feature contribution to the predicted value",
    } as PortSpec,
  ],
  defaultParams: {
    modelId: "",
    intercept: 0,
    link: "identity",
  },
  defaultSize: "regular",
  provenance: "core",
  certainty: "experimental",
  determinism: "strict",
  sideEffects: "none",
  execute: (inputs, params) => {
    // Inline coefficients evaluate for REAL through the shared pure GLM
    // core (zero binary deps — a coefficient table IS a model). The
    // governed-by-id path refuses (S1): no registry exists to resolve
    // it, and identity-1.0 would be a silent improvisation (ADR-0056).
    if (params.coefficients && Object.keys(params.coefficients).length > 0) {
      const { output, contributions } = evaluateGlm(
        {
          coefficients: params.coefficients,
          intercept: params.intercept ?? 0,
          link: params.link ?? "identity",
        },
        inputs.features,
      );
      return { predicted: output, contributions: contributions ?? {} };
    }
    throw new Error(GLM_REGISTRY_RETIRED_MESSAGE);
  },
  validate: (params) => {
    const hasInlineCoeffs =
      !!params.coefficients && Object.keys(params.coefficients).length > 0;
    // Inline coefficients evaluate for real (62.5 PR1) — ungoverned, so
    // nudge toward pinning a Model Lab version for a *filed* factor.
    if (hasInlineCoeffs) {
      return {
        valid: true,
        issues: [
          {
            severity: "info",
            message:
              "Evaluating inline GLM coefficients (ungoverned). Pin a Model Lab model version for a filed, audited factor.",
            field: "coefficients",
          },
        ],
      };
    }
    // No inline coefficients (with or without a modelId): the governed
    // path is retired — surface the refusal at authoring time so nobody
    // discovers it at rating time (Validate-early, P-N6).
    return {
      valid: false,
      issues: [
        {
          severity: "error",
          message: GLM_REGISTRY_RETIRED_MESSAGE,
          field: "coefficients",
        },
      ],
    };
  },
};
