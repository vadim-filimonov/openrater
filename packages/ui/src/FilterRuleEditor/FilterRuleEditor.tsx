/**
 * <FilterRuleEditor> — Brief 39 PR 39.2.
 *
 * Authoring surface for one filter rule (eligibility / appetite gate).
 * The rule is `accept` / `refer` / `decline` and fires when its
 * condition matches; the active tower in Assemble short-circuits on
 * the first matching decline.
 *
 * Mode toggle (Brief 39 §−1 Q1 lock):
 *   · `quick` (default) — up to 3 conditions joined by AND, with a
 *     field-picker / op-picker / value-input row per condition. 90%
 *     of real-world filter rules fit this shape.
 *   · `advanced` — visualizes the rule's condition shape as a tree
 *     for future evolution. v1 ships read-only since the
 *     eligibility.gate substrate (Brief 22) walks a flat ordered
 *     rule list; OR groups are authored as multiple rules with the
 *     same disposition. v2 lands a full nested tree builder
 *     (matches the mockup Frame 3 visual).
 *
 * Inputs integration (Brief 39 §6):
 *   · `availableFields` — list of mapped input fields from
 *     Plan.input_mapping.column_map (PR 39.6 wires this from the
 *     consumer). Each condition's "field" dropdown reads from here.
 *   · `unmappedReferences` — leaf variables that aren't in
 *     availableFields. Surfaced as a hard-mismatch banner; save is
 *     disabled when non-empty (Brief 39 Q3 STRICT lock).
 *
 * Tier picker (Brief 55 — replaces the 3-way accept/refer/decline):
 *   · `preferred` — green   best risks
 *   · `standard`  — blue    bread-and-butter book (default)
 *   · `submit`    — amber   manual UW review
 *   · `decline`   — red     out of appetite
 * Each pill renders a <TierVerdictChip>, so the picker, the rule list,
 * the scored row, and the analytics legend share one color language.
 *
 * The component is controlled — parent owns the FilterRuleDraft +
 * fires `onChange` on every mutation. Save/cancel handlers fire
 * after parent-side validation (`isFilterRuleDraftValid`).
 *
 * Pure presentation. No I/O, no async. The condition + tier substrate
 * is `EligibilityRule` from @openrater/contracts (the eligibility.gate
 * shape); the tier vocabulary is the closed `EligibilityTier` union.
 */

import { useId, type JSX } from "react";
import { Building2, Filter, Info, MapPin, Plus, Trash2 } from "lucide-react";
import {
  type EligibilityTier,
  ELIGIBILITY_TIERS,
  ELIGIBILITY_TIER_DESCRIPTIONS,
} from "@openrater/contracts";
import { TierVerdictChip } from "../TierVerdictChip";
import "./FilterRuleEditor.css";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * The 8 operators from `EligibilityOp` in @openrater/contracts. Duplicated
 * here as a string union to keep this primitive independent of
 * @openrater/contracts' BlockKind types (@openrater/ui doesn't depend on
 * contracts at the type level today; we keep the boundary clean).
 */
export type FilterOp =
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "in"
  | "nin";

export const FILTER_OPS: readonly FilterOp[] = Object.freeze([
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "in",
  "nin",
] as const);

/** Display labels for each operator. */
export const FILTER_OP_LABELS: Readonly<Record<FilterOp, string>> = {
  eq: "=",
  ne: "≠",
  lt: "<",
  le: "≤",
  gt: ">",
  ge: "≥",
  in: "∈",
  nin: "∉",
};

export interface FilterConditionRow {
  /** Stable id for keyed rendering. */
  readonly id: string;
  /** Input-field name (read from ctx.externalInputs at execute). */
  readonly variable: string;
  /** Comparator. */
  readonly op: FilterOp;
  /** RHS value. For `in` / `nin` this is a comma-separated string at
   *  the draft level; persistence converts to array. */
  readonly value: string;
}

