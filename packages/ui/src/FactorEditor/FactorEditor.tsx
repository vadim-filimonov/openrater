/**
 * <FactorEditor> — the per-kind config form for a chain factor.
 *
 * Composes M4.3.2's ChainFactorKindSelect (kind picker at top) with
 * per-kind config fields below. The form is controlled — parent
 * owns the draft state via `value` + `onChange`. Save / Cancel are
 * the parent's responsibility (typically rendered as drawer footer
 * buttons that consult the draft).
 *
 * ## Scope
 *
 * This PR ships the 3 most-common factor kinds end-to-end:
 *
 *   · `constant`              → number input + reason text
 *   · `lookup.classification` → ClassPicker (M4.3.1) — uses the
 *                                class library passed in as `classes`
 *   · `flat_factor`           → number input + reason text (separate
 *                                substrate kind from constant; same
 *                                shape, different audit semantics)
 *
 * Per Brief 8 + the M4.3.2 catalog, the remaining 3 kinds
 * (`lookup.direct`, `lookup.range`, `formula`) fall through to a
 * placeholder "Editor lands in next PR" panel. That keeps every
 * kind in the picker functional + signals to the actuary which
 * forms are wired today.
 *
 * Brief 34 PR 34.7 removed the `curve.evaluate` kind. Brief 19's
 * curve concept is superseded by 1-D banded factor tables
 * rendered via <FactorTableViz>.
 *
 * ## Value shape
 *
 * The draft state is a tagged-union over kind. The parent persists
 * it as the stage's `config_json` (mapping FactorDraft → backend
 * shape is the parent's job; this primitive is UI-only).
 *
 *   FactorDraft =
 *     | { kind: "constant",              value: number, reason?: string }
 *     | { kind: "lookup.classification", class_code: string }
 *     | { kind: "flat_factor",           factor: number, reason?: string }
 *     | { kind: "lookup.direct"          | "lookup.range"
 *               | "formula"  /* deferred *​/ }
 *     | { kind: "" /* unset *​/ }
 *
 * The parent enables Save only when the draft is in a "complete"
 * shape — `isFactorDraftComplete(draft)` exported for that check.
 */

import { useCallback } from "react";
import { ChainFactorKindSelect, type ChainFactorKind } from "../ChainFactorKindSelect";
import { ClassPicker, type ClassPickerOption } from "../ClassPicker";
import { DimensionRefPicker, type DimensionRefOption } from "../DimensionRefPicker";
import {
  FactorTableRefPicker,
  type FactorTableRefOption,
} from "../FactorTableRefPicker";
import type { EntityRefPickerEmptyAction } from "../EntityRefPicker";
import "./FactorEditor.css";

// ---------------------------------------------------------------------------
// FactorDraft — the tagged-union state shape
// ---------------------------------------------------------------------------

export type FactorDraft =
  | { readonly kind: ""; /* unset — drives the placeholder state */ }
  | { readonly kind: "constant"; readonly value: number | ""; readonly reason: string }
  | { readonly kind: "lookup.classification"; readonly class_code: string }
  | { readonly kind: "flat_factor"; readonly factor: number | ""; readonly reason: string }
  | {
      readonly kind: "lookup.direct";
      /** Key dimension to look up by. */
      readonly dimension_id: string;
      /** Factor table to read the value from. */
      readonly factor_table_id: string;
      /**
       * ADR-0056 — what happens when a risk's key isn't in the table:
       * refuse the row (`error`, THE default), apply an authored value
       * (`default` + value — the filed "All other" row as data), or
       * rate 1.0 indicative and refer to underwriting (`refer`).
       */
      readonly unknown_key_policy?: {
        readonly mode: "error" | "default" | "refer";
        readonly value?: number | "";
      };
    }
  | { readonly kind: "lookup.range" }
  | { readonly kind: "formula" };

/**
 * Returns true when the draft has all required fields filled. Parent
 * uses this to gate the Save button.
 */
