/**
 * <ModifierEditor> — Brief 39 PR 39.3.
 *
 * Authoring surface for one modifier. Three modes share the editor:
 *
 *   · `schedule` (the rich one) — categories with ±N% ranges, total
 *     cap enforced at application time (Brief 15 P-M3), optional
 *     tier filter + reasoning gate per category. IRPM / schedule
 *     rating style.
 *
 *   · `flat` — single factor or additive amount, e.g. terrorism
 *     surcharge ×1.02 or hired-auto +$1,200. Optional always/conditional
 *     applies-to (the condition picker UX is a v2 follow-up; v1
 *     stores the string as-is).
 *
 *   · `provision` — single fixed multiplier (profit / expense
 *     provision, e.g. ×1.05). Optional applies-to (all / tier-1 /
 *     etc., as a select).
 *
 * One editor, three modes per Brief 39 §−1 Q2 lock. The kind picker
 * lives at the top of the body; fields hide/show based on the
 * selected kind. Substrate-side this maps onto Brief 15's
 * `modifier.schedule` for all three modes (a 1-category schedule
 * with cap_pct = factor% IS a Flat factor; a 1-category schedule
 * with reasoning_required = false IS a Provision). Brief 39 v2
 * will introduce dedicated `modifier.flat` / `modifier.provision`
 * kinds if the runtime needs them.
 *
 * Authoring-time validation only — application-time validation
 * (cap enforcement on sum-of-values, reasoning gate when a category
 * needs reasoning + value ≠ 0%) lives in a future Rate Sample
 * surface, not here. Brief 39 §11 (out of scope v1).
 *
 * Pure controlled component. Parent owns the ModifierDraft; mutations
 * fire via onChange. Save/cancel handlers fire after parent-side
 * `isModifierDraftValid()` check.
 */

import { useId, type JSX } from "react";
import { Plus, Trash2, Brain } from "lucide-react";
import { Checkbox } from "@openrater/design-system";
import { ClampVisualizer } from "../ClampVisualizer";
import "./ModifierEditor.css";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ModifierKind = "schedule" | "flat" | "provision" | "model";
export type ModifierFlatEffect = "factor" | "additive";
export type ModifierAppliesTo = "all" | "tier-1" | "tier-2" | "by-level";

/**
 * One declared input on a `model` modifier — the variable name the
 * model REQUIRES at scoring time. Missing inputs → fallback path
 * per Brief 41 §−1 Q4-Q7.
 *
 * v1 hard-codes source="input" (read from externalInputs). v2 may
 * add "trace" (an upstream node's output) when models need internal
 * signals.
 */
export interface ModifierModelInputRow {
  /** Stable id for keyed render. */
  readonly id: string;
  /** externalInputs key the runtime reads. */
  readonly variable: string;
}

export interface ModifierCategoryRow {
  /** Stable id for keyed render. */
  readonly id: string;
  /** Category display name (e.g., "Management quality"). */
  readonly name: string;
  /** Lower bound percentage (typically negative). */
  readonly range_lo_pct: number;
  /** Upper bound percentage (typically positive). */
  readonly range_hi_pct: number;
  /** When true, value ≠ 0% requires reasoning at application time
   *  (Brief 15 P-M3). */
  readonly reasoning_required: boolean;
  /** Tier filter — empty array = applies to all tiers. */
  readonly tier_filter: readonly string[];
}

export interface ModifierDraft {
  readonly modifier_id: string;
  readonly display_name: string;
  readonly kind: ModifierKind;

  // ── Schedule mode ──────────────────────────────────────────
  /** Total cap as a percentage (e.g., 25 means ±25%). */
  readonly cap_pct: number;
  readonly categories: readonly ModifierCategoryRow[];

  // ── Flat mode ──────────────────────────────────────────────
  readonly flat_effect: ModifierFlatEffect;
  /** Multiplier when flat_effect === "factor" (e.g., 1.02). */
  readonly flat_factor: number;
  /** Amount when flat_effect === "additive" (e.g., 250). */
  readonly flat_amount: number;
  /** Optional condition string; v1 placeholder for v2 picker. */
  readonly flat_condition: string;

  // ── Provision mode ─────────────────────────────────────────
  readonly provision_multiplier: number;
  readonly provision_applies_to: ModifierAppliesTo;

  // ── Model mode (Phase H.6 — Brief 41 + ModifierModelKind) ──
  /** Stable identifier for the model — surfaces in audit + trace. */
  readonly model_id: string;
  /** Version pin (e.g., "2026.05"). */
  readonly model_version: string;
  /** Inputs the model REQUIRES at score time. */
  readonly model_inputs: readonly ModifierModelInputRow[];
  /** Lower bound of the filed clamp envelope. */
  readonly clamp_min: number;
  /** Upper bound of the filed clamp envelope. */
  readonly clamp_max: number;
  /** Carrier-side justification for the envelope (audit trail). */
  readonly rationale: string;
  /** Factor applied when ANY declared_input is missing at score time. */
  readonly fallback_factor: number;

