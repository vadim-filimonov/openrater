/**
 * <ChainFactorKindSelect> — picks the KIND of a chain factor.
 *
 * The first step in the factor-editor flow (Brief 8 §B): the actuary
 * picks what kind of factor they want (constant / direct lookup /
 * class lookup / range lookup / formula). The per-kind config form
 * renders next based on the picked kind.
 *
 * ## Why this is a separate primitive
 *
 * The kind list is the canonical mapping from substrate block-kind
 * IDs (snake_case, internal) to actuary-language labels. Other
 * primitives + the route layer will consult this catalog:
 *
 *   · The factor editor drawer (M4.3.3) uses this select as its
 *     first field.
 *   · RatingChainCard (M4.3) displays the SAME kind labels via
 *     `factor.kind` — sourcing them from the same catalog keeps
 *     UI text consistent.
 *
 * ## Naming decision (Brief 8 §B Q1)
 *
 * `lookup.classification` is the substrate block-kind id (matches
 * the 18-canonical-block-kind registry). The user-facing label is
 * "Class" — matches the existing convention of one-word actuary
 * terms. Other kinds picked similarly:
 *
 *   constant              → "Constant"
 *   lookup.direct         → "Direct lookup"
 *   lookup.classification → "Class"
 *   lookup.range          → "Range lookup"
 *   formula               → "Formula"
 *   flat_factor           → "Flat factor"
 *
 * The substrate block-kind id stays in the `value`; only the
 * display label changes.
 *
 * Brief 34 PR 34.7: `curve.evaluate` was removed. Brief 19's
 * curve concept is superseded by 1-D banded factor tables
 * rendered via <FactorTableViz> (the canonical curve viz).
 */

import "./ChainFactorKindSelect.css";

/**
 * Canonical chain-factor kind ids. Mirror the substrate's block-kind
 * registry (`packages/contracts/src/block-types.ts`). When a new
 * kind ships in the substrate, add an entry here + a label in
 * `FACTOR_KIND_LABELS`.
 */
export type ChainFactorKind =
  | "constant"
  | "lookup.direct"
  | "lookup.classification"
  | "lookup.range"
  | "formula"
  | "flat_factor";

/**
 * Frozen ordered list of every supported kind. Drives the select's
 * option order — most-common-first (Constant + Direct + Class) for
 * the BOP-shaped use case.
 */
export const FACTOR_KIND_OPTIONS: readonly ChainFactorKind[] = Object.freeze([
  "constant",
  "lookup.direct",
  "lookup.classification",
  "lookup.range",
  "flat_factor",
  "formula",
]);

/**
 * Actuary-language labels keyed by canonical kind id. Per Brief 8's
 * naming decision: one-word labels where possible, two-word fallback
 * when the kind itself is more specific.
 */
export const FACTOR_KIND_LABELS: Readonly<Record<ChainFactorKind, string>> =
  Object.freeze({
    constant: "Constant",
    "lookup.direct": "Direct lookup",
    "lookup.classification": "Class",
    "lookup.range": "Range lookup",
    formula: "Formula",
    flat_factor: "Flat factor",
  });

/**
 * Short hint per kind — surfaces under the select when an option
 * is focused or below the field as helper text.
 */
export const FACTOR_KIND_HINTS: Readonly<Record<ChainFactorKind, string>> =
  Object.freeze({
    constant: "A fixed value baked into the plan (e.g., 0.95).",
    "lookup.direct":
      "Key → factor lookup (e.g., construction class → factor).",
    "lookup.classification":
      "Class-code → factor lookup. Uses the class library.",
    "lookup.range":
      "Bucketed range lookup (e.g., TIV band → factor).",
    formula: "Computed expression (e.g., min(a, b) / c).",
    flat_factor: "Single-factor wrapper (IRPM-style).",
  });

export interface ChainFactorKindSelectProps {
  /** Currently-selected kind. Pass empty string for unset / new
   *  factor — the select shows the placeholder. */
  readonly value: ChainFactorKind | "";
  /** Fires when the actuary picks a kind. */
  readonly onChange: (kind: ChainFactorKind) => void;
  /** Optional placeholder text (default: "Pick a factor kind…"). */
  readonly placeholder?: string;
  /** Optional aria-label override (default: "Factor kind"). */
  readonly ariaLabel?: string;
  /** Whether to show the per-kind hint below the select. Default true. */
  readonly showHint?: boolean;
  readonly disabled?: boolean;
  readonly inputId?: string;
  /** Optional test id. */
  readonly testId?: string;
}

export function ChainFactorKindSelect(
  props: ChainFactorKindSelectProps,
): JSX.Element {
  const {
    value,
    onChange,
    placeholder = "Pick a factor kind…",
    ariaLabel = "Factor kind",
    showHint = true,
    disabled,
    inputId,
    testId = "rater-chain-factor-kind-select",
  } = props;

  const hint =
    value !== "" && showHint ? FACTOR_KIND_HINTS[value] : undefined;

  return (
    <div className="rater-chain-factor-kind-select" data-testid={testId}>
      <select
        className="rater-chain-factor-kind-select__field"
        value={value}
        onChange={(e) => onChange(e.target.value as ChainFactorKind)}
        aria-label={ariaLabel}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(inputId !== undefined ? { id: inputId } : {})}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {FACTOR_KIND_OPTIONS.map((kind) => (
          <option key={kind} value={kind}>
            {FACTOR_KIND_LABELS[kind]}
          </option>
        ))}
      </select>
      {hint !== undefined && (
        <div
          className="rater-chain-factor-kind-select__hint"
          role="note"
          aria-live="polite"
        >
          {hint}
        </div>
      )}
    </div>
  );
}