export interface FilterRuleDraft {
  /** Stable identifier; surfaces in the eligibility trace. */
  readonly rule_id: string;
  /** Human-readable name (e.g., "Class c102 limit cap"). */
  readonly display_name: string;
  /** Quick vs Advanced authoring mode. */
  readonly mode: "quick" | "advanced";
  /** Conditions joined by AND in v1. OR via separate rules. */
  readonly conditions: readonly FilterConditionRow[];
  /** The eligibility tier this rule assigns when it matches. */
  readonly tier: EligibilityTier;
  /** Reasoning surfaced in trace + decline message. */
  readonly reasoning: string;
  /** Optional rule citation. */
  readonly citation: string;
  /**
   * E03 / brief D4 — the pipeline phase this gate evaluates in:
   *   · `"row"` (default) — per-location, against the location's inputs.
   *   · `"policy"` — after the multi-location roll-up (E08), against the
   *     policy TOTALS: the declared roll-up fields by their RAW names (e.g.
   *     `tiv`, `premium`) + `location_count` (ADR-0046).
   * Maps 1:1 to the `eligibility.gate` kind's `scope` param (ADR-016).
   */
  readonly scope?: "row" | "policy";
}

export interface FilterFieldRef {
  readonly id: string;
  /** Optional dtype hint shown beside the field name. */
  readonly type?: string;
  /**
   * Phase G G2 — picker grouping. When ANY ref has a category, the
   * editor's `<select>` groups options under `<optgroup>` headings:
   * "Inputs" for mapped CSV/webhook columns + "Dimensions" for the
   * plan's catalog dims. Backward-compat: when no ref carries a
   * category, the picker renders a flat list (pre-G2 behavior).
   */
  readonly category?: "input" | "dimension";
  /**
   * Phase G G2 — dimension display label. Surfaced on the option
   * line when present (e.g., "ntee_major · NTEE major"). Reads
   * naturally + lets the user pick a dim by its display_name even
   * when the slug is opaque. Ignored when `category !== "dimension"`.
   */
  readonly label?: string;
}

