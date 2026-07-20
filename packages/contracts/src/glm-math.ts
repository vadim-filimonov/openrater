/**
 * Pure GLM math — the deterministic core the `model.glm` kind evaluates
 * inline coefficients through (Plan Format Spec v1 §4.5).
 *
 * OpenRater keeps this small mathematical core without registry, format-adapter,
 * or external evaluator machinery: a coefficient table is the model. Zero
 * binary dependencies, pure and total.
 */

/** The PURE prediction an adapter computes — no clock, no cache. */
export interface ModelPrediction {
  /** model.rating → the factor; model.glm → the predicted value. For an
   *  `irpm_sections` model the headline scalar is the section sum. */
  readonly output: number;
  /** model.glm → per-feature contributions (linear-predictor scale). */
  readonly contributions?: Readonly<Record<string, number>>;
  /** Named sub-section outputs (an `irpm_sections` model emits the 6
   *  schedule sub-sections here; the IRPM binding sums + caps them). */
  readonly sections?: Readonly<Record<string, number>>;
  /** Models with uncertainty → 95% CI. */
  readonly prediction_interval?: { readonly lower: number; readonly upper: number };
}
/** The link function applied to the linear predictor. */
export type GlmLink = "identity" | "log" | "logit";

/** One bucket of a `bucketize` transform — `x` maps to `value` when it falls
 *  in the FIRST bucket whose `max` ≥ x (`max: null` = +∞ catch-all, last). */
export interface GlmBucket {
  readonly max: number | null;
  readonly value: number;
}

/**
 * An optional per-term transform applied to the raw feature `x` BEFORE the
 * coefficient multiplies it: `term = β · transform(x)` (E07 / ADR-015).
 *
 * Lets a GLM use a non-raw feature (e.g. `ln(sqft)`, `age²`, banded TIV)
 * without a pre-computed input. Back-compat: a term with no transform is
 * `identity` (the prior `β·x`). Deterministic + total — a non-finite
 * transformed value (e.g. `log` of a non-positive `x`) contributes 0, the
 * same baseline an absent feature gets.
 */
export type GlmTransform =
  | { readonly kind: "identity" }
  | { readonly kind: "log"; readonly base?: number } // ln(x), or log_base(x)
  | { readonly kind: "pow"; readonly exponent: number } // x ** exponent
  | { readonly kind: "bucketize"; readonly bins: readonly GlmBucket[] }
  // Brief 65 §A.1b — a categorical level → coefficient lookup. Lets a GLM term
  // be a raw CATEGORY (e.g. construction_class) instead of a number: the term's
  // contribution is `map[String(x)]`, or `fallback` for an unknown/absent level
  // (the reference level folds into the intercept ⇒ fallback is typically 0).
  // Unlike the numeric transforms, this reads the RAW feature value, so
  // evaluateGlm dispatches it before the numeric coercion (a number passed
  // straight to applyGlmTransform has no category and returns `fallback`).
  | {
      readonly kind: "categorical";
      readonly map: Readonly<Record<string, number>>;
      readonly fallback: number;
    };

/** A parsed GLM coefficient table — the portable, inspectable artifact. */
export interface GlmCoeffSpec {
  /** Per-feature coefficients (term name → β). */
  readonly coefficients: Readonly<Record<string, number>>;
  /** Intercept (β₀). */
  readonly intercept: number;
  readonly link: GlmLink;
  /** Optional per-term feature transforms (E07). Keyed by the same term
   *  names as `coefficients`; a term absent here is `identity`. */
  readonly transforms?: Readonly<Record<string, GlmTransform>>;
}

/**
 * Apply a per-term transform to a raw feature value. Pure + total — never
 * throws; an out-of-domain input (e.g. `log` of `x ≤ 0`) returns a non-finite
 * value that `evaluateGlm` then floors to a 0 contribution (E07).
 */
export function applyGlmTransform(transform: GlmTransform, x: number): number {
  switch (transform.kind) {
    case "identity":
      return x;
    case "log": {
      const ln = Math.log(x);
      return transform.base !== undefined ? ln / Math.log(transform.base) : ln;
    }
    case "pow":
      return Math.pow(x, transform.exponent);
    case "bucketize": {
      for (const b of transform.bins) {
        if (b.max === null || x <= b.max) return b.value;
      }
      return 0; // no bucket matched (no catch-all) → baseline
    }
    case "categorical":
      // Categorical reads the RAW value, not a number — `evaluateGlm` handles
      // it via `applyCategoricalTransform`. A bare numeric call here has no
      // category, so it yields the fallback (totality).
      return transform.fallback;
  }
}

/** Apply a categorical transform to a RAW feature value (Brief 65 §A.1b).
 *  `map[String(x)]` for a known level, else `fallback`. Pure + total. */
export function applyCategoricalTransform(
  transform: { readonly map: Readonly<Record<string, number>>; readonly fallback: number },
  raw: unknown,
): number {
  if (raw === null || raw === undefined) return transform.fallback;
  const coef = transform.map[String(raw)];
  return coef === undefined ? transform.fallback : coef;
}

/** Apply the GLM link to a linear predictor. Pure + total. */
export function applyGlmLink(linearPredictor: number, link: GlmLink): number {
  switch (link) {
    case "identity":
      return linearPredictor;
    case "log":
      return Math.exp(linearPredictor);
    case "logit":
      return 1 / (1 + Math.exp(-linearPredictor));
  }
}

/**
 * Evaluate a GLM coefficient table against a feature record — the pure
 * actuarial core shared by the `glm_coeff` adapter AND the `model.glm`
 * kind (one implementation, no drift).
 *
 * `output` = link(β₀ + Σ βᵢ·tᵢ(xᵢ)). `tᵢ` is the term's optional transform
 * (E07; identity when none). `contributions` are the per-feature terms
 * βᵢ·tᵢ(xᵢ) on the linear-predictor scale (the actuarial-standard
 * explanation). An absent / non-finite feature — or a transform that yields
 * a non-finite value — contributes 0 (the baseline). Deterministic by
 * construction; the registry's feature-schema validation (consumer brief)
 * is what enforces presence of *required* features upstream of scoring.
 */
export function evaluateGlm(
  spec: GlmCoeffSpec,
  features: Readonly<Record<string, unknown>>,
): ModelPrediction {
  let linearPredictor = spec.intercept;
  const contributions: Record<string, number> = {};
  for (const [name, beta] of Object.entries(spec.coefficients)) {
    const raw = features[name];
    const transform = spec.transforms?.[name];
    // Categorical reads the raw value; numeric transforms read the coerced x.
    const fx =
      transform?.kind === "categorical"
        ? applyCategoricalTransform(transform, raw)
        : transform
          ? applyGlmTransform(transform, typeof raw === "number" && Number.isFinite(raw) ? raw : 0)
          : typeof raw === "number" && Number.isFinite(raw)
            ? raw
            : 0;
    const safe = Number.isFinite(fx) ? fx : 0;
    const raw_term = beta * safe;
    // Normalize -0 → 0 so contributions serialize identically in TS
    // (JSON.stringify(-0) === "0") and Python's mirror.
    const term = raw_term === 0 ? 0 : raw_term;
    contributions[name] = term;
    linearPredictor += term;
  }
  return { output: applyGlmLink(linearPredictor, spec.link), contributions };
}
