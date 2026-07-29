/**
 * <EndorsementEditor> — Brief 39 PR 39.4.
 *
 * Authoring surface for one endorsement (form-based add-on that
 * auto-attaches when its trigger condition matches the input).
 * Endorsements are the third pillar of Gate workspace v2 — pre-chain
 * filters short-circuit, mid-chain modifiers adjust, and post-chain
 * endorsements attach. Brief 39 §4 + §8.
 *
 * Three effect kinds share the editor (Brief 39 §−1 Q4 lock):
 *
 *   · `factor`   — multiplies the chain premium by N
 *                  (e.g., BP 04 39 Liquor liability ×1.15)
 *   · `additive` — adds a flat $ amount to premium
 *                  (e.g., BP 05 21 Wind/hail +$250)
 *   · `sublimit` — caps a named coverage at $N; premium
 *                  passes through unchanged
 *                  (e.g., BP 04 30 Peak-limit endorsement)
 *
 * All three substrate kinds are shipped in PR 39.1 with V17
 * conformance covering chained attachment.
 *
 * Form-number authoring (Brief 39 §−1 Q9 lock):
 *   Free text input + a Suggested dropdown sourced from a static
 *   fixture list of well-known ISO BOP forms (BP 04 30, BP 14 87,
 *   etc.). Real vocabulary integration via Class Translator lands
 *   in v2.
 *
 * Trigger picker (single-condition v1, Brief 39 §11):
 *   `variable op value` matching the substrate's
 *   `EndorsementTrigger` shape. Empty variable = "always attach".
 *   The picker mirrors FilterRuleEditor's quick-form pattern
 *   (field dropdown / op dropdown / value input).
 *
 * Inputs integration (Brief 39 §6, §−1 Q3 STRICT lock):
 *   When the trigger references a field that isn't in the Inputs
 *   mapping (`availableFields`), the editor renders a hard-mismatch
 *   banner at the top + disables save. The parent (PR 39.6) computes
 *   `unmappedReferences` via `getReferencedFields` and passes it in.
 *
 * Pure controlled component. Parent owns the EndorsementDraft;
 * mutations fire via onChange. Save/cancel fire after parent-side
 * `isEndorsementDraftValid` check.
 */

import { useId, useState, type JSX } from "react";
import { Plus, ChevronDown, Trash2 } from "lucide-react";
import "./EndorsementEditor.css";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * Comparison operators for the trigger condition. Matches the
 * `EligibilityOp` set in @openrater/contracts 1:1; redeclared locally
 * to keep labs-ui independent of contracts at the type level
 * (same convention as FilterRuleEditor).
 */
export type EndorsementOp =
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "in"
  | "nin";

export const ENDORSEMENT_OPS: readonly EndorsementOp[] = Object.freeze([
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "in",
  "nin",
] as const);

export const ENDORSEMENT_OP_LABELS: Readonly<Record<EndorsementOp, string>> = {
  eq: "=",
  ne: "≠",
  lt: "<",
  le: "≤",
  gt: ">",
  ge: "≥",
  in: "∈",
  nin: "∉",
};

/**
 * Endorsement effect kinds.
 *
 * Brief 39 §−1 Q4 locked three v1 kinds (factor / additive / sublimit).
 * Brief 40 §−1 Q1 (locked 2026-05-26) adds the 4th: `rate_branch` —
 * the endorsement runs its own embedded mini rating chain when its
 * trigger fires; the chain output is added to the policy premium
 * (post-base-chain, pre-modifier).
 */
export type EndorsementEffectKind =
  | "factor"
  | "additive"
  | "sublimit"
  | "rate_branch";

/**
 * Phase G G4.B (Brief 40) — minimum-viable branch-chain draft.
 *
 * The branch chain is authored as a flat set of fields. Factor lookups
 * are out of scope for the v1 editor (a follow-up PR adds a compact
 * RatingChainCard for in-place authoring per Brief 40 §−1 Q7); the user
 * can still author basic shapes (base × LCM + exposure divisor) +
 * persist round-trip via the API.
 */
/**
 * One factor lookup row inside a branch chain. Compact 1-D form per
 * Brief 40 §−1 Q7 — author the most common shape (lookup.direct
 * keyed on one dimension) inline; complex shapes (multi-dim,
 * curve.evaluate, lookup.range) still author via the top-level
 * RatingChainCard.
 *
 * Round-trip: projects to a ChainSpec.factor_lookups entry of shape
 *   { name, factor_kind, dimensions: { [dim_slug]: { source, path } } }
 *
 * NB: the v1 EndorsementRateBranchKind runtime IGNORES factor_lookups
 * (executes base × lcm / divisor only). Authored lookups round-trip
 * via the API + persist to the substrate; the runtime applies them
 * once a future PR threads a factor-table catalog through ctx.
 * RateBranchFields surfaces this gap with a visible hint so the
 * actuary's expectation matches reality.
 */
export interface BranchFactorLookupRow {
  /** Stable id for keyed render. */
  readonly id: string;
  /** Human-readable name surfaced in the trace (e.g., "territory_factor"). */
  readonly name: string;
  /** Factor-table slug this lookup points to (e.g., "liquor_territory_v1"). */
  readonly factor_kind: string;
  /** Dimension slug the lookup keys on (e.g., "state"). v1 supports
   *  1-D lookups; multi-dim composite lookups author via the top-
   *  level RatingChainCard. */
  readonly dim_slug: string;
  /** Form-input path supplying the dim's value at score time (e.g.,
   *  "form_input.state"). */
  readonly source_path: string;
}