export interface FilterRuleEditorProps {
  readonly draft: FilterRuleDraft;
  /** Fields available from the Inputs mapping. */
  readonly availableFields: readonly FilterFieldRef[];
  /**
   * Variables referenced in the draft that aren't in `availableFields`.
   * Passed in by the parent (Brief 39 PR 39.6 computes this from
   * `Plan.input_mapping.column_map`). When non-empty, save is blocked.
   */
  readonly unmappedReferences?: readonly string[];
  /**
   * E03 / brief D4 — the aggregate fields a POLICY-scope gate may read: the
   * declared roll-up fields by their RAW names (e.g. `tiv`, `premium`) +
   * `location_count` (ADR-0046; the route derives these from
   * `policyAggregateFields`). When `scope` is `"policy"`, the condition
   * field-picker uses these instead of `availableFields`. Omit ⇒ policy scope
   * falls back to `availableFields`.
   */
  readonly policyFields?: readonly FilterFieldRef[];
  /**
   * E03 / brief D5 — field names that roll up to the policy (premium, tiv…).
   * When a ROW-scope rule reads one of these, the editor surfaces a nudge:
   * "this reads a field that rolls up — did you mean a policy gate?".
   */
  readonly rollupFieldNames?: readonly string[];
  readonly onChange: (next: FilterRuleDraft) => void;
  readonly onSave?: () => void;
  readonly onCancel?: () => void;
  /** Fires the "Test against sample" affordance. Optional. */
  readonly onTestAgainstSample?: () => void;
  readonly testId?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers (exported pure functions)
// ─────────────────────────────────────────────────────────────────

/** Generate a fresh empty filter draft. */
export function emptyFilterRuleDraft(): FilterRuleDraft {
  return {
    rule_id: "",
    display_name: "",
    mode: "quick",
    conditions: [
      {
        id: "c0",
        variable: "",
        op: "eq",
        value: "",
      },
    ],
    tier: "submit",
    reasoning: "",
    citation: "",
    scope: "row",
  };
}

/** True iff a single condition row has every field set. */
export function isConditionRowValid(row: FilterConditionRow): boolean {
  return row.variable.length > 0 && row.value.length > 0;
}

/**
 * True iff the draft is ready to save: has a name + at least one
 * complete condition + disposition set + (when refer) a route.
 */
export function isFilterRuleDraftValid(draft: FilterRuleDraft): boolean {
  if (draft.display_name.trim().length === 0) return false;
  if (draft.conditions.length === 0) return false;
  for (const c of draft.conditions) {
    if (!isConditionRowValid(c)) return false;
  }
  return true;
}

/**
 * The first concrete reason Save is disabled, in actuary-language, or
 * `null` when the draft is ready. Mirrors `isFilterRuleDraftValid` +
 * the unmapped-reference STRICT lock so the editor can SURFACE why Save
 * is blocked rather than silently disabling the button (the E04 gap:
 * a complete-looking rule whose only missing piece is the required
 * Display name, with no marker and no explanation).
 *
 * Ordering matters — it returns the blocker the actuary should fix
 * first (name → conditions → unmapped refs), so the hint is stable as
 * they fill the form top-to-bottom.
 */
export function saveDisabledReason(
  draft: FilterRuleDraft,
  hasUnmappedReferences: boolean,
): string | null {
  if (draft.display_name.trim().length === 0) {
    return "Name this filter to save.";
  }
  if (
    draft.conditions.length === 0 ||
    !draft.conditions.every(isConditionRowValid)
  ) {
    return "Complete every condition (field + value) to save.";
  }
  if (hasUnmappedReferences) {
    return "Resolve unmapped input references to save.";
  }
  return null;
}

/** Returns the set of input field names this draft references. */
export function getReferencedFields(
  draft: FilterRuleDraft,
): readonly string[] {
  const seen = new Set<string>();
  for (const c of draft.conditions) {
    if (c.variable) seen.add(c.variable);
  }
  return [...seen];
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

// Brief 69 §3.1 / ADR-0050 doctrine — the substrate's EligibilityRule
// is a SINGLE comparison and the engine is first-match-wins, so an
// AND-join cannot persist (and N same-tier rules would mean OR, not
// AND). The editor caps at ONE condition until the contract carries
// compound predicates; the old 3-condition quick-form silently saved
// as its first condition only — a decline rule semantically BROADENED.
const QUICK_CONDITION_CAP = 1;

export function FilterRuleEditor(
  props: FilterRuleEditorProps,
): JSX.Element {
  const {
    draft,
    availableFields,
    unmappedReferences = [],
    policyFields,
    rollupFieldNames = [],
    onChange,
    onSave,
    onCancel,
    onTestAgainstSample,
    testId = "rater-filter-rule-editor",
  } = props;

  const uid = useId();
  const isValid = isFilterRuleDraftValid(draft);
  const hasMismatches = unmappedReferences.length > 0;
  const disabledReason = saveDisabledReason(draft, hasMismatches);
  const canSave = disabledReason === null;

  // E03 / brief D4 — scope drives the field-picker source + the chip.
  const scope = draft.scope ?? "row";
  const fieldsForPicker =
    scope === "policy" ? (policyFields ?? availableFields) : availableFields;
  // E03 / brief D5 — a row-scope rule reading a field that rolls up to the
  // policy is almost always a mis-scoped policy gate. Surface a nudge.
  const rollupRefs =
    scope === "row"
      ? getReferencedFields(draft).filter((v) => rollupFieldNames.includes(v))
      : [];
  // F17 — policy scope with no authored roll-up fields: the picker can only
  // offer `location_count`, so the rolled aggregate the rule wants (e.g. the
  // policy TIV) isn't selectable. Surface the cross-surface prerequisite
  // instead of leaving the author at a dead single-option dropdown. Keyed on
  // the picker's actual contents (not just `rollupFieldNames`) so the hint
  // never shows when real rolled fields are available.
  const policyNeedsRollup =
    scope === "policy" &&
    !fieldsForPicker.some((f) => f.id !== "location_count");
  // F18 — a row-scope rule comparing a field that is conventionally a policy
  // aggregate (a TIV, or a per-location `*_limit` that sums to the policy
  // TIV) is almost always a mis-scoped appetite rule: each location can sit
  // under the threshold while the policy total clears it (P-001's $800k +
  // $210k sites are each < $1M, yet the $1.06M policy qualifies). The D5
  // nudge above only fires for fields ALREADY declared as roll-ups; this
  // convention lint also catches the not-yet-configured case. Advisory only
  // (single-location guardrails like "decline any site over $5M" are valid),
  // and suppressed when the D5 nudge already covers the rule.
  const conventionRefs =
    scope === "row" && rollupRefs.length === 0
      ? getReferencedFields(draft).filter(
          (v) =>
            !rollupFieldNames.includes(v) &&
            (/(?:^|_)tiv$/.test(v) ||
              /(?:^|_)limit$/.test(v) ||
              v === "total_insured_value"),
        )
      : [];

  const updateDraft = (patch: Partial<FilterRuleDraft>) => {
    onChange({ ...draft, ...patch });
  };

  const updateConditionRow = (
    rowId: string,
    patch: Partial<FilterConditionRow>,
  ) => {
    onChange({
      ...draft,
      conditions: draft.conditions.map((c) =>
        c.id === rowId ? { ...c, ...patch } : c,
      ),
    });
  };

  const addConditionRow = () => {
    if (draft.conditions.length >= QUICK_CONDITION_CAP) return;
    const nextId = `c${draft.conditions.length}`;
    onChange({
      ...draft,
      conditions: [
        ...draft.conditions,
        { id: nextId, variable: "", op: "eq", value: "" },
      ],
    });
  };

  const removeConditionRow = (rowId: string) => {
    if (draft.conditions.length === 1) return; // keep at least one row
    onChange({
      ...draft,
      conditions: draft.conditions.filter((c) => c.id !== rowId),
    });
  };

  return (
    <section className="rater-filter-rule-editor" data-testid={testId}>
      {/* Hard-mismatch banner — top of editor when references unmapped. */}
      {hasMismatches ? (
        <div
          className="rater-filter-rule-editor__mismatch"
          role="alert"
          data-testid={`${testId}-mismatch`}
        >
          <div className="rater-filter-rule-editor__mismatch-glyph">!</div>
          <div>
            <h4 className="rater-filter-rule-editor__mismatch-title">
              Filter references unmapped input
              {unmappedReferences.length > 1 ? "s" : ""}
            </h4>
            <p className="rater-filter-rule-editor__mismatch-detail">
              {unmappedReferences.length === 1
                ? "The condition reads "
                : "The conditions read "}
              {unmappedReferences.map((f, i) => (
                <span key={f}>
                  {i > 0 && i === unmappedReferences.length - 1 ? " and " : i > 0 ? ", " : ""}
                  <code>{f}</code>
                </span>
              ))}
              {", but no column in the current Inputs mapping projects to "}
              {unmappedReferences.length === 1 ? "that field" : "those fields"}
              {". Map "}
              {unmappedReferences.length === 1 ? "it" : "them"}
              {" in the Inputs tab, or change the condition to use available fields."}
            </p>
          </div>
        </div>
      ) : null}

      <header className="rater-filter-rule-editor__head">
        <div className="rater-filter-rule-editor__head-icon" aria-hidden>
          <Filter size={14} strokeWidth={2} />
        </div>
        <div className="rater-filter-rule-editor__head-text">
          <h3 className="rater-filter-rule-editor__head-title">
            {draft.display_name || "Untitled filter"}
          </h3>
          <span className="rater-filter-rule-editor__head-sub">
            filter · {scope} · {isValid ? "ready" : "draft"}
          </span>
        </div>
      </header>

      <div className="rater-filter-rule-editor__body">
        {/* Scope toggle (E03 / brief D4) — row vs policy-level. */}
        <div
          className="rater-filter-rule-editor__scope-toggle"
          role="tablist"
          aria-label="Gate scope"
        >
          <button
            type="button"
            role="tab"
            aria-selected={scope === "row"}
            className={`rater-filter-rule-editor__scope-btn${
              scope === "row" ? " is-active" : ""
            }`}
            onClick={() => updateDraft({ scope: "row" })}
            data-testid={`${testId}-scope-row`}
          >
            <MapPin size={12} strokeWidth={2} aria-hidden /> Per location
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === "policy"}
            className={`rater-filter-rule-editor__scope-btn${
              scope === "policy" ? " is-active" : ""
            }`}
            onClick={() => updateDraft({ scope: "policy" })}
            data-testid={`${testId}-scope-policy`}
          >
            <Building2 size={12} strokeWidth={2} aria-hidden /> Policy-level
          </button>
        </div>

        {scope === "policy" ? (
          <p
            className="rater-filter-rule-editor__scope-chip"
            role="note"
            data-testid={`${testId}-policy-chip`}
          >
            <Building2 size={12} strokeWidth={2} aria-hidden /> Runs after
            locations roll up — reads policy totals.
          </p>
        ) : null}

        {/* D5 nudge — a row-scope rule reading a rolled-up field. */}
        {rollupRefs.length > 0 ? (
          <div
            className="rater-filter-rule-editor__nudge"
            role="note"
            data-testid={`${testId}-policy-nudge`}
          >
            <Info size={13} strokeWidth={2} aria-hidden />
            <span>
              This reads{" "}
              {rollupRefs.map((f, i) => (
                <span key={f}>
                  {i > 0 ? ", " : ""}
                  <code>{f}</code>
                </span>
              ))}
              , which rolls up to the policy. Did you mean a policy gate?
            </span>
            <button
              type="button"
              className="rater-filter-rule-editor__nudge-action"
              onClick={() => updateDraft({ scope: "policy" })}
              data-testid={`${testId}-make-policy`}
            >
              Make policy-scope
            </button>
          </div>
        ) : null}

        {/* F18 nudge — a row-scope rule on a field that's an aggregate by
            convention (`*_limit` / `*tiv`), before any roll-up is declared
            (so the D5 nudge above can't see it yet). */}
        {conventionRefs.length > 0 ? (
          <div
            className="rater-filter-rule-editor__nudge"
            role="note"
            data-testid={`${testId}-aggregate-nudge`}
          >
            <Info size={13} strokeWidth={2} aria-hidden />
            <span>
              This compares{" "}
              {conventionRefs.map((f, i) => (
                <span key={f}>
                  {i > 0 ? ", " : ""}
                  <code>{f}</code>
                </span>
              ))}
              , which sums across a policy's locations — a per-location rule
              can mis-decline a multi-location policy (each site under the
              limit, the policy total over it). Did you mean a policy gate?
            </span>
            <button
              type="button"
              className="rater-filter-rule-editor__nudge-action"
              onClick={() => updateDraft({ scope: "policy" })}
              data-testid={`${testId}-aggregate-make-policy`}
            >
              Make policy-scope
            </button>
          </div>
        ) : null}

        {/* Mode toggle */}
        <div
          className="rater-filter-rule-editor__mode-toggle"
          role="tablist"
          aria-label="Authoring mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={draft.mode === "quick"}
            className={`rater-filter-rule-editor__mode-btn${
              draft.mode === "quick" ? " is-active" : ""
            }`}
            onClick={() => updateDraft({ mode: "quick" })}
            data-testid={`${testId}-mode-quick`}
          >
            Quick
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={draft.mode === "advanced"}
            className={`rater-filter-rule-editor__mode-btn${
              draft.mode === "advanced" ? " is-active" : ""
            }`}
            onClick={() => updateDraft({ mode: "advanced" })}
            data-testid={`${testId}-mode-advanced`}
          >
            Advanced
          </button>
        </div>

        {/* Display name */}
        <div className="rater-filter-rule-editor__field">
          <label
            htmlFor={`${uid}-name`}
            className="rater-filter-rule-editor__field-label"
          >
            Display name
            <span
              className="rater-filter-rule-editor__req"
              aria-hidden="true"
              title="Required"
            >
              *
            </span>
          </label>
          <input
            id={`${uid}-name`}
            className="rater-filter-rule-editor__field-input"
            value={draft.display_name}
            placeholder="e.g., Class c102 limit cap"
            aria-required="true"
            onChange={(e) => updateDraft({ display_name: e.target.value })}
            data-testid={`${testId}-name`}
          />
        </div>

        {/* Conditions — quick mode */}
        {draft.mode === "quick" ? (
          <div className="rater-filter-rule-editor__field">
            <label className="rater-filter-rule-editor__field-label">
              Conditions
              <span className="rater-filter-rule-editor__field-hint">
                {" "}
                · joined by AND
              </span>
            </label>
            {policyNeedsRollup ? (
              <div
                className="rater-filter-rule-editor__nudge"
                role="note"
                data-testid={`${testId}-policy-rollup-hint`}
              >
                <Info size={13} strokeWidth={2} aria-hidden />
                <span>
                  Policy-level rules compare <strong>rolled-up</strong> fields.
                  This plan has none yet, so only <code>location_count</code> is
                  available. Add roll-up fields (e.g. Σ TIV) on the{" "}
                  <strong>Inputs</strong> tab → “Group rows into policies.”
                </span>
              </div>
            ) : null}
            {draft.conditions.map((row, idx) => (
              <ConditionRowEditor
                key={row.id}
                row={row}
                showAndPrefix={idx > 0}
                showRemove={draft.conditions.length > 1}
                availableFields={fieldsForPicker}
                unmappedReferences={unmappedReferences}
                onChange={(patch) => updateConditionRow(row.id, patch)}
                onRemove={() => removeConditionRow(row.id)}
                testId={`${testId}-condition-${idx}`}
              />
            ))}
            {draft.conditions.length < QUICK_CONDITION_CAP ? (
              <button
                type="button"
                className="rater-filter-rule-editor__add-condition"
                onClick={addConditionRow}
                data-testid={`${testId}-add-condition`}
              >
                <Plus size={12} strokeWidth={2} aria-hidden />
                Add another condition
                <span className="rater-filter-rule-editor__add-hint">
                  ({QUICK_CONDITION_CAP - draft.conditions.length} more allowed)
                </span>
              </button>
            ) : (
              <p className="rater-filter-rule-editor__field-hint">
                Quick mode caps at {QUICK_CONDITION_CAP} AND-joined conditions.
                For deeper logic, switch to Advanced.
              </p>
            )}
          </div>
        ) : (
          /* Advanced mode (v1: tree visualization + JSON edit hint) */
          <div className="rater-filter-rule-editor__field">
            <label className="rater-filter-rule-editor__field-label">
              Condition tree
              <span className="rater-filter-rule-editor__field-hint">
                {" "}
                · v1 read-only visualization
              </span>
            </label>
            <AdvancedTreeView conditions={draft.conditions} />
            <p className="rater-filter-rule-editor__advanced-note">
              v1 Advanced mode visualizes quick-mode conditions as a tree.
              Nested OR groups land in Brief 39 v2 — for OR semantics today,
              author multiple filter rules with the same disposition.
            </p>
          </div>
        )}

        {/* Tier (Brief 55 — native 4-tier, replaces the 3-way disposition) */}
        <div className="rater-filter-rule-editor__field">
          <label className="rater-filter-rule-editor__field-label">
            Tier when this rule matches
          </label>
          <div
            className="rater-filter-rule-editor__tier"
            role="radiogroup"
            aria-label="Eligibility tier"
          >
            {ELIGIBILITY_TIERS.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={draft.tier === t}
                className={`rater-filter-rule-editor__tier-opt${
                  draft.tier === t ? " is-selected" : ""
                }`}
                data-tier={t}
                title={ELIGIBILITY_TIER_DESCRIPTIONS[t]}
                onClick={() => updateDraft({ tier: t })}
                data-testid={`${testId}-tier-${t}`}
              >
                <TierVerdictChip tier={t} dot={false} />
              </button>
            ))}
          </div>
        </div>

