/**
 * <FlatFactorStageDrawer> — drawer surface for adding/editing a
 * flat_factor stage.
 *
 * The flat_factor stage kind is used across multiple sections —
 * Loadings (expense / profit / tax surcharges), Final Adjustments
 * (statutory surcharges, late fees), Coverage Chains (sibling
 * stages for constant / flat_factor draft kinds via M4.3.7's
 * factorDraftToMutation adapter). This primitive is the canonical
 * CRUD surface for them.
 *
 * Pure presentation. Parent owns:
 *   · the `open` flag + `draft` state
 *   · the Save semantics (HTTP, optimistic cache update)
 *
 * Save is gated by `isFlatFactorDraftComplete(draft)`; the Save
 * button stays disabled until the required fields are filled.
 *
 * ## Form shape (mirror of @openrater/contracts' FlatFactorConfig)
 *
 *   display_name      — required, free-form actuary label
 *   factor_kind       — required, slug (e.g., "expense_loading")
 *   factor            — required, numeric multiplier (1.35 = +35%)
 *   citation_rule     — optional, free-form citation
 *   citation_page     — optional, page reference within citation
 *   description_template — optional, with default "{factor_kind}: ×{value}"
 *
 * The substrate's FlatFactorConfig also requires `input_path` —
 * the route supplies that based on which section is being edited
 * (it's the predecessor stage's output, not actuary-authored).
 *
 * ⚠ v4 G6 — the runtime projector does NOT execute `flat_factor`
 * stages: a saved loading never changes the scored premium. The
 * drawer renders a permanent "Not yet priced" notice; remove it only
 * when the projector executes the kind.
 */

import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Drawer } from "@openrater/design-system";
import "./FlatFactorStageDrawer.css";

/** Draft state for the form. */
export interface FlatFactorDraft {
  readonly display_name: string;
  readonly factor_kind: string;
  readonly factor: number | "";
  readonly citation_rule: string;
  readonly citation_page: string;
  readonly description_template: string;
  /**
   * Platform-test finding E6 — the optional `{path, equals}` gate the
   * banner copy has always promised. Blank path = the loading always
   * applies. `predicate_equals` is the RAW typed value; the route
   * coerces at save ("true"/"false" → boolean, numeric → number,
   * blank → true).
   */
  readonly predicate_path: string;
  readonly predicate_equals: string;
}

/** Returns a fresh empty draft. */
export function emptyFlatFactorDraft(): FlatFactorDraft {
  return {
    display_name: "",
    factor_kind: "",
    factor: "",
    citation_rule: "",
    citation_page: "",
    description_template: "",
    predicate_path: "",
    predicate_equals: "",
  };
}

/**
 * Returns true when the draft has all required fields filled.
 * Parent uses this to gate the Save button.
 */
export function isFlatFactorDraftComplete(draft: FlatFactorDraft): boolean {
  if (draft.display_name.trim() === "") return false;
  if (draft.factor_kind.trim() === "") return false;
  if (typeof draft.factor !== "number" || !Number.isFinite(draft.factor)) {
    return false;
  }
  return true;
}

export interface FlatFactorStageDrawerProps {
  readonly open: boolean;
  readonly mode: "add" | "edit";
  /** Subtitle context (e.g., "Loadings", "Final Adjustments"). */
  readonly contextLabel?: string;
  readonly draft: FlatFactorDraft;
  readonly onDraftChange: (next: FlatFactorDraft) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly saving?: boolean;
  readonly errorMessage?: string;
  readonly testId?: string;
}