  readonly citation: string;
}

export interface ModifierEditorProps {
  readonly draft: ModifierDraft;
  readonly onChange: (next: ModifierDraft) => void;
  readonly onSave?: () => void;
  readonly onCancel?: () => void;
  /** Opens an application-form preview (deferred surface). Optional. */
  readonly onPreviewApplication?: () => void;
  readonly testId?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers (exported pure functions)
// ─────────────────────────────────────────────────────────────────

export function emptyCategoryRow(idx: number): ModifierCategoryRow {
  return {
    id: `cat-${idx}`,
    name: "",
    range_lo_pct: -10,
    range_hi_pct: 10,
    reasoning_required: false,
    tier_filter: [],
  };
}

export function emptyModelInputRow(idx: number): ModifierModelInputRow {
  return { id: `mi-${idx}`, variable: "" };
}

export function emptyModifierDraft(): ModifierDraft {
  return {
    modifier_id: "",
    display_name: "",
    kind: "schedule",
    cap_pct: 25,
    categories: [emptyCategoryRow(0)],
    flat_effect: "factor",
    flat_factor: 1.0,
    flat_amount: 0,
    flat_condition: "",
    provision_multiplier: 1.0,
    provision_applies_to: "all",
    // Model mode defaults — conservative ±15% envelope, fallback at
    // 1.0 (neutral) until the user fills in their filed values.
    model_id: "",
    model_version: "",
    model_inputs: [emptyModelInputRow(0)],
    clamp_min: 0.85,
    clamp_max: 1.25,
    rationale: "",
    fallback_factor: 1.0,
    citation: "",
  };
}

/**
 * True iff the draft is ready to save. Validation is kind-aware:
 *   schedule — name + cap > 0 + ≥1 named category with valid range
 *   flat     — name + valid factor (>0) OR valid amount (≠0)
 *   provision — name + valid multiplier (>0)
 *   model    — name + model_id + ≥1 named declared_input + valid
 *              clamp envelope (min ≤ max) + finite fallback_factor
 */
export function isModifierDraftValid(draft: ModifierDraft): boolean {
  if (draft.display_name.trim().length === 0) return false;
  if (draft.kind === "schedule") {
    if (!Number.isFinite(draft.cap_pct) || draft.cap_pct <= 0) return false;
    if (draft.categories.length === 0) return false;
    for (const c of draft.categories) {
      if (c.name.trim().length === 0) return false;
      if (!Number.isFinite(c.range_lo_pct)) return false;
      if (!Number.isFinite(c.range_hi_pct)) return false;
      if (c.range_lo_pct > c.range_hi_pct) return false;
    }
    return true;
  }
  if (draft.kind === "flat") {
    if (draft.flat_effect === "factor") {
      return Number.isFinite(draft.flat_factor) && draft.flat_factor > 0;
    }
    return Number.isFinite(draft.flat_amount) && draft.flat_amount !== 0;
  }
  if (draft.kind === "model") {
    if (draft.model_id.trim().length === 0) return false;
    if (draft.model_inputs.length === 0) return false;
    for (const row of draft.model_inputs) {
      if (row.variable.trim().length === 0) return false;
    }
    if (!Number.isFinite(draft.clamp_min)) return false;
    if (!Number.isFinite(draft.clamp_max)) return false;
    if (draft.clamp_min > draft.clamp_max) return false;
    if (
      !Number.isFinite(draft.fallback_factor) ||
      draft.fallback_factor <= 0
    ) {
      return false;
    }
    return true;
  }
  // provision
  return (
    Number.isFinite(draft.provision_multiplier) &&
    draft.provision_multiplier > 0
  );
}

/**
 * Returns the sum-of-upper-bounds and sum-of-lower-bounds across
 * Schedule categories. Used in the inspector to show "cap clamps
 * to ±N%" when the sum exceeds the configured cap.
 *
 * Returns null for non-schedule modes.
 */
export function computeCategoryRangeSums(
  draft: ModifierDraft,
): { readonly sum_lo: number; readonly sum_hi: number } | null {
  if (draft.kind !== "schedule") return null;
  let lo = 0;
  let hi = 0;
  for (const c of draft.categories) {
    if (Number.isFinite(c.range_lo_pct)) lo += c.range_lo_pct;
    if (Number.isFinite(c.range_hi_pct)) hi += c.range_hi_pct;
  }
  return { sum_lo: lo, sum_hi: hi };
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

const MAX_CATEGORIES = 12;

export function ModifierEditor(props: ModifierEditorProps): JSX.Element {
  const {
    draft,
    onChange,
    onSave,
    onCancel,
    onPreviewApplication,
    testId = "rater-modifier-editor",
  } = props;
  const uid = useId();
  const isValid = isModifierDraftValid(draft);
  const sums = computeCategoryRangeSums(draft);

  const updateDraft = (patch: Partial<ModifierDraft>) => {
    onChange({ ...draft, ...patch });
  };

  const updateCategory = (
    rowId: string,
    patch: Partial<ModifierCategoryRow>,
  ) => {
    onChange({
      ...draft,
      categories: draft.categories.map((c) =>
        c.id === rowId ? { ...c, ...patch } : c,
      ),
    });
  };

  const addCategory = () => {
    if (draft.categories.length >= MAX_CATEGORIES) return;
    onChange({
      ...draft,
      categories: [...draft.categories, emptyCategoryRow(draft.categories.length)],
    });
  };

  const removeCategory = (rowId: string) => {
    if (draft.categories.length === 1) return;
    onChange({
      ...draft,
      categories: draft.categories.filter((c) => c.id !== rowId),
    });
  };

  return (
    <section className="rater-modifier-editor" data-testid={testId}>
      <header className="rater-modifier-editor__head">
        <div className="rater-modifier-editor__head-icon" aria-hidden>
          {draft.kind === "schedule" ? (
            "±"
          ) : draft.kind === "flat" ? (
            "×"
          ) : draft.kind === "provision" ? (
            "π"
          ) : (
            <Brain size={16} strokeWidth={1.8} aria-hidden />
          )}
        </div>
        <div className="rater-modifier-editor__head-text">
          <h3 className="rater-modifier-editor__head-title">
            {draft.display_name || "Untitled modifier"}
          </h3>
          <span className="rater-modifier-editor__head-sub">
            modifier · {draft.kind}
            {draft.kind === "schedule" && draft.cap_pct > 0
              ? ` · ±${draft.cap_pct}% cap`
              : ""}
            {draft.kind === "model" &&
            Number.isFinite(draft.clamp_min) &&
            Number.isFinite(draft.clamp_max)
              ? ` · clamp [${draft.clamp_min}, ${draft.clamp_max}]`
              : ""}
          </span>
        </div>
      </header>

      <div className="rater-modifier-editor__body">
        {/* Kind picker */}
        <div className="rater-modifier-editor__field">
          <label className="rater-modifier-editor__field-label">
            Modifier kind
          </label>
          <div
            className="rater-modifier-editor__kind-picker"
            role="radiogroup"
            aria-label="Modifier kind"
          >
            <KindBtn
              kind="schedule"
              glyph="±"
              label="Schedule"
              hint="Categories with ±N%"
              selected={draft.kind === "schedule"}
              onClick={() => updateDraft({ kind: "schedule" })}
              testId={`${testId}-kind-schedule`}
            />
            <KindBtn
              kind="flat"
              glyph="×"
              label="Flat"
              hint="Single factor / amount"
              selected={draft.kind === "flat"}
              onClick={() => updateDraft({ kind: "flat" })}
              testId={`${testId}-kind-flat`}
            />
            <KindBtn
              kind="provision"
              glyph="π"
              label="Provision"
              hint="Fixed multiplier"
              selected={draft.kind === "provision"}
              onClick={() => updateDraft({ kind: "provision" })}
              testId={`${testId}-kind-provision`}
            />
            <KindBtn
              kind="model"
              glyph={<Brain size={14} strokeWidth={1.8} aria-hidden />}
              label="Model"
              hint="ML factor + filed clamp"
              selected={draft.kind === "model"}
              onClick={() => updateDraft({ kind: "model" })}
              testId={`${testId}-kind-model`}
            />
          </div>
        </div>

        {/* Display name (common to all kinds) */}
        <div className="rater-modifier-editor__field">
          <label
            htmlFor={`${uid}-name`}
            className="rater-modifier-editor__field-label"
          >
            Display name
          </label>
          <input
            id={`${uid}-name`}
            className="rater-modifier-editor__input"
            value={draft.display_name}
            placeholder={
              draft.kind === "schedule"
                ? "IRPM schedule"
                : draft.kind === "flat"
                  ? "Terrorism loading"
                  : draft.kind === "provision"
                    ? "Profit + expense provision"
                    : "Credit-score pricing model"
            }
            onChange={(e) => updateDraft({ display_name: e.target.value })}
            data-testid={`${testId}-name`}
          />
        </div>

        {/* ── Schedule mode fields ──────────────────────────────── */}
        {draft.kind === "schedule" ? (
          <ScheduleFields
            uid={uid}
            testId={testId}
            draft={draft}
            sums={sums}
            updateDraft={updateDraft}
            updateCategory={updateCategory}
            addCategory={addCategory}
            removeCategory={removeCategory}
          />
        ) : null}

        {/* ── Flat mode fields ──────────────────────────────────── */}
        {draft.kind === "flat" ? (
          <FlatFields
            uid={uid}
            testId={testId}
            draft={draft}
            updateDraft={updateDraft}
          />
        ) : null}

        {/* ── Provision mode fields ─────────────────────────────── */}
        {draft.kind === "provision" ? (
          <ProvisionFields
            uid={uid}
            testId={testId}
            draft={draft}
            updateDraft={updateDraft}
          />
        ) : null}

        {/* ── Model mode fields ─────────────────────────────────── */}
        {draft.kind === "model" ? (
          <ModelFields
            uid={uid}
            testId={testId}
            draft={draft}
            updateDraft={updateDraft}
            onChange={onChange}
          />
        ) : null}

        {/* Citation — common */}
        <div className="rater-modifier-editor__field">
          <label
            htmlFor={`${uid}-citation`}
            className="rater-modifier-editor__field-label"
          >
            Citation (optional)
          </label>
          <input
            id={`${uid}-citation`}
            className="rater-modifier-editor__input is-mono"
            value={draft.citation}
            placeholder={
              draft.kind === "schedule"
                ? "Meridian BOP 2024 · Rule 47.2"
                : draft.kind === "flat"
                  ? "TRIA 2024"
                  : "Company filing §B"
            }
            onChange={(e) => updateDraft({ citation: e.target.value })}
            data-testid={`${testId}-citation`}
          />
        </div>

        {/* Actions */}
        <div className="rater-modifier-editor__actions">
          {onCancel ? (
            <button
              type="button"
              className="rater-modifier-editor__btn"
              onClick={onCancel}
              data-testid={`${testId}-cancel`}
            >
              Cancel
            </button>
          ) : null}
          {onPreviewApplication ? (
            <button
              type="button"
              className="rater-modifier-editor__btn"
              onClick={onPreviewApplication}
              data-testid={`${testId}-preview`}
            >
              Preview application form
            </button>
          ) : null}
          {onSave ? (
            <button
              type="button"
              className="rater-modifier-editor__btn is-primary"
              onClick={onSave}
              disabled={!isValid}
              aria-disabled={!isValid}
              data-testid={`${testId}-save`}
              title={!isValid ? "Fill in all required fields first" : undefined}
            >
              Save modifier
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Schedule mode
// ─────────────────────────────────────────────────────────────────

interface ScheduleFieldsProps {
  readonly uid: string;
  readonly testId: string;
  readonly draft: ModifierDraft;
  readonly sums: { sum_lo: number; sum_hi: number } | null;
  readonly updateDraft: (patch: Partial<ModifierDraft>) => void;
  readonly updateCategory: (
    rowId: string,
    patch: Partial<ModifierCategoryRow>,
  ) => void;
  readonly addCategory: () => void;
  readonly removeCategory: (rowId: string) => void;
}

function ScheduleFields(props: ScheduleFieldsProps): JSX.Element {
  const {
    uid,
    testId,
    draft,
    sums,
    updateDraft,
    updateCategory,
    addCategory,
    removeCategory,
  } = props;

  const sumExceedsCap =
    sums !== null &&
    (sums.sum_hi > draft.cap_pct || -sums.sum_lo > draft.cap_pct);

  return (
    <>
      <div className="rater-modifier-editor__field">
        <label
          htmlFor={`${uid}-cap`}
          className="rater-modifier-editor__field-label"
        >
          Total cap (±%)
        </label>
        <input
          id={`${uid}-cap`}
          type="number"
          className="rater-modifier-editor__input is-mono is-narrow"
          value={draft.cap_pct}
          min={0}
          max={100}
          step={1}
          onChange={(e) =>
            updateDraft({ cap_pct: Number.parseFloat(e.target.value) || 0 })
          }
          data-testid={`${testId}-cap`}
        />
        <p className="rater-modifier-editor__field-hint">
          Enforced at application time. Sum of all category values stays
          within [−{draft.cap_pct}%, +{draft.cap_pct}%].
        </p>
      </div>

      <div className="rater-modifier-editor__field">
        <label className="rater-modifier-editor__field-label">Categories</label>
        <div className="rater-modifier-editor__cat-table" role="table">
          <div className="rater-modifier-editor__cat-head" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Lo %</span>
            <span role="columnheader">Hi %</span>
            <span role="columnheader">Tier filter</span>
            <span role="columnheader" title="Reasoning required when value ≠ 0">
              Reason
            </span>
            <span role="columnheader" aria-label="actions" />
          </div>
          {draft.categories.map((c, idx) => (
            <CategoryRow
              key={c.id}
              row={c}
              showRemove={draft.categories.length > 1}
              onChange={(patch) => updateCategory(c.id, patch)}
              onRemove={() => removeCategory(c.id)}
              testId={`${testId}-cat-${idx}`}
            />
          ))}
          <div
            className="rater-modifier-editor__cat-foot"
            role="row"
            data-state={sumExceedsCap ? "exceeds" : "ok"}
          >
            <span className="rater-modifier-editor__cat-foot-label">
              Total cap
            </span>
            <span className="rater-modifier-editor__cat-foot-val">
              ±{draft.cap_pct}%
            </span>
          </div>
        </div>
        {sums !== null ? (
          <p className="rater-modifier-editor__field-hint">
            Sum of upper bounds: <code>+{sums.sum_hi}%</code>; sum of lower
            bounds: <code>{sums.sum_lo}%</code>. Cap clamps to{" "}
            <strong>±{draft.cap_pct}%</strong> at application time.
          </p>
        ) : null}
        {draft.categories.length < MAX_CATEGORIES ? (
          <button
            type="button"
            className="rater-modifier-editor__add-cat"
            onClick={addCategory}
            data-testid={`${testId}-add-cat`}
          >
            <Plus size={12} strokeWidth={2} aria-hidden /> Add category
            <span className="rater-modifier-editor__add-hint">
              ({MAX_CATEGORIES - draft.categories.length} more allowed)
            </span>
          </button>
        ) : null}
      </div>
    </>
  );
}

interface CategoryRowProps {
  readonly row: ModifierCategoryRow;
  readonly showRemove: boolean;
  readonly onChange: (patch: Partial<ModifierCategoryRow>) => void;
  readonly onRemove: () => void;
  readonly testId?: string;
}

function CategoryRow(props: CategoryRowProps): JSX.Element {
  const { row, showRemove, onChange, onRemove, testId } = props;
  const tierString = row.tier_filter.join(", ");
  return (
    <div className="rater-modifier-editor__cat-row" role="row">
      <input
        className="rater-modifier-editor__input"
        value={row.name}
        placeholder="e.g., Management quality"
        onChange={(e) => onChange({ name: e.target.value })}
        aria-label="Category name"
        data-testid={testId ? `${testId}-name` : undefined}
      />
      <input
        type="number"
        className="rater-modifier-editor__input is-mono is-narrow"
        value={row.range_lo_pct}
        onChange={(e) =>
          onChange({ range_lo_pct: Number.parseFloat(e.target.value) || 0 })
        }
        aria-label="Lower bound percentage"
        data-testid={testId ? `${testId}-lo` : undefined}
      />
      <input
        type="number"
        className="rater-modifier-editor__input is-mono is-narrow"
        value={row.range_hi_pct}
        onChange={(e) =>
          onChange({ range_hi_pct: Number.parseFloat(e.target.value) || 0 })
        }
        aria-label="Upper bound percentage"
        data-testid={testId ? `${testId}-hi` : undefined}
      />
      <input
        className="rater-modifier-editor__input is-mono"
        value={tierString}
        placeholder="all, or tier-1, tier-2"
        onChange={(e) =>
          onChange({
            tier_filter: e.target.value
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          })
        }
        aria-label="Tier filter (comma-separated)"
        data-testid={testId ? `${testId}-tier` : undefined}
      />
      <Checkbox
        className="rater-modifier-editor__cat-reason"
        checked={row.reasoning_required}
        onChange={(next) => onChange({ reasoning_required: next })}
        aria-label="Reasoning required"
        data-testid={testId ? `${testId}-reason` : undefined}
        label="Reqd"
      />
      {showRemove ? (
        <button
          type="button"
          className="rater-modifier-editor__cat-remove"
          onClick={onRemove}
          aria-label="Remove category"
          data-testid={testId ? `${testId}-remove` : undefined}
        >
          <Trash2 size={12} strokeWidth={1.8} aria-hidden />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Flat mode
// ─────────────────────────────────────────────────────────────────

interface FlatFieldsProps {
  readonly uid: string;
  readonly testId: string;
  readonly draft: ModifierDraft;
  readonly updateDraft: (patch: Partial<ModifierDraft>) => void;
}

function FlatFields(props: FlatFieldsProps): JSX.Element {
  const { uid, testId, draft, updateDraft } = props;
  return (
    <>
      <div className="rater-modifier-editor__field">
        <label className="rater-modifier-editor__field-label">Effect kind</label>
        <div className="rater-modifier-editor__effect-toggle" role="radiogroup">
          <button
            type="button"
            role="radio"
            aria-checked={draft.flat_effect === "factor"}
            className={`rater-modifier-editor__effect-btn${draft.flat_effect === "factor" ? " is-selected" : ""}`}
            onClick={() => updateDraft({ flat_effect: "factor" })}
            data-testid={`${testId}-flat-factor`}
          >
            × Factor
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={draft.flat_effect === "additive"}
            className={`rater-modifier-editor__effect-btn${draft.flat_effect === "additive" ? " is-selected" : ""}`}
            onClick={() => updateDraft({ flat_effect: "additive" })}
            data-testid={`${testId}-flat-additive`}
          >
            + Additive
          </button>
        </div>
      </div>

      {draft.flat_effect === "factor" ? (
        <div className="rater-modifier-editor__field">
          <label
            htmlFor={`${uid}-factor`}
            className="rater-modifier-editor__field-label"
          >
            Factor
          </label>
          <input
            id={`${uid}-factor`}
            type="number"
            step={0.01}
            className="rater-modifier-editor__input is-mono is-narrow"
            value={draft.flat_factor}
            onChange={(e) =>
              updateDraft({
                flat_factor: Number.parseFloat(e.target.value) || 0,
              })
            }
            data-testid={`${testId}-factor-value`}
          />
          <p className="rater-modifier-editor__field-hint">
            Multiplier applied to chain output. 1.02 = 2% surcharge; 0.95 =
            5% credit.
          </p>
        </div>
      ) : (
        <div className="rater-modifier-editor__field">
          <label
            htmlFor={`${uid}-amount`}
            className="rater-modifier-editor__field-label"
          >
            Amount
          </label>
          <input
            id={`${uid}-amount`}
            type="number"
            step={1}
            className="rater-modifier-editor__input is-mono is-narrow"
            value={draft.flat_amount}
            onChange={(e) =>
              updateDraft({
                flat_amount: Number.parseFloat(e.target.value) || 0,
              })
            }
            data-testid={`${testId}-amount-value`}
          />
          <p className="rater-modifier-editor__field-hint">
            Flat $ amount added to chain output. Currency assumed to match
            the chain.
          </p>
        </div>
      )}

      <div className="rater-modifier-editor__field">
        <label
          htmlFor={`${uid}-flat-cond`}
          className="rater-modifier-editor__field-label"
        >
          Condition (optional)
        </label>
        <input
          id={`${uid}-flat-cond`}
          className="rater-modifier-editor__input is-mono"
          value={draft.flat_condition}
          placeholder="Always applies (leave blank for no condition)"
          onChange={(e) => updateDraft({ flat_condition: e.target.value })}
          data-testid={`${testId}-flat-condition`}
        />
        <p className="rater-modifier-editor__field-hint">
          v1 stores the condition as a free-text string. Structured condition
          picker lands in Brief 39 v2 (reuses FilterRuleEditor's quick-form).
        </p>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Provision mode
// ─────────────────────────────────────────────────────────────────

interface ProvisionFieldsProps {
  readonly uid: string;
  readonly testId: string;
  readonly draft: ModifierDraft;
  readonly updateDraft: (patch: Partial<ModifierDraft>) => void;
}

function ProvisionFields(props: ProvisionFieldsProps): JSX.Element {
  const { uid, testId, draft, updateDraft } = props;
  return (
    <>
      <div className="rater-modifier-editor__field">
        <label
          htmlFor={`${uid}-multiplier`}
          className="rater-modifier-editor__field-label"
        >
          Multiplier
        </label>
        <input
          id={`${uid}-multiplier`}
          type="number"
          step={0.01}
          className="rater-modifier-editor__input is-mono is-narrow"
          value={draft.provision_multiplier}
          onChange={(e) =>
            updateDraft({
              provision_multiplier: Number.parseFloat(e.target.value) || 0,
            })
          }
          data-testid={`${testId}-provision-multiplier`}
        />
        <p className="rater-modifier-editor__field-hint">
          1.05 = 5% load (expense + profit). Always applied — provisions
          don't carry conditions in v1.
        </p>
      </div>

      <div className="rater-modifier-editor__field">
        <label
          htmlFor={`${uid}-applies-to`}
          className="rater-modifier-editor__field-label"
        >
          Applies to
        </label>
        <select
          id={`${uid}-applies-to`}
          className="rater-modifier-editor__input"
          value={draft.provision_applies_to}
          onChange={(e) =>
            updateDraft({
              provision_applies_to: e.target.value as ModifierAppliesTo,
            })
          }
          data-testid={`${testId}-provision-applies-to`}
        >
          <option value="all">All policies</option>
          <option value="tier-1">Tier-1 only</option>
          <option value="tier-2">Tier-2 only</option>
          <option value="by-level">By rating dimension level</option>
        </select>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Model mode (Phase H.6 — Brief 41 + ModifierModelKind contract)
// ─────────────────────────────────────────────────────────────────
//
// Five field groups, top-to-bottom:
//   1. Model identity (model_id + version, side-by-side)
//   2. Declared inputs table (mirrors ScheduleFields category table)
//   3. Clamp envelope (min + max + live ClampVisualizer)
//   4. Fallback factor
//   5. Rationale (multi-line — Brief 41 §−1 Q3 audit trail)
//
// The fallback factor is rendered as a diamond marker on the
// visualizer so the user can SEE whether their filed fallback
// lands inside or outside the clamp envelope. (Brief 41 §−1 Q6:
// when fallback fires, clamp is NOT evaluated — so the fallback
// is allowed to sit outside the clamp. The visualization makes
// that asymmetry legible.)

interface ModelFieldsProps {
  readonly uid: string;
  readonly testId: string;
  readonly draft: ModifierDraft;
  readonly updateDraft: (patch: Partial<ModifierDraft>) => void;
  /** Direct onChange handle for collection mutations (mirrors how
   *  ScheduleFields receives updateCategory). */
  readonly onChange: (next: ModifierDraft) => void;
}

const MAX_MODEL_INPUTS = 12;

function ModelFields(props: ModelFieldsProps): JSX.Element {
  const { uid, testId, draft, updateDraft, onChange } = props;

  const updateInputRow = (
    rowId: string,
    patch: Partial<ModifierModelInputRow>,
  ) => {
    onChange({
      ...draft,
      model_inputs: draft.model_inputs.map((r) =>
        r.id === rowId ? { ...r, ...patch } : r,
      ),
    });
  };
  const addInputRow = () => {
    if (draft.model_inputs.length >= MAX_MODEL_INPUTS) return;
    onChange({
      ...draft,
      model_inputs: [
        ...draft.model_inputs,
        emptyModelInputRow(draft.model_inputs.length),
      ],
    });
  };
  const removeInputRow = (rowId: string) => {
    if (draft.model_inputs.length === 1) return;
    onChange({
      ...draft,
      model_inputs: draft.model_inputs.filter((r) => r.id !== rowId),
    });
  };

  const clampInverted = draft.clamp_min > draft.clamp_max;

  return (
    <>
      {/* ── Model identity ──────────────────────────────────────── */}
      <div className="rater-modifier-editor__field rater-modifier-editor__field--pair">
        <div className="rater-modifier-editor__field-col">
          <label
            htmlFor={`${uid}-model-id`}
            className="rater-modifier-editor__field-label"
          >
            Model id
          </label>
          <input
            id={`${uid}-model-id`}
            className="rater-modifier-editor__input is-mono"
            value={draft.model_id}
            placeholder="credit_score_pricing_v1"
            onChange={(e) => updateDraft({ model_id: e.target.value })}
            data-testid={`${testId}-model-id`}
          />
        </div>
        <div className="rater-modifier-editor__field-col">
          <label
            htmlFor={`${uid}-model-version`}
            className="rater-modifier-editor__field-label"
          >
            Version
          </label>
          <input
            id={`${uid}-model-version`}
            className="rater-modifier-editor__input is-mono is-narrow"
            value={draft.model_version}
            placeholder="2026.05"
            onChange={(e) => updateDraft({ model_version: e.target.value })}
            data-testid={`${testId}-model-version`}
          />
        </div>
      </div>

      {/* ── Declared inputs table ───────────────────────────────── */}
      <div className="rater-modifier-editor__field">
        <label className="rater-modifier-editor__field-label">
          Declared inputs
        </label>
        <p className="rater-modifier-editor__field-hint">
          The variables this model REQUIRES at scoring time. When any
          is missing from the row's externalInputs, the fallback path
          fires (Brief 41 §−1 Q6).
        </p>
        <div className="rater-modifier-editor__model-inputs">
          {draft.model_inputs.map((row, idx) => (
            <div
              key={row.id}
              className="rater-modifier-editor__model-input-row"
              role="row"
            >
              <input
                className="rater-modifier-editor__input is-mono"
                value={row.variable}
                placeholder="credit_score"
                onChange={(e) =>
                  updateInputRow(row.id, { variable: e.target.value })
                }
                aria-label="Declared input variable name"
                data-testid={`${testId}-model-input-${idx}`}
              />
              {draft.model_inputs.length > 1 ? (
                <button
                  type="button"
                  className="rater-modifier-editor__cat-remove"
                  onClick={() => removeInputRow(row.id)}
                  aria-label="Remove declared input"
                  data-testid={`${testId}-model-input-${idx}-remove`}
                >
                  <Trash2 size={12} strokeWidth={1.8} aria-hidden />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        {draft.model_inputs.length < MAX_MODEL_INPUTS ? (
          <button
            type="button"
            className="rater-modifier-editor__add-cat"
            onClick={addInputRow}
            data-testid={`${testId}-model-input-add`}
          >
            <Plus size={12} strokeWidth={2} aria-hidden /> Add input
            <span className="rater-modifier-editor__add-hint">
              ({MAX_MODEL_INPUTS - draft.model_inputs.length} more allowed)
            </span>
          </button>
        ) : null}
      </div>

      {/* ── Clamp envelope ──────────────────────────────────────── */}
      <div className="rater-modifier-editor__field">
        <label className="rater-modifier-editor__field-label">
          Clamp envelope (filed)
        </label>
        <p className="rater-modifier-editor__field-hint">
          The factor that lands at scoring time is clamped to this
          band. Per Brief 42 §−1 Q6, the clamp is NOT evaluated when
          fallback fires — the fallback factor is applied verbatim.
        </p>
        <div className="rater-modifier-editor__field rater-modifier-editor__field--pair">
          <div className="rater-modifier-editor__field-col">
            <label
              htmlFor={`${uid}-clamp-min`}
              className="rater-modifier-editor__field-label is-compact"
            >
              Min factor
            </label>
            <input
              id={`${uid}-clamp-min`}
              type="number"
              step={0.01}
              className="rater-modifier-editor__input is-mono is-narrow"
              value={draft.clamp_min}
              onChange={(e) =>
                updateDraft({
                  clamp_min: Number.parseFloat(e.target.value) || 0,
                })
              }
              data-testid={`${testId}-clamp-min`}
            />
          </div>
          <div className="rater-modifier-editor__field-col">
            <label
              htmlFor={`${uid}-clamp-max`}
              className="rater-modifier-editor__field-label is-compact"
            >
              Max factor
            </label>
            <input
              id={`${uid}-clamp-max`}
              type="number"
              step={0.01}
              className="rater-modifier-editor__input is-mono is-narrow"
              value={draft.clamp_max}
              onChange={(e) =>
                updateDraft({
                  clamp_max: Number.parseFloat(e.target.value) || 0,
                })
              }
              data-testid={`${testId}-clamp-max`}
            />
          </div>
        </div>
        <ClampVisualizer
          minFactor={draft.clamp_min}
          maxFactor={draft.clamp_max}
          fallbackFactor={draft.fallback_factor}
          testId={`${testId}-clamp-visualizer`}
        />
        {clampInverted ? null : (
          <p className="rater-modifier-editor__field-hint">
            Diamond marker = fallback factor ({draft.fallback_factor}).
            {draft.fallback_factor < draft.clamp_min ||
            draft.fallback_factor > draft.clamp_max
              ? " It sits OUTSIDE the clamp — by design when fallback fires."
              : " It sits inside the clamp envelope."}
          </p>
        )}
      </div>

      {/* ── Fallback factor ─────────────────────────────────────── */}
      <div className="rater-modifier-editor__field">
        <label
          htmlFor={`${uid}-fallback`}
          className="rater-modifier-editor__field-label"
        >
          Fallback factor
        </label>
        <input
          id={`${uid}-fallback`}
          type="number"
          step={0.01}
          className="rater-modifier-editor__input is-mono is-narrow"
          value={draft.fallback_factor}
          onChange={(e) =>
            updateDraft({
              fallback_factor: Number.parseFloat(e.target.value) || 0,
            })
          }
          data-testid={`${testId}-fallback-factor`}
        />
        <p className="rater-modifier-editor__field-hint">
          Applied when ANY declared input is missing from the row. 1.0
          = neutral; 0.95 = small credit; 1.10 = small surcharge.
        </p>
      </div>

      {/* ── Rationale (filed audit trail) ───────────────────────── */}
      <div className="rater-modifier-editor__field">
        <label
          htmlFor={`${uid}-rationale`}
          className="rater-modifier-editor__field-label"
        >
          Rationale
        </label>
        <textarea
          id={`${uid}-rationale`}
          className="rater-modifier-editor__textarea"
          value={draft.rationale}
          rows={3}
          placeholder="Why this clamp envelope was filed (carrier audit trail)."
          onChange={(e) => updateDraft({ rationale: e.target.value })}
          data-testid={`${testId}-rationale`}
        />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-primitives
// ─────────────────────────────────────────────────────────────────

interface KindBtnProps {
  readonly kind: ModifierKind;
  /** Glyph is a string for typographic marks (±, ×, π) or a JSX
   *  node for lucide icons (the Brain icon for model). Mixing the
   *  two is intentional — the typographic marks tie back to the
   *  ScheduleFields / FlatFields / ProvisionFields visual language
   *  established in Brief 39 PR 39.3. */
  readonly glyph: string | JSX.Element;
  readonly label: string;
  readonly hint: string;
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly testId?: string;
}

function KindBtn(props: KindBtnProps): JSX.Element {
  const { kind, glyph, label, hint, selected, onClick, testId } = props;
  const isIcon = typeof glyph !== "string";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`rater-modifier-editor__kind-btn${selected ? " is-selected" : ""}`}
      data-kind={kind}
      onClick={onClick}
      data-testid={testId}
    >
      <span
        className={`rater-modifier-editor__kind-glyph${isIcon ? " is-icon" : ""}`}
        aria-hidden
      >
        {glyph}
      </span>
      <span className="rater-modifier-editor__kind-label">{label}</span>
      <span className="rater-modifier-editor__kind-hint">{hint}</span>
    </button>
  );
}