export interface BranchChainDraft {
  /** Chain identifier (e.g., "liquor_premium"). */
  readonly name: string;
  /** Form-input path the chain uses as its base (e.g.,
   * "form_input.liquor_receipts"). */
  readonly base_input: string;
  /** Form-input path the chain uses as its exposure (often the same
   * as base_input for simple endorsements). */
  readonly exposure_input: string;
  /** Divisor for the exposure (e.g., 1000 for per-$1k rating). */
  readonly exposure_unit_divisor: number;
  /** Form-input path for the LCM (carrier-set). */
  readonly lcm_input_path: string;
  /** Field name the chain writes to in the output namespace. */
  readonly output_field: string;
  /** Phase H.5 — Inline factor lookups (Brief 40 §−1 Q7). Empty by
   *  default; populated rows project to ChainSpec.factor_lookups on
   *  save. NB: runtime v1 ignores these — see BranchFactorLookupRow. */
  readonly factor_lookups: readonly BranchFactorLookupRow[];
}

/**
 * Single trigger row. Draft-level keeps `variable` + `value` as
 * strings; persistence converts to the substrate's `unknown` value
 * at save time. Empty variable = no trigger = always attach.
 */
export interface EndorsementTriggerRow {
  readonly variable: string;
  readonly op: EndorsementOp;
  readonly value: string;
}

export interface EndorsementDraft {
  readonly endorsement_id: string;
  /** ISO form number or custom string (e.g., "BP 04 30"). */
  readonly form_number: string;
  readonly display_name: string;
  /**
   * Trigger condition. When `variable` is empty, the endorsement
   * always attaches (matches substrate's `trigger: null` semantics).
   */
  readonly trigger: EndorsementTriggerRow;
  readonly effect_kind: EndorsementEffectKind;

  // ── factor effect ──────────────────────────────────────────
  /** Multiplier when effect_kind === "factor" (e.g., 1.15). */
  readonly factor: number;

  // ── additive effect ────────────────────────────────────────
  /** Amount when effect_kind === "additive" (e.g., 250). */
  readonly amount: number;

  // ── sublimit effect ────────────────────────────────────────
  /** Coverage name being capped (e.g., "peak_items"). */
  readonly sublimit_coverage: string;
  /** Cap value (e.g., 100000). */
  readonly sublimit_value: number;

  // ── rate_branch effect (Phase G G4.B, Brief 40) ────────────
  /** Branch chain authored when effect_kind === "rate_branch".
   *  Always present in the draft for round-trip stability — fields
   *  are empty by default + ignored by other effect kinds. */
  readonly branch_chain: BranchChainDraft;

  readonly citation: string;
}

export interface EndorsementFieldRef {
  readonly id: string;
  readonly type?: string;
  /**
   * Phase G G2 — picker grouping. Same semantics as
   * `FilterFieldRef.category`: when ANY ref has a category, the
   * editor's `<select>` groups options under "Inputs" + "Dimensions"
   * `<optgroup>` headings. Backward-compat: empty → flat list.
   */
  readonly category?: "input" | "dimension";
  /**
   * Phase G G2 — dimension display label, shown beside the slug in
   * the picker (e.g., "ntee_major · NTEE major"). Ignored when
   * `category !== "dimension"`.
   */
  readonly label?: string;
}

/** One suggested form number (sourced from a static fixture list). */
export interface EndorsementFormSuggestion {
  readonly form_number: string;
  readonly display_name: string;
  /** Optional suggested effect kind — clicking the suggestion
   *  pre-fills `effect_kind` if provided. */
  readonly effect_kind?: EndorsementEffectKind;
}