        {/* Reasoning */}
        <div className="rater-filter-rule-editor__field">
          <label
            htmlFor={`${uid}-reasoning`}
            className="rater-filter-rule-editor__field-label"
          >
            {draft.tier === "decline"
              ? "Decline message"
              : "Reasoning"}
          </label>
          <input
            id={`${uid}-reasoning`}
            className="rater-filter-rule-editor__field-input"
            value={draft.reasoning}
            placeholder={
              draft.tier === "decline"
                ? "Falls outside appetite for BOP."
                : "Surfaces in trace + audit log."
            }
            onChange={(e) => updateDraft({ reasoning: e.target.value })}
            data-testid={`${testId}-reasoning`}
          />
        </div>

        {/* Citation */}
        <div className="rater-filter-rule-editor__field">
          <label
            htmlFor={`${uid}-citation`}
            className="rater-filter-rule-editor__field-label"
          >
            Citation (optional)
          </label>
          <input
            id={`${uid}-citation`}
            className="rater-filter-rule-editor__field-input is-mono"
            value={draft.citation}
            placeholder="e.g., Meridian BOP 2024 · Rule 12.3"
            onChange={(e) => updateDraft({ citation: e.target.value })}
            data-testid={`${testId}-citation`}
          />
        </div>

        {/* Why Save is disabled — surfaced inline, not just on hover. */}
        {onSave && disabledReason ? (
          <p
            className="rater-filter-rule-editor__save-hint"
            role="note"
            data-testid={`${testId}-save-hint`}
          >
            <Info size={12} strokeWidth={2} aria-hidden />
            <span>{disabledReason}</span>
          </p>
        ) : null}