export function FlatFactorStageDrawer(
  props: FlatFactorStageDrawerProps,
): JSX.Element {
  const {
    open,
    mode,
    contextLabel,
    draft,
    onDraftChange,
    onCancel,
    onSave,
    saving = false,
    errorMessage,
    testId = "rater-flat-factor-stage-drawer",
  } = props;

  const title =
    mode === "add" ? "Add factor stage" : "Edit factor stage";
  const saveLabel = mode === "add" ? "Add stage" : "Save changes";
  const subtitle =
    contextLabel !== undefined && contextLabel !== ""
      ? contextLabel
      : undefined;

  const canSave = useMemo(
    () => isFlatFactorDraftComplete(draft) && !saving,
    [draft, saving],
  );

  const showError = errorMessage !== undefined && errorMessage !== "";

  return (
    <Drawer
      open={open}
      onClose={onCancel}
      title={title}
      {...(subtitle !== undefined ? { subtitle } : {})}
    >
      <Drawer.Body>
        <div
          className="rater-flat-factor-stage-drawer__body"
          data-testid={testId}
        >
          {/* P2 G6-full (ADR-0056) — flat_factor stages PRICE now: the
            * loading multiplies its referenced output at score time.
            * The banner flipped from "not yet priced" to what it does. */}
          <div
            className="rater-flat-factor-stage-drawer__unpriced"
            role="status"
            data-testid={`${testId}-priced`}
          >
            <TriangleAlert size={14} strokeWidth={1.8} aria-hidden />
            <span>
              <b>Prices at score time.</b> This loading multiplies the
              premium it references in the live scorer (×{" "}
              {typeof draft.factor === "number" ? draft.factor : "…"} once
              saved). Gate it with a predicate to apply conditionally.
            </span>
          </div>
          {showError && (
            <div
              className="rater-flat-factor-stage-drawer__error"
              role="alert"
              data-testid={`${testId}-error`}
            >
              {errorMessage}
            </div>
          )}

          <div className="rater-flat-factor-stage-drawer__field">
            <label
              className="rater-flat-factor-stage-drawer__label"
              htmlFor={`${testId}-display-name`}
            >
              Display name
            </label>
            <input
              id={`${testId}-display-name`}
              type="text"
              className="rater-flat-factor-stage-drawer__input"
              value={draft.display_name}
              onChange={(e) =>
                onDraftChange({ ...draft, display_name: e.target.value })
              }
              placeholder="e.g., Expense loading"
              aria-label="Display name"
            />
            <p className="rater-flat-factor-stage-drawer__hint">
              Actuary-facing label that surfaces in the trace + the
              section table.
            </p>
          </div>

          <div className="rater-flat-factor-stage-drawer__field">
            <label
              className="rater-flat-factor-stage-drawer__label"
              htmlFor={`${testId}-factor-kind`}
            >
              Factor kind
            </label>
            <input
              id={`${testId}-factor-kind`}
              type="text"
              className="rater-flat-factor-stage-drawer__input rater-flat-factor-stage-drawer__input--mono"
              value={draft.factor_kind}
              onChange={(e) =>
                onDraftChange({ ...draft, factor_kind: e.target.value })
              }
              placeholder="e.g., expense_loading"
              aria-label="Factor kind"
            />
            <p className="rater-flat-factor-stage-drawer__hint">
              Slug used for trace attribution + downstream lookups
              (snake_case, no spaces).
            </p>
          </div>

          <div className="rater-flat-factor-stage-drawer__field">
            <label
              className="rater-flat-factor-stage-drawer__label"
              htmlFor={`${testId}-factor`}
            >
              Factor
            </label>
            <input
              id={`${testId}-factor`}
              type="number"
              step="any"
              className="rater-flat-factor-stage-drawer__input"
              value={draft.factor}
              onChange={(e) => {
                const raw = e.target.value;
                onDraftChange({
                  ...draft,
                  factor: raw === "" ? "" : Number(raw),
                });
              }}
              placeholder="e.g., 1.35"
              aria-label="Factor value"
            />
            <p className="rater-flat-factor-stage-drawer__hint">
              The literal multiplier. 1.35 = +35% loading. 0.95 = −5%
              credit. 1.000 = no effect.
            </p>
          </div>

          <div className="rater-flat-factor-stage-drawer__field">
            <label
              className="rater-flat-factor-stage-drawer__label"
              htmlFor={`${testId}-citation-rule`}
            >
              Citation
            </label>
            <input
              id={`${testId}-citation-rule`}
              type="text"
              className="rater-flat-factor-stage-drawer__input"
              value={draft.citation_rule}
              onChange={(e) =>
                onDraftChange({ ...draft, citation_rule: e.target.value })
              }
              placeholder="e.g., ISO BOP §5.A.2"
              aria-label="Citation rule"
            />
            <p className="rater-flat-factor-stage-drawer__hint">
              Optional filing citation. Surfaces in the trace + audit log.
            </p>
          </div>

          <div className="rater-flat-factor-stage-drawer__field">
            <label
              className="rater-flat-factor-stage-drawer__label"
              htmlFor={`${testId}-citation-page`}
            >
              Citation page
            </label>
            <input
              id={`${testId}-citation-page`}
              type="text"
              className="rater-flat-factor-stage-drawer__input rater-flat-factor-stage-drawer__input--mono"
              value={draft.citation_page}
              onChange={(e) =>
                onDraftChange({ ...draft, citation_page: e.target.value })
              }
              placeholder="e.g., p. 31"
              aria-label="Citation page"
            />
          </div>

          {/* E6 — the predicate control the banner copy promises. */}
          <div className="rater-flat-factor-stage-drawer__field">
            <label
              className="rater-flat-factor-stage-drawer__label"
              htmlFor={`${testId}-predicate-path`}
            >
              Applies when (optional)
            </label>
            <input
              id={`${testId}-predicate-path`}
              type="text"
              className="rater-flat-factor-stage-drawer__input rater-flat-factor-stage-drawer__input--mono"
              value={draft.predicate_path}
              onChange={(e) =>
                onDraftChange({ ...draft, predicate_path: e.target.value })
              }
              placeholder="e.g., form_input.is_new_business"
              aria-label="Predicate input path"
            />
            <p className="rater-flat-factor-stage-drawer__hint">
              Input path that gates this loading. Leave blank to always
              apply.
            </p>
          </div>

          <div className="rater-flat-factor-stage-drawer__field">
            <label
              className="rater-flat-factor-stage-drawer__label"
              htmlFor={`${testId}-predicate-equals`}
            >
              …equals
            </label>
            <input
              id={`${testId}-predicate-equals`}
              type="text"
              className="rater-flat-factor-stage-drawer__input rater-flat-factor-stage-drawer__input--mono"
              value={draft.predicate_equals}
              onChange={(e) =>
                onDraftChange({ ...draft, predicate_equals: e.target.value })
              }
              placeholder="true"
              aria-label="Predicate equals value"
              disabled={draft.predicate_path.trim() === ""}
            />
            <p className="rater-flat-factor-stage-drawer__hint">
              The value that turns the loading on. Blank means{" "}
              <code>true</code>; <code>true</code>/<code>false</code> and
              numbers are matched by type.
            </p>
          </div>

          <div className="rater-flat-factor-stage-drawer__field">
            <label
              className="rater-flat-factor-stage-drawer__label"
              htmlFor={`${testId}-description-template`}
            >
              Description template
            </label>
            <input
              id={`${testId}-description-template`}
              type="text"
              className="rater-flat-factor-stage-drawer__input rater-flat-factor-stage-drawer__input--mono"
              value={draft.description_template}
              onChange={(e) =>
                onDraftChange({
                  ...draft,
                  description_template: e.target.value,
                })
              }
              placeholder="{factor_kind}: ×{value}"
              aria-label="Description template"
            />
            <p className="rater-flat-factor-stage-drawer__hint">
              Optional trace template. Defaults to{" "}
              <code>{"{factor_kind}: ×{value}"}</code> when left blank.
            </p>
          </div>
        </div>
      </Drawer.Body>
      <Drawer.Footer>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onSave}
          disabled={!canSave}
          loading={saving}
        >
          {saveLabel}
        </Button>
      </Drawer.Footer>
    </Drawer>
  );
}