export interface EndorsementEditorProps {
  readonly draft: EndorsementDraft;
  /** Mapped input fields from Plan.input_mapping.column_map. */
  readonly availableFields: readonly EndorsementFieldRef[];
  /**
   * Variables referenced in the draft that aren't in `availableFields`.
   * Parent (PR 39.6) computes via `getReferencedFields`. Save blocks
   * when non-empty (Brief 39 §−1 Q3 STRICT lock).
   */
  readonly unmappedReferences?: readonly string[];
  /** Optional form-number suggestion list. Defaults to ISO BOP fixtures. */
  readonly formSuggestions?: readonly EndorsementFormSuggestion[];
  readonly onChange: (next: EndorsementDraft) => void;
  readonly onSave?: () => void;
  readonly onCancel?: () => void;
  /** Fires "Test trigger against sample" affordance. Optional. */
  readonly onTestAgainstSample?: () => void;
  readonly testId?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers (exported pure functions)
// ─────────────────────────────────────────────────────────────────

/**
 * Phase H.5 — fresh row for the inline factor-lookups table. Caller
 * supplies the index for a stable key + non-colliding default id.
 */
export function emptyBranchFactorLookupRow(idx: number): BranchFactorLookupRow {
  return {
    id: `bfl-${idx}`,
    name: "",
    factor_kind: "",
    dim_slug: "",
    source_path: "",
  };
}

export function emptyEndorsementDraft(): EndorsementDraft {
  return {
    endorsement_id: "",
    form_number: "",
    display_name: "",
    trigger: { variable: "", op: "eq", value: "" },
    effect_kind: "factor",
    factor: 1.0,
    amount: 0,
    sublimit_coverage: "",
    sublimit_value: 0,
    // Phase G G4.B — branch_chain is always present in the draft but
    // only authored when effect_kind === "rate_branch". Empty fields
    // by default; isEndorsementDraftValid gates save when the kind is
    // rate_branch.
    branch_chain: {
      name: "",
      base_input: "",
      exposure_input: "",
      exposure_unit_divisor: 1,
      lcm_input_path: "form_input.lcm",
      output_field: "",
      // Phase H.5 — start empty; the user adds rows as needed. Empty
      // is valid (it's the V18-shape: base × lcm / divisor with no
      // factor multipliers).
      factor_lookups: [],
    },
    citation: "",
  };
}

/**
 * True iff the draft is ready to save. Validation is kind-aware:
 *   - All kinds: form_number + display_name non-empty
 *   - Trigger valid only when populated (variable set requires value)
 *   - factor:      factor > 0
 *   - additive:    amount ≠ 0
 *   - sublimit:    coverage non-empty + value > 0
 *   - rate_branch: chain name + base_input + exposure_input +
 *                  output_field non-empty + exposure_unit_divisor > 0
 *                  (Brief 40 §−1 Q8 STRICT — unmapped refs are
 *                  surfaced separately via unmappedReferences[])
 */
export function isEndorsementDraftValid(draft: EndorsementDraft): boolean {
  if (draft.form_number.trim().length === 0) return false;
  if (draft.display_name.trim().length === 0) return false;
  // Trigger: when variable set, value must be set; empty variable = always attach
  if (draft.trigger.variable.length > 0 && draft.trigger.value.length === 0) {
    return false;
  }
  if (draft.effect_kind === "factor") {
    return Number.isFinite(draft.factor) && draft.factor > 0;
  }
  if (draft.effect_kind === "additive") {
    return Number.isFinite(draft.amount) && draft.amount !== 0;
  }
  if (draft.effect_kind === "sublimit") {
    return (
      draft.sublimit_coverage.trim().length > 0 &&
      Number.isFinite(draft.sublimit_value) &&
      draft.sublimit_value > 0
    );
  }
  // rate_branch
  const c = draft.branch_chain;
  if (
    c.name.trim().length === 0 ||
    c.base_input.trim().length === 0 ||
    c.exposure_input.trim().length === 0 ||
    c.output_field.trim().length === 0 ||
    !Number.isFinite(c.exposure_unit_divisor) ||
    c.exposure_unit_divisor <= 0
  ) {
    return false;
  }
  // Phase H.5 — factor_lookups validation: each row must be either
  // fully populated (name + factor_kind + dim_slug + source_path) or
  // entirely empty. A half-filled row blocks save so the user can't
  // accidentally persist a partial reference.
  for (const row of c.factor_lookups) {
    const filled = [
      row.name.trim().length > 0,
      row.factor_kind.trim().length > 0,
      row.dim_slug.trim().length > 0,
      row.source_path.trim().length > 0,
    ];
    const allFilled = filled.every(Boolean);
    const allEmpty = filled.every((b) => !b);
    if (!allFilled && !allEmpty) return false;
  }
  return true;
}

/** True iff the trigger row has both variable + value set. */
export function isTriggerRowComplete(row: EndorsementTriggerRow): boolean {
  return row.variable.length > 0 && row.value.length > 0;
}

/**
 * Returns the input field names this draft's trigger references.
 * Empty array when the trigger is "always attach" (no variable).
 */
export function getReferencedFields(
  draft: EndorsementDraft,
): readonly string[] {
  if (draft.trigger.variable.length === 0) return [];
  return [draft.trigger.variable];
}

// ─────────────────────────────────────────────────────────────────
// Default form suggestions (ISO BOP fixtures — Brief 39 §−1 Q9 lock)
// ─────────────────────────────────────────────────────────────────

export const DEFAULT_FORM_SUGGESTIONS: readonly EndorsementFormSuggestion[] =
  Object.freeze([
    {
      form_number: "BP 04 30",
      display_name: "Peak-limit endorsement",
      effect_kind: "sublimit",
    },
    {
      form_number: "BP 04 39",
      display_name: "Liquor liability",
      effect_kind: "factor",
    },
    {
      form_number: "BP 04 50",
      display_name: "Hired auto / non-owned auto liability",
      effect_kind: "additive",
    },
    {
      form_number: "BP 05 21",
      display_name: "Wind / hail deductible",
      effect_kind: "additive",
    },
    {
      form_number: "BP 14 87",
      display_name: "Water back-up + sump-overflow",
      effect_kind: "additive",
    },
    {
      form_number: "BP 10 02",
      display_name: "Limitation on coverage — roof surfacing",
      effect_kind: "sublimit",
    },
    {
      form_number: "BP 10 90",
      display_name: "Coastal property — wind exclusion",
      effect_kind: "factor",
    },
    {
      form_number: "BP 04 17",
      display_name: "Employee dishonesty",
      effect_kind: "additive",
    },
    {
      form_number: "BP 04 86",
      display_name: "Equipment breakdown",
      effect_kind: "factor",
    },
    {
      form_number: "BP 05 41",
      display_name: "Earthquake — limited",
      effect_kind: "factor",
    },
    {
      form_number: "BP 14 06",
      display_name: "Manuscript endorsement",
      effect_kind: "additive",
    },
    {
      form_number: "BP 04 27",
      display_name: "Computer fraud + funds transfer fraud",
      effect_kind: "sublimit",
    },
  ]);

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function EndorsementEditor(
  props: EndorsementEditorProps,
): JSX.Element {
  const {
    draft,
    availableFields,
    unmappedReferences = [],
    formSuggestions = DEFAULT_FORM_SUGGESTIONS,
    onChange,
    onSave,
    onCancel,
    onTestAgainstSample,
    testId = "rater-endorsement-editor",
  } = props;

  const uid = useId();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const isValid = isEndorsementDraftValid(draft);
  const hasMismatches = unmappedReferences.length > 0;
  const canSave = isValid && !hasMismatches;
  const triggerActive = draft.trigger.variable.length > 0;

  const updateDraft = (patch: Partial<EndorsementDraft>) => {
    onChange({ ...draft, ...patch });
  };

  const updateTrigger = (patch: Partial<EndorsementTriggerRow>) => {
    onChange({ ...draft, trigger: { ...draft.trigger, ...patch } });
  };

  const clearTrigger = () => {
    onChange({
      ...draft,
      trigger: { variable: "", op: "eq", value: "" },
    });
  };

  const applySuggestion = (s: EndorsementFormSuggestion) => {
    onChange({
      ...draft,
      form_number: s.form_number,
      display_name: s.display_name,
      ...(s.effect_kind ? { effect_kind: s.effect_kind } : {}),
    });
    setSuggestionsOpen(false);
  };

  return (
    <section className="rater-endorsement-editor" data-testid={testId}>
      {/* Hard-mismatch banner — Brief 39 §−1 Q3 STRICT lock. */}
      {hasMismatches ? (
        <div
          className="rater-endorsement-editor__mismatch"
          role="alert"
          data-testid={`${testId}-mismatch`}
        >
          <div className="rater-endorsement-editor__mismatch-glyph">!</div>
          <div>
            <h4 className="rater-endorsement-editor__mismatch-title">
              Endorsement trigger references unmapped input
              {unmappedReferences.length > 1 ? "s" : ""}
            </h4>
            <p className="rater-endorsement-editor__mismatch-detail">
              {unmappedReferences.length === 1
                ? "The trigger reads "
                : "The trigger reads "}
              {unmappedReferences.map((f, i) => (
                <span key={f}>
                  {i > 0 && i === unmappedReferences.length - 1
                    ? " and "
                    : i > 0
                      ? ", "
                      : ""}
                  <code>{f}</code>
                </span>
              ))}
              {", but no column in the current Inputs mapping projects to "}
              {unmappedReferences.length === 1 ? "that field" : "those fields"}
              {". Map "}
              {unmappedReferences.length === 1 ? "it" : "them"}
              {" in the Inputs tab, or change the trigger to use available fields."}
            </p>
          </div>
        </div>
      ) : null}

      <header className="rater-endorsement-editor__head">
        <div className="rater-endorsement-editor__head-icon" aria-hidden>
          ⊕
        </div>
        <div className="rater-endorsement-editor__head-text">
          <h3 className="rater-endorsement-editor__head-title">
            {draft.form_number
              ? `${draft.form_number}${draft.display_name ? ` — ${draft.display_name}` : ""}`
              : draft.display_name || "Untitled endorsement"}
          </h3>
          <span className="rater-endorsement-editor__head-sub">
            endorsement · {draft.effect_kind} ·{" "}
            {hasMismatches ? "blocked" : isValid ? "ready" : "draft"}
          </span>
        </div>
      </header>

      <div className="rater-endorsement-editor__body">
        {/* Form number — text input + suggested picker */}
        <div className="rater-endorsement-editor__field">
          <label
            htmlFor={`${uid}-form`}
            className="rater-endorsement-editor__field-label"
          >
            Form number
          </label>
          <div className="rater-endorsement-editor__form-row">
            <input
              id={`${uid}-form`}
              className="rater-endorsement-editor__input is-mono"
              value={draft.form_number}
              placeholder="e.g., BP 04 30"
              onChange={(e) => updateDraft({ form_number: e.target.value })}
              data-testid={`${testId}-form-number`}
            />
            <div className="rater-endorsement-editor__suggest">
              <button
                type="button"
                className={`rater-endorsement-editor__suggest-btn${
                  suggestionsOpen ? " is-open" : ""
                }`}
                onClick={() => setSuggestionsOpen((v) => !v)}
                aria-expanded={suggestionsOpen}
                aria-haspopup="listbox"
                data-testid={`${testId}-suggest-toggle`}
              >
                Suggested
                <ChevronDown size={12} strokeWidth={2} aria-hidden />
              </button>
              {suggestionsOpen ? (
                <div
                  className="rater-endorsement-editor__suggest-menu"
                  role="listbox"
                  data-testid={`${testId}-suggest-menu`}
                >
                  {formSuggestions.map((s) => (
                    <button
                      key={s.form_number}
                      type="button"
                      role="option"
                      aria-selected={draft.form_number === s.form_number}
                      className="rater-endorsement-editor__suggest-item"
                      onClick={() => applySuggestion(s)}
                      data-testid={`${testId}-suggest-${s.form_number.replace(/\s+/g, "-")}`}
                    >
                      <span className="rater-endorsement-editor__suggest-form">
                        {s.form_number}
                      </span>
                      <span className="rater-endorsement-editor__suggest-name">
                        {s.display_name}
                      </span>
                      {s.effect_kind ? (
                        <span
                          className="rater-endorsement-editor__suggest-kind"
                          data-kind={s.effect_kind}
                        >
                          {s.effect_kind}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <p className="rater-endorsement-editor__field-hint">
            Free text in v1 — pick from <strong>Suggested</strong> for
            common ISO BOP forms or type any custom form number. Class
            Translator vocab integration lands in v2.
          </p>
        </div>

        {/* Display name */}
        <div className="rater-endorsement-editor__field">
          <label
            htmlFor={`${uid}-name`}
            className="rater-endorsement-editor__field-label"
          >
            Display name
          </label>
          <input
            id={`${uid}-name`}
            className="rater-endorsement-editor__input"
            value={draft.display_name}
            placeholder="e.g., Peak-limit endorsement"
            onChange={(e) => updateDraft({ display_name: e.target.value })}
            data-testid={`${testId}-display-name`}
          />
        </div>

        {/* Trigger picker */}
        <div
          className={`rater-endorsement-editor__trigger${hasMismatches ? " is-unresolved" : ""}`}
          data-testid={`${testId}-trigger-block`}
        >
          <div className="rater-endorsement-editor__trigger-head">
            <span className="rater-endorsement-editor__trigger-label">
              Auto-attach trigger{hasMismatches ? " · unresolved" : ""}
            </span>
            {triggerActive ? (
              <button
                type="button"
                className="rater-endorsement-editor__trigger-clear"
                onClick={clearTrigger}
                data-testid={`${testId}-trigger-clear`}
              >
                Clear (always attach)
              </button>
            ) : null}
          </div>
          {triggerActive ? (
            <TriggerRowEditor
              row={draft.trigger}
              availableFields={availableFields}
              unmapped={
                draft.trigger.variable.length > 0 &&
                unmappedReferences.includes(draft.trigger.variable)
              }
              onChange={updateTrigger}
              testId={`${testId}-trigger`}
            />
          ) : (
            <button
              type="button"
              className="rater-endorsement-editor__trigger-add"
              onClick={() =>
                updateTrigger({
                  variable:
                    availableFields[0]?.id ?? "",
                  op: "eq",
                  value: "",
                })
              }
              data-testid={`${testId}-trigger-add`}
            >
              <Plus size={12} strokeWidth={2} aria-hidden /> Add trigger
              condition
              <span className="rater-endorsement-editor__trigger-hint">
                Leave empty to always attach
              </span>
            </button>
          )}
          {triggerActive && !hasMismatches ? (
            <p className="rater-endorsement-editor__field-hint">
              Reads <code>{draft.trigger.variable}</code> from inputs at
              rate-time. Endorsement attaches when the condition matches.
            </p>
          ) : null}
        </div>

        {/* Effect kind picker */}
        <div className="rater-endorsement-editor__field">
          <label className="rater-endorsement-editor__field-label">
            Effect kind
          </label>
          <div
            className="rater-endorsement-editor__effect-picker"
            role="radiogroup"
            aria-label="Effect kind"
          >
            <EffectBtn
              kind="factor"
              glyph="×"
              label="Factor"
              hint="Multiply premium"
              selected={draft.effect_kind === "factor"}
              onClick={() => updateDraft({ effect_kind: "factor" })}
              testId={`${testId}-effect-factor`}
            />
            <EffectBtn
              kind="additive"
              glyph="+"
              label="Additive"
              hint="Flat $ amount"
              selected={draft.effect_kind === "additive"}
              onClick={() => updateDraft({ effect_kind: "additive" })}
              testId={`${testId}-effect-additive`}
            />
            <EffectBtn
              kind="sublimit"
              glyph="⌐"
              label="Sublimit"
              hint="Cap coverage"
              selected={draft.effect_kind === "sublimit"}
              onClick={() => updateDraft({ effect_kind: "sublimit" })}
              testId={`${testId}-effect-sublimit`}
            />
            {/* Phase G G4.B (Brief 40) — rate_branch effect.
              * Runs an embedded mini chain that adds to premium. */}
            <EffectBtn
              kind="rate_branch"
              glyph="∑"
              label="Rate branch"
              hint="Embedded chain"
              selected={draft.effect_kind === "rate_branch"}
              onClick={() => updateDraft({ effect_kind: "rate_branch" })}
              testId={`${testId}-effect-rate-branch`}
            />
          </div>
        </div>

        {/* Effect-specific fields */}
        {draft.effect_kind === "factor" ? (
          <FactorFields
            uid={uid}
            testId={testId}
            draft={draft}
            updateDraft={updateDraft}
          />
        ) : null}

        {draft.effect_kind === "additive" ? (
          <AdditiveFields
            uid={uid}
            testId={testId}
            draft={draft}
            updateDraft={updateDraft}
          />
        ) : null}

        {draft.effect_kind === "sublimit" ? (
          <SublimitFields
            uid={uid}
            testId={testId}
            draft={draft}
            updateDraft={updateDraft}
          />
        ) : null}

        {draft.effect_kind === "rate_branch" ? (
          <RateBranchFields
            uid={uid}
            testId={testId}
            draft={draft}
            updateDraft={updateDraft}
          />
        ) : null}

        {/* Citation */}
        <div className="rater-endorsement-editor__field">
          <label
            htmlFor={`${uid}-citation`}
            className="rater-endorsement-editor__field-label"
          >
            Citation (optional)
          </label>
          <input
            id={`${uid}-citation`}
            className="rater-endorsement-editor__input is-mono"
            value={draft.citation}
            placeholder="e.g., ISO BP 04 30 — 2018 ed."
            onChange={(e) => updateDraft({ citation: e.target.value })}
            data-testid={`${testId}-citation`}
          />
        </div>

        {/* Actions */}
        <div className="rater-endorsement-editor__actions">
          {onCancel ? (
            <button
              type="button"
              className="rater-endorsement-editor__btn"
              onClick={onCancel}
              data-testid={`${testId}-cancel`}
            >
              Cancel
            </button>
          ) : null}
          {onTestAgainstSample ? (
            <button
              type="button"
              className="rater-endorsement-editor__btn"
              onClick={onTestAgainstSample}
              data-testid={`${testId}-test`}
            >
              Test trigger vs sample
            </button>
          ) : null}
          {onSave ? (
            <button
              type="button"
              className="rater-endorsement-editor__btn is-primary"
              onClick={onSave}
              disabled={!canSave}
              aria-disabled={!canSave}
              data-testid={`${testId}-save`}
              title={
                !isValid
                  ? "Fill in form number, name, and effect details first"
                  : hasMismatches
                    ? "Resolve unmapped input references first"
                    : undefined
              }
            >
              {hasMismatches ? "Save (blocked)" : "Save endorsement"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Trigger row sub-component
// ─────────────────────────────────────────────────────────────────

interface TriggerRowEditorProps {
  readonly row: EndorsementTriggerRow;
  readonly availableFields: readonly EndorsementFieldRef[];
  readonly unmapped: boolean;
  readonly onChange: (patch: Partial<EndorsementTriggerRow>) => void;
  readonly testId?: string;
}

function TriggerRowEditor(props: TriggerRowEditorProps): JSX.Element {
  const { row, availableFields, unmapped, onChange, testId } = props;
  return (
    <div
      className={`rater-endorsement-editor__trigger-grid${unmapped ? " is-unmapped" : ""}`}
      data-testid={testId}
    >
      <select
        className="rater-endorsement-editor__input is-mono"
        value={row.variable}
        onChange={(e) => onChange({ variable: e.target.value })}
        aria-label="Trigger field"
        data-testid={testId ? `${testId}-field` : undefined}
      >
        <option value="">— field —</option>
        {renderEndorsementFieldOptions(availableFields)}
        {row.variable &&
        !availableFields.some((f) => f.id === row.variable) ? (
          <option value={row.variable}>{row.variable} (unmapped)</option>
        ) : null}
      </select>
      <select
        className="rater-endorsement-editor__input is-mono is-op"
        value={row.op}
        onChange={(e) => onChange({ op: e.target.value as EndorsementOp })}
        aria-label="Trigger operator"
        data-testid={testId ? `${testId}-op` : undefined}
      >
        {ENDORSEMENT_OPS.map((op) => (
          <option key={op} value={op}>
            {ENDORSEMENT_OP_LABELS[op]}
          </option>
        ))}
      </select>
      <input
        className="rater-endorsement-editor__input is-mono"
        value={row.value}
        placeholder={row.op === "in" || row.op === "nin" ? "a, b, c" : "value"}
        onChange={(e) => onChange({ value: e.target.value })}
        aria-label="Trigger value"
        data-testid={testId ? `${testId}-value` : undefined}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Effect-specific field groups
// ─────────────────────────────────────────────────────────────────

interface EffectFieldsProps {
  readonly uid: string;
  readonly testId: string;
  readonly draft: EndorsementDraft;
  readonly updateDraft: (patch: Partial<EndorsementDraft>) => void;
}

function FactorFields(props: EffectFieldsProps): JSX.Element {
  const { uid, testId, draft, updateDraft } = props;
  return (
    <div className="rater-endorsement-editor__field">
      <label
        htmlFor={`${uid}-factor`}
        className="rater-endorsement-editor__field-label"
      >
        Factor
      </label>
      <input
        id={`${uid}-factor`}
        type="number"
        step={0.01}
        className="rater-endorsement-editor__input is-mono is-narrow"
        value={draft.factor}
        onChange={(e) =>
          updateDraft({ factor: Number.parseFloat(e.target.value) || 0 })
        }
        data-testid={`${testId}-factor-value`}
      />
      <p className="rater-endorsement-editor__field-hint">
        Multiplier applied to premium when the trigger fires.{" "}
        <code>1.15</code> = 15% surcharge, <code>0.85</code> = 15% credit.
      </p>
    </div>
  );
}

function AdditiveFields(props: EffectFieldsProps): JSX.Element {
  const { uid, testId, draft, updateDraft } = props;
  return (
    <div className="rater-endorsement-editor__field">
      <label
        htmlFor={`${uid}-amount`}
        className="rater-endorsement-editor__field-label"
      >
        Amount
      </label>
      <input
        id={`${uid}-amount`}
        type="number"
        step={1}
        className="rater-endorsement-editor__input is-mono is-narrow"
        value={draft.amount}
        onChange={(e) =>
          updateDraft({ amount: Number.parseFloat(e.target.value) || 0 })
        }
        data-testid={`${testId}-amount-value`}
      />
      <p className="rater-endorsement-editor__field-hint">
        Flat $ amount added to premium when the trigger fires. Currency
        assumed to match the chain.
      </p>
    </div>
  );
}

function SublimitFields(props: EffectFieldsProps): JSX.Element {
  const { uid, testId, draft, updateDraft } = props;
  return (
    <>
      <div className="rater-endorsement-editor__field">
        <label
          htmlFor={`${uid}-coverage`}
          className="rater-endorsement-editor__field-label"
        >
          Coverage name
        </label>
        <input
          id={`${uid}-coverage`}
          className="rater-endorsement-editor__input is-mono"
          value={draft.sublimit_coverage}
          placeholder="e.g., peak_items, computer_eq"
          onChange={(e) =>
            updateDraft({ sublimit_coverage: e.target.value })
          }
          data-testid={`${testId}-sublimit-coverage`}
        />
      </div>
      <div className="rater-endorsement-editor__field">
        <label
          htmlFor={`${uid}-sublimit`}
          className="rater-endorsement-editor__field-label"
        >
          Sublimit value
        </label>
        <input
          id={`${uid}-sublimit`}
          type="number"
          step={1}
          className="rater-endorsement-editor__input is-mono is-narrow"
          value={draft.sublimit_value}
          onChange={(e) =>
            updateDraft({
              sublimit_value: Number.parseFloat(e.target.value) || 0,
            })
          }
          data-testid={`${testId}-sublimit-value`}
        />
        <p className="rater-endorsement-editor__field-hint">
          When the endorsement attaches, this caps the named coverage at
          the sublimit value. Premium passes through unchanged.
        </p>
      </div>
    </>
  );
}

/**
 * Phase G G4.B (Brief 40) — rate_branch effect fields.
 *
 * Authors the basic ChainSpec shape (name, base_input, exposure_input,
 * exposure_unit_divisor, lcm_input_path, output_field). Factor-lookup
 * authoring inline-in-the-editor is deferred to a follow-up PR that
 * embeds the compact `<RatingChainCard>` primitive per Brief 40 §−1
 * Q7's recommended pattern. For v1, users can author the basic chain
 * shape; the API round-trips factor_lookups arrays cleanly so a
 * direct API POST can populate them today.
 */
function RateBranchFields(props: EffectFieldsProps): JSX.Element {
  const { uid, testId, draft, updateDraft } = props;
  const updateChain = (patch: Partial<BranchChainDraft>): void => {
    updateDraft({ branch_chain: { ...draft.branch_chain, ...patch } });
  };
  return (
    <>
      <div className="rater-endorsement-editor__field">
        <label
          htmlFor={`${uid}-branch-name`}
          className="rater-endorsement-editor__field-label"
        >
          Chain name
        </label>
        <input
          id={`${uid}-branch-name`}
          className="rater-endorsement-editor__input is-mono"
          value={draft.branch_chain.name}
          placeholder="e.g., liquor_premium"
          onChange={(e) => updateChain({ name: e.target.value })}
          data-testid={`${testId}-branch-name`}
        />
        <p className="rater-endorsement-editor__field-hint">
          Identifier for the branch chain — appears in the trace + the
          binder. Snake_case, lowercase.
        </p>
      </div>
      <div className="rater-endorsement-editor__field">
        <label
          htmlFor={`${uid}-branch-base`}
          className="rater-endorsement-editor__field-label"
        >
          Base input
        </label>
        <input
          id={`${uid}-branch-base`}
          className="rater-endorsement-editor__input is-mono"
          value={draft.branch_chain.base_input}
          placeholder="e.g., form_input.liquor_receipts"
          onChange={(e) => updateChain({ base_input: e.target.value })}
          data-testid={`${testId}-branch-base`}
        />
        <p className="rater-endorsement-editor__field-hint">
          Form-input path the branch starts from (e.g., the exposure
          dollars the rate applies to).
        </p>
      </div>
      <div className="rater-endorsement-editor__field">
        <label
          htmlFor={`${uid}-branch-exposure`}
          className="rater-endorsement-editor__field-label"
        >
          Exposure input
        </label>
        <input
          id={`${uid}-branch-exposure`}
          className="rater-endorsement-editor__input is-mono"
          value={draft.branch_chain.exposure_input}
          placeholder="e.g., form_input.liquor_receipts"
          onChange={(e) => updateChain({ exposure_input: e.target.value })}
          data-testid={`${testId}-branch-exposure`}
        />
        <p className="rater-endorsement-editor__field-hint">
          Form-input path used for the exposure normalization. Usually
          the same as the base input.
        </p>
      </div>
      <div className="rater-endorsement-editor__field">
        <label
          htmlFor={`${uid}-branch-divisor`}
          className="rater-endorsement-editor__field-label"
        >
          Exposure unit divisor
        </label>
        <input
          id={`${uid}-branch-divisor`}
          type="number"
          step={1}
          min={1}
          className="rater-endorsement-editor__input is-mono is-narrow"
          value={draft.branch_chain.exposure_unit_divisor}
          onChange={(e) =>
            updateChain({
              exposure_unit_divisor:
                Number.parseFloat(e.target.value) || 1,
            })
          }
          data-testid={`${testId}-branch-divisor`}
        />
        <p className="rater-endorsement-editor__field-hint">
          Divides the exposure into rating units. <code>1000</code> for
          per-$1k rates, <code>100</code> for per-$100.
        </p>
      </div>
      <div className="rater-endorsement-editor__field">
        <label
          htmlFor={`${uid}-branch-lcm`}
          className="rater-endorsement-editor__field-label"
        >
          LCM input path
        </label>
        <input
          id={`${uid}-branch-lcm`}
          className="rater-endorsement-editor__input is-mono"
          value={draft.branch_chain.lcm_input_path}
          placeholder="form_input.lcm"
          onChange={(e) => updateChain({ lcm_input_path: e.target.value })}
          data-testid={`${testId}-branch-lcm`}
        />
        <p className="rater-endorsement-editor__field-hint">
          Loss Cost Multiplier path — carrier-set, typically
          <code> form_input.lcm</code>.
        </p>
      </div>
      <div className="rater-endorsement-editor__field">
        <label
          htmlFor={`${uid}-branch-output`}
          className="rater-endorsement-editor__field-label"
        >
          Output field
        </label>
        <input
          id={`${uid}-branch-output`}
          className="rater-endorsement-editor__input is-mono"
          value={draft.branch_chain.output_field}
          placeholder="e.g., liquor_premium"
          onChange={(e) => updateChain({ output_field: e.target.value })}
          data-testid={`${testId}-branch-output`}
        />
        <p className="rater-endorsement-editor__field-hint">
          Name the branch writes to in the run's output namespace. Added
          to policy premium when the trigger fires.
        </p>
      </div>
      <BranchFactorLookupsField
        uid={uid}
        testId={testId}
        rows={draft.branch_chain.factor_lookups}
        onChange={(next) => updateChain({ factor_lookups: next })}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Phase H.5 — BranchFactorLookupsField (compact inline table)
//
// Authors a list of 1-D factor lookups inside a branch_chain. Each
// row maps to a substrate ChainSpec.factor_lookups entry of shape:
//
//   {
//     name: "territory_factor",
//     factor_kind: "liquor_territory_v1",
//     dimensions: { state: { source: "form_input", path: "form_input.state" } }
//   }
//
// Validation is per-row "all-or-nothing" (see isEndorsementDraftValid):
// half-filled rows block save. Empty rows are skipped silently when
// projecting to the substrate (gatesSync drops them on save).
// ─────────────────────────────────────────────────────────────────

const MAX_BRANCH_FACTOR_LOOKUPS = 8;

interface BranchFactorLookupsFieldProps {
  readonly uid: string;
  readonly testId: string;
  readonly rows: readonly BranchFactorLookupRow[];
  readonly onChange: (next: readonly BranchFactorLookupRow[]) => void;
}

function BranchFactorLookupsField(
  props: BranchFactorLookupsFieldProps,
): JSX.Element {
  const { uid, testId, rows, onChange } = props;

  const updateRow = (
    rowId: string,
    patch: Partial<BranchFactorLookupRow>,
  ): void => {
    onChange(rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  };
  const addRow = (): void => {
    if (rows.length >= MAX_BRANCH_FACTOR_LOOKUPS) return;
    onChange([...rows, emptyBranchFactorLookupRow(rows.length)]);
  };
  const removeRow = (rowId: string): void => {
    onChange(rows.filter((r) => r.id !== rowId));
  };

  return (
    <div className="rater-endorsement-editor__field">
      <label className="rater-endorsement-editor__field-label">
        Factor lookups
      </label>
      <p className="rater-endorsement-editor__field-hint">
        1-D lookups keyed on a single dimension (e.g., a per-state
        territory factor). Each row references a factor table by its
        kind slug. Round-trips via the API today; the V18 runtime
        currently evaluates only <code>base × LCM ÷ divisor</code>{" "}
        — a v2 PR threads a factor-table catalog through{" "}
        <code>ctx</code> so these lookups multiply into the branch.
      </p>
      {rows.length === 0 ? (
        <p
          className="rater-endorsement-editor__field-hint"
          data-testid={`${testId}-branch-flu-empty`}
        >
          <em>No factor lookups — the branch evaluates base × LCM only.</em>
        </p>
      ) : (
        <div
          className="rater-endorsement-editor__branch-flu"
          role="table"
          data-testid={`${testId}-branch-flu`}
        >
          <div className="rater-endorsement-editor__branch-flu-head" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Factor table</span>
            <span role="columnheader">Dim slug</span>
            <span role="columnheader">Source path</span>
            <span role="columnheader" aria-label="actions" />
          </div>
          {rows.map((row, idx) => (
            <div
              key={row.id}
              className="rater-endorsement-editor__branch-flu-row"
              role="row"
            >
              <input
                className="rater-endorsement-editor__input is-mono"
                value={row.name}
                placeholder="territory_factor"
                onChange={(e) => updateRow(row.id, { name: e.target.value })}
                aria-label="Lookup name"
                data-testid={`${testId}-branch-flu-${idx}-name`}
              />
              <input
                className="rater-endorsement-editor__input is-mono"
                value={row.factor_kind}
                placeholder="liquor_territory_v1"
                onChange={(e) =>
                  updateRow(row.id, { factor_kind: e.target.value })
                }
                aria-label="Factor-table kind slug"
                data-testid={`${testId}-branch-flu-${idx}-kind`}
              />
              <input
                className="rater-endorsement-editor__input is-mono"
                value={row.dim_slug}
                placeholder="state"
                onChange={(e) =>
                  updateRow(row.id, { dim_slug: e.target.value })
                }
                aria-label="Dimension slug"
                data-testid={`${testId}-branch-flu-${idx}-dim`}
              />
              <input
                className="rater-endorsement-editor__input is-mono"
                value={row.source_path}
                placeholder="form_input.state"
                onChange={(e) =>
                  updateRow(row.id, { source_path: e.target.value })
                }
                aria-label="Source path"
                data-testid={`${testId}-branch-flu-${idx}-source`}
              />
              <button
                type="button"
                className="rater-endorsement-editor__btn is-icon"
                onClick={() => removeRow(row.id)}
                aria-label={`Remove lookup ${row.name || idx + 1}`}
                data-testid={`${testId}-branch-flu-${idx}-remove`}
              >
                <Trash2 size={12} strokeWidth={1.8} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      {rows.length < MAX_BRANCH_FACTOR_LOOKUPS ? (
        <button
          type="button"
          className="rater-endorsement-editor__add-row"
          onClick={addRow}
          data-testid={`${testId}-branch-flu-add`}
        >
          <Plus size={12} strokeWidth={2} aria-hidden /> Add factor lookup
          <span className="rater-endorsement-editor__add-hint">
            ({MAX_BRANCH_FACTOR_LOOKUPS - rows.length} more allowed)
          </span>
        </button>
      ) : null}
      <p
        className="rater-endorsement-editor__field-hint"
        id={`${uid}-branch-flu-help`}
      >
        Tip — complex multi-dim or curve-based factors author via the
        top-level <strong>Rating chain</strong> card; inline authoring
        here covers the common 1-D case (Brief 40 §−1 Q7).
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Effect button
// ─────────────────────────────────────────────────────────────────

interface EffectBtnProps {
  readonly kind: EndorsementEffectKind;
  readonly glyph: string;
  readonly label: string;
  readonly hint: string;
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly testId?: string;
}

function EffectBtn(props: EffectBtnProps): JSX.Element {
  const { kind, glyph, label, hint, selected, onClick, testId } = props;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`rater-endorsement-editor__effect-btn${selected ? " is-selected" : ""}`}
      data-kind={kind}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="rater-endorsement-editor__effect-glyph" aria-hidden>
        {glyph}
      </span>
      <span className="rater-endorsement-editor__effect-label">{label}</span>
      <span className="rater-endorsement-editor__effect-hint">{hint}</span>
    </button>
  );
}

/**
 * Phase G G2 — option renderer for the trigger-field picker.
 *
 * Mirrors `renderFilterFieldOptions` in FilterRuleEditor. When ANY
 * ref carries a `category`, emits grouped `<optgroup>` blocks
 * ("Inputs" / "Dimensions"); otherwise emits a flat list.
 *
 * Within "Dimensions", each option reads `"slug · display_name"` so
 * the slug is selectable but the human name is visible.
 */
function renderEndorsementFieldOptions(
  fields: readonly EndorsementFieldRef[],
): JSX.Element[] {
  const hasCategory = fields.some((f) => f.category !== undefined);
  if (!hasCategory) {
    return fields.map((f) => (
      <option key={f.id} value={f.id}>
        {f.id}
        {f.type ? ` · ${f.type}` : ""}
      </option>
    ));
  }
  const inputs = fields.filter((f) => f.category === "input");
  const dims = fields.filter((f) => f.category === "dimension");
  const uncategorized = fields.filter((f) => f.category === undefined);
  const out: JSX.Element[] = [];
  if (inputs.length > 0) {
    out.push(
      <optgroup key="__inputs" label="Inputs">
        {inputs.map((f) => (
          <option key={f.id} value={f.id}>
            {f.id}
            {f.type ? ` · ${f.type}` : ""}
          </option>
        ))}
      </optgroup>,
    );
  }
  if (dims.length > 0) {
    out.push(
      <optgroup key="__dims" label="Dimensions">
        {dims.map((f) => (
          <option key={f.id} value={f.id}>
            {f.id}
            {f.label ? ` · ${f.label}` : ""}
          </option>
        ))}
      </optgroup>,
    );
  }
  for (const f of uncategorized) {
    out.push(
      <option key={f.id} value={f.id}>
        {f.id}
        {f.type ? ` · ${f.type}` : ""}
      </option>,
    );
  }
  return out;
}