        {/* Actions */}
        <div className="rater-filter-rule-editor__actions">
          {onCancel ? (
            <button
              type="button"
              className="rater-filter-rule-editor__btn"
              onClick={onCancel}
              data-testid={`${testId}-cancel`}
            >
              Cancel
            </button>
          ) : null}
          {onTestAgainstSample ? (
            <button
              type="button"
              className="rater-filter-rule-editor__btn"
              onClick={onTestAgainstSample}
              data-testid={`${testId}-test`}
            >
              Test against sample
            </button>
          ) : null}
          {onSave ? (
            <button
              type="button"
              className="rater-filter-rule-editor__btn is-primary"
              onClick={onSave}
              disabled={!canSave}
              aria-disabled={!canSave}
              data-testid={`${testId}-save`}
              title={disabledReason ?? undefined}
            >
              Save filter
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

interface ConditionRowEditorProps {
  readonly row: FilterConditionRow;
  readonly showAndPrefix: boolean;
  readonly showRemove: boolean;
  readonly availableFields: readonly FilterFieldRef[];
  readonly unmappedReferences: readonly string[];
  readonly onChange: (patch: Partial<FilterConditionRow>) => void;
  readonly onRemove: () => void;
  readonly testId?: string;
}

function ConditionRowEditor(props: ConditionRowEditorProps): JSX.Element {
  const {
    row,
    showAndPrefix,
    showRemove,
    availableFields,
    unmappedReferences,
    onChange,
    onRemove,
    testId,
  } = props;
  const fieldUnmapped =
    row.variable.length > 0 && unmappedReferences.includes(row.variable);

  return (
    <div className="rater-filter-rule-editor__condition-row">
      {showAndPrefix ? (
        <span className="rater-filter-rule-editor__and-prefix">AND</span>
      ) : null}
      <div
        className={`rater-filter-rule-editor__condition-grid${
          fieldUnmapped ? " is-unmapped" : ""
        }`}
        data-testid={testId}
      >
        <select
          className="rater-filter-rule-editor__field-input is-mono"
          value={row.variable}
          onChange={(e) => onChange({ variable: e.target.value })}
          aria-label="Field"
          data-testid={testId ? `${testId}-field` : undefined}
        >
          <option value="">— field —</option>
          {renderFilterFieldOptions(availableFields)}
          {/* If the current variable isn't in availableFields, keep it
              selectable so the user sees it but it shows as unmapped. */}
          {row.variable &&
          !availableFields.some((f) => f.id === row.variable) ? (
            <option value={row.variable}>{row.variable} (unmapped)</option>
          ) : null}
        </select>
        <select
          className="rater-filter-rule-editor__field-input is-mono is-op"
          value={row.op}
          onChange={(e) => onChange({ op: e.target.value as FilterOp })}
          aria-label="Operator"
          data-testid={testId ? `${testId}-op` : undefined}
        >
          {FILTER_OPS.map((op) => (
            <option key={op} value={op}>
              {FILTER_OP_LABELS[op]}
            </option>
          ))}
        </select>
        <input
          className="rater-filter-rule-editor__field-input is-mono"
          value={row.value}
          placeholder={row.op === "in" || row.op === "nin" ? "a, b, c" : "value"}
          onChange={(e) => onChange({ value: e.target.value })}
          aria-label="Value"
          data-testid={testId ? `${testId}-value` : undefined}
        />
        {showRemove ? (
          <button
            type="button"
            className="rater-filter-rule-editor__remove"
            onClick={onRemove}
            aria-label="Remove condition"
            data-testid={testId ? `${testId}-remove` : undefined}
          >
            <Trash2 size={12} strokeWidth={1.8} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Phase G G2 — option renderer for the variable picker.
 *
 * Backward-compat: if NO ref carries a `category`, emits a flat list
 * (pre-G2 behavior). Otherwise groups under `<optgroup>` headings —
 * "Inputs" then "Dimensions" — so the user sees mapped CSV/webhook
 * columns separately from the plan's dimension catalog.
 *
 * Within "Dimensions", each option line reads `"slug · display_name"`
 * (when label is set) so the slug is selectable but the human name
 * is visible. The dtype suffix (` · number`, ` · string`) still
 * appears for input fields per the pre-G2 contract.
 */
/**
 * V6 — a field can surface twice (e.g. `territory` is both a declared
 * input AND a catalog dimension), which double-lists it in the picker and
 * collides the React `key`. Collapse by `id`, preferring the `input` entry
 * (that's the column the gate condition actually reads at runtime).
 */
function dedupeFieldsById(
  fields: readonly FilterFieldRef[],
): readonly FilterFieldRef[] {
  const inputIds = new Set(
    fields.filter((f) => f.category === "input").map((f) => f.id),
  );
  const seen = new Set<string>();
  const out: FilterFieldRef[] = [];
  for (const f of fields) {
    if (seen.has(f.id)) continue;
    // If an `input` entry exists for this id, keep only that one.
    if (f.category !== "input" && inputIds.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

function renderFilterFieldOptions(
  rawFields: readonly FilterFieldRef[],
): JSX.Element[] {
  const fields = dedupeFieldsById(rawFields);
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
          // I7 — lead with the human display name; fall back to the id only
          // when there's no label, so an opaque auto-id (`dim_6`/`dim_7`)
          // never leaks into the picker when a readable name exists.
          <option key={f.id} value={f.id}>
            {f.label ?? f.id}
            {f.label ? ` · ${f.id}` : ""}
          </option>
        ))}
      </optgroup>,
    );
  }
  // Any refs without a category fall through as a flat tail so the
  // picker doesn't silently drop them.
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

interface AdvancedTreeViewProps {
  readonly conditions: readonly FilterConditionRow[];
}

function AdvancedTreeView(props: AdvancedTreeViewProps): JSX.Element {
  const { conditions } = props;
  if (conditions.length === 0) {
    return (
      <div className="rater-filter-rule-editor__tree">
        <em className="rater-filter-rule-editor__tree-empty">
          No conditions authored yet.
        </em>
      </div>
    );
  }
  return (
    <div className="rater-filter-rule-editor__tree" data-testid="rater-filter-rule-editor-tree">
      <span className="rater-filter-rule-editor__tree-group-op">AND</span>
      {conditions.map((c) => (
        <div key={c.id} className="rater-filter-rule-editor__tree-row">
          <span className="rater-filter-rule-editor__tree-pill is-field">
            {c.variable || "—"}
          </span>
          <span className="rater-filter-rule-editor__tree-pill is-op">
            {FILTER_OP_LABELS[c.op]}
          </span>
          <span className="rater-filter-rule-editor__tree-pill is-value">
            {c.value || "—"}
          </span>
        </div>
      ))}
    </div>
  );
}