export function isFactorDraftComplete(draft: FactorDraft): boolean {
  switch (draft.kind) {
    case "":
      return false;
    case "constant":
      return typeof draft.value === "number" && Number.isFinite(draft.value);
    case "lookup.classification":
      return draft.class_code !== "";
    case "flat_factor":
      return typeof draft.factor === "number" && Number.isFinite(draft.factor);
    case "lookup.direct": {
      // ADR-0056 — a "default" policy needs its authored value.
      const p = draft.unknown_key_policy;
      const policyOk =
        !p ||
        p.mode !== "default" ||
        (typeof p.value === "number" && Number.isFinite(p.value));
      return (
        draft.dimension_id !== "" && draft.factor_table_id !== "" && policyOk
      );
    }
    case "lookup.range":
    case "formula":
      // Deferred kinds — never "complete" in this PR.
      return false;
  }
}

/**
 * Build a fresh default draft for the given kind. The parent calls
 * this when the actuary picks a new kind from the dropdown.
 */
export function emptyDraftForKind(kind: ChainFactorKind | ""): FactorDraft {
  switch (kind) {
    case "":
      return { kind: "" };
    case "constant":
      return { kind: "constant", value: "", reason: "" };
    case "lookup.classification":
      return { kind: "lookup.classification", class_code: "" };
    case "flat_factor":
      return { kind: "flat_factor", factor: "", reason: "" };
    case "lookup.direct":
      return { kind: "lookup.direct", dimension_id: "", factor_table_id: "" };
    case "lookup.range":
      return { kind: "lookup.range" };
    case "formula":
      return { kind: "formula" };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface FactorEditorProps {
  /** Current draft state. */
  readonly value: FactorDraft;
  /** Fires whenever the draft changes — kind, field values, etc. */
  readonly onChange: (next: FactorDraft) => void;
  /** Class library — passed to ClassPicker for `lookup.classification`. */
  readonly classes?: readonly ClassPickerOption[];
  /** Dimensions registered on the plan — passed to DimensionRefPicker
   *  for `lookup.direct` (key). */
  readonly dimensions?: readonly DimensionRefOption[];
  /** Factor tables registered on the plan — passed to
   *  FactorTableRefPicker for `lookup.direct`. */
  readonly factorTables?: readonly FactorTableRefOption[];
  /** Optional empty-state handoffs for each picker. */
  readonly classPickerEmptyAction?: EntityRefPickerEmptyAction;
  readonly dimensionPickerEmptyAction?: EntityRefPickerEmptyAction;
  readonly factorTablePickerEmptyAction?: EntityRefPickerEmptyAction;
  /**
   * When true, the kind select is disabled. Used by the route's
   * edit-factor flow (M4.3.9): switching kinds mid-edit would either
   * wipe the form or require a re-author, both of which are
   * confusing. The actuary delete-and-re-adds to change kinds.
   */
  readonly kindLocked?: boolean;
  readonly testId?: string;
}

export function FactorEditor(props: FactorEditorProps): JSX.Element {
  const {
    value,
    onChange,
    classes,
    dimensions,
    factorTables,
    classPickerEmptyAction,
    dimensionPickerEmptyAction,
    factorTablePickerEmptyAction,
    kindLocked = false,
    testId = "rater-factor-editor",
  } = props;

  const handleKindChange = useCallback(
    (next: ChainFactorKind) => {
      onChange(emptyDraftForKind(next));
    },
    [onChange],
  );

  return (
    <div className="rater-factor-editor" data-testid={testId}>
      <div className="rater-factor-editor__field">
        <label className="rater-factor-editor__label" htmlFor={`${testId}-kind`}>
          Factor kind
        </label>
        <ChainFactorKindSelect
          value={value.kind}
          onChange={handleKindChange}
          inputId={`${testId}-kind`}
          disabled={kindLocked}
        />
      </div>

      <div className="rater-factor-editor__per-kind">
        {value.kind === "" && (
          <div className="rater-factor-editor__hint">
            Pick a kind above to start configuring the factor.
          </div>
        )}

        {value.kind === "constant" && (
          <ConstantFields draft={value} onChange={onChange} />
        )}

        {value.kind === "flat_factor" && (
          <FlatFactorFields draft={value} onChange={onChange} />
        )}

        {value.kind === "lookup.classification" && (
          <ClassificationFields
            draft={value}
            onChange={onChange}
            classes={classes ?? []}
            {...(classPickerEmptyAction !== undefined
              ? { classPickerEmptyAction }
              : {})}
          />
        )}

        {value.kind === "lookup.direct" && (
          <LookupDirectFields
            draft={value}
            onChange={onChange}
            dimensions={dimensions ?? []}
            factorTables={factorTables ?? []}
            {...(dimensionPickerEmptyAction !== undefined
              ? { dimensionPickerEmptyAction }
              : {})}
            {...(factorTablePickerEmptyAction !== undefined
              ? { factorTablePickerEmptyAction }
              : {})}
          />
        )}

        {(value.kind === "lookup.range" || value.kind === "formula") && (
          <div className="rater-factor-editor__deferred" role="status">
            <strong>Editor lands in next PR.</strong> The{" "}
            <code>{value.kind}</code> kind is recognized by the substrate
            today; the inline config form is in a follow-up PR.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-kind sub-forms
// ---------------------------------------------------------------------------

function ConstantFields({
  draft,
  onChange,
}: {
  draft: Extract<FactorDraft, { kind: "constant" }>;
  onChange: (next: FactorDraft) => void;
}): JSX.Element {
  return (
    <>
      <div className="rater-factor-editor__field">
        <label className="rater-factor-editor__label" htmlFor="rater-factor-editor-constant-value">
          Value
        </label>
        <input
          id="rater-factor-editor-constant-value"
          type="number"
          step="any"
          className="rater-factor-editor__input"
          value={draft.value}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({
              ...draft,
              value: raw === "" ? "" : Number(raw),
            });
          }}
          aria-label="Constant value"
        />
        <p className="rater-factor-editor__hint">
          A literal number baked into the plan (e.g., 0.95 for a sprinkler credit).
        </p>
      </div>
      <div className="rater-factor-editor__field">
        <label className="rater-factor-editor__label" htmlFor="rater-factor-editor-constant-reason">
          Reason
        </label>
        <input
          id="rater-factor-editor-constant-reason"
          type="text"
          className="rater-factor-editor__input"
          value={draft.reason}
          onChange={(e) => onChange({ ...draft, reason: e.target.value })}
          placeholder="e.g., 'Sprinklered credit per WI BOP §22.3'"
          aria-label="Reason for the constant value"
        />
        <p className="rater-factor-editor__hint">
          One-line citation or rationale. Appears in the trace + audit log.
        </p>
      </div>
    </>
  );
}

function FlatFactorFields({
  draft,
  onChange,
}: {
  draft: Extract<FactorDraft, { kind: "flat_factor" }>;
  onChange: (next: FactorDraft) => void;
}): JSX.Element {
  return (
    <>
      <div className="rater-factor-editor__field">
        <label className="rater-factor-editor__label" htmlFor="rater-factor-editor-flat-factor">
          Factor
        </label>
        <input
          id="rater-factor-editor-flat-factor"
          type="number"
          step="any"
          className="rater-factor-editor__input"
          value={draft.factor}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({
              ...draft,
              factor: raw === "" ? "" : Number(raw),
            });
          }}
          aria-label="Flat factor value"
        />
        <p className="rater-factor-editor__hint">
          IRPM-style single-factor wrapper. Same shape as Constant but
          surfaces as &ldquo;flat factor&rdquo; in trace explanations.
        </p>
      </div>
      <div className="rater-factor-editor__field">
        <label className="rater-factor-editor__label" htmlFor="rater-factor-editor-flat-reason">
          Reason
        </label>
        <input
          id="rater-factor-editor-flat-reason"
          type="text"
          className="rater-factor-editor__input"
          value={draft.reason}
          onChange={(e) => onChange({ ...draft, reason: e.target.value })}
          placeholder="e.g., 'IRPM judgment factor — large account discount'"
          aria-label="Reason for the flat factor"
        />
      </div>
    </>
  );
}

function ClassificationFields({
  draft,
  onChange,
  classes,
  classPickerEmptyAction,
}: {
  draft: Extract<FactorDraft, { kind: "lookup.classification" }>;
  onChange: (next: FactorDraft) => void;
  classes: readonly ClassPickerOption[];
  classPickerEmptyAction?: EntityRefPickerEmptyAction;
}): JSX.Element {
  return (
    <div className="rater-factor-editor__field">
      <label className="rater-factor-editor__label">Class</label>
      <ClassPicker
        classes={classes}
        value={draft.class_code}
        onChange={(code) => onChange({ ...draft, class_code: code })}
        {...(classPickerEmptyAction !== undefined
          ? { emptyAction: classPickerEmptyAction }
          : {})}
      />
      <p className="rater-factor-editor__hint">
        Pick a class from the live class library. The factor resolves
        the class&rsquo;s row in the linked factor table at runtime.
      </p>
    </div>
  );
}

function LookupDirectFields({
  draft,
  onChange,
  dimensions,
  factorTables,
  dimensionPickerEmptyAction,
  factorTablePickerEmptyAction,
}: {
  draft: Extract<FactorDraft, { kind: "lookup.direct" }>;
  onChange: (next: FactorDraft) => void;
  dimensions: readonly DimensionRefOption[];
  factorTables: readonly FactorTableRefOption[];
  dimensionPickerEmptyAction?: EntityRefPickerEmptyAction;
  factorTablePickerEmptyAction?: EntityRefPickerEmptyAction;
}): JSX.Element {
  return (
    <>
      <div className="rater-factor-editor__field">
        <label className="rater-factor-editor__label">Key dimension</label>
        <DimensionRefPicker
          dimensions={dimensions}
          value={draft.dimension_id}
          onChange={(id) => onChange({ ...draft, dimension_id: id })}
          {...(dimensionPickerEmptyAction !== undefined
            ? { emptyAction: dimensionPickerEmptyAction }
            : {})}
        />
        <p className="rater-factor-editor__hint">
          The risk attribute used as the lookup key (e.g.,
          construction_class, protection_class).
        </p>
      </div>
      <div className="rater-factor-editor__field">
        <label className="rater-factor-editor__label">Factor table</label>
        <FactorTableRefPicker
          tables={factorTables}
          value={draft.factor_table_id}
          onChange={(id) => onChange({ ...draft, factor_table_id: id })}
          {...(factorTablePickerEmptyAction !== undefined
            ? { emptyAction: factorTablePickerEmptyAction }
            : {})}
        />
        <p className="rater-factor-editor__hint">
          The table whose row is read using the key dimension&rsquo;s value.
        </p>
      </div>
      {/* ADR-0056 — the authored unknown-key policy (Law 2). Refuse is
          the default: an unknown key is an error the user sees, never
          a silent factor-1.0. */}
      <div className="rater-factor-editor__field">
        <label
          className="rater-factor-editor__label"
          htmlFor="rater-factor-editor-ukp"
        >
          If a risk&rsquo;s key isn&rsquo;t in the table
        </label>
        <select
          id="rater-factor-editor-ukp"
          className="rater-factor-editor__select"
          value={draft.unknown_key_policy?.mode ?? "error"}
          onChange={(e) => {
            const mode = e.target.value as "error" | "default" | "refer";
            onChange({
              ...draft,
              unknown_key_policy:
                mode === "default" ? { mode, value: "" } : { mode },
            });
          }}
          data-testid="rater-factor-editor-unknown-key-policy"
        >
          <option value="error">
            Refuse the row — it can&rsquo;t be rated (default)
          </option>
          <option value="default">Apply a default factor…</option>
          <option value="refer">Rate ×1.0 and refer to underwriting</option>
        </select>
        {draft.unknown_key_policy?.mode === "default" ? (
          <input
            type="number"
            step="any"
            className="rater-factor-editor__input"
            value={draft.unknown_key_policy.value ?? ""}
            placeholder="e.g., 1.0 — the filed “All other” factor"
            aria-label="Default factor when the key is not found"
            onChange={(e) => {
              const raw = e.target.value;
              onChange({
                ...draft,
                unknown_key_policy: {
                  mode: "default",
                  value: raw === "" ? "" : Number(raw),
                },
              });
            }}
            data-testid="rater-factor-editor-unknown-key-value"
          />
        ) : null}
        <p className="rater-factor-editor__hint">
          {draft.unknown_key_policy?.mode === "default"
            ? "The authored factor applies and the row is visibly marked — the filed “All other classes” row as data."
            : draft.unknown_key_policy?.mode === "refer"
              ? "The row rates at ×1.0 as indicative only and escalates to Submit for underwriter review."
              : "The row errors with the unknown key named — it never prices on a silent ×1.0."}
        </p>
      </div>
    </>
  );
}

