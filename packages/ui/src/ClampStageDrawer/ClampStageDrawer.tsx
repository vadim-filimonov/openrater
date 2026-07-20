/**
 * <ClampStageDrawer> — drawer surface for adding/editing a `clamp` stage.
 *
 * Clamp stages enforce minimum/maximum premium bounds at the
 * post-loading polish step. Per Brief 10 (Loadings + Final Adj):
 * typical Clamp usage in BOP is minimum-premium ($500 floor).
 * Max premium + max-pct-of-input are advanced — supported by the
 * substrate but rarely authored in BOP plans.
 *
 * ⚠ v4 G6 — the runtime projector does NOT execute `clamp` stages:
 * saved bounds never change the scored premium. The drawer renders a
 * permanent "Not yet priced" notice, and it is EDIT-ONLY now — no
 * live affordance creates a clamp (the minimum-premium affordance
 * authors the round stage's floor instead). Remove the notice only
 * when the projector executes the kind.
 *
 * Pure presentation. Parent owns:
 *   · the `open` flag + `draft` state
 *   · the Save semantics (HTTP, optimistic cache update)
 *
 * Save is gated by `isClampDraftComplete(draft)`; requires
 * display_name + at least one of (min_value / max_value /
 * max_pct_of_input).
 *
 * Mirror of M4.12 FlatFactorStageDrawer's structure.
 *
 * ## Form shape (mirror of @openrater/contracts ClampConfig)
 *
 *   display_name        — required
 *   min_value           — optional, numeric (e.g., 500)
 *   max_value           — optional, numeric (e.g., 50_000)
 *   max_pct_of_input    — optional, formula string (e.g., "input * 0.10")
 *   apply_as_multiplier — bool (default false; clamp absolute vs multiplicative)
 *   citation_rule       — optional
 *   citation_page       — optional
 *
 * The substrate's input_path is supplied by the route (= predecessor
 * stage's output_field).
 */

import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Checkbox, Drawer } from "@openrater/design-system";
import "./ClampStageDrawer.css";

export interface ClampDraft {
  readonly display_name: string;
  readonly min_value: number | "";
  readonly max_value: number | "";
  readonly max_pct_of_input: string;
  readonly apply_as_multiplier: boolean;
  readonly citation_rule: string;
  readonly citation_page: string;
}

export function emptyClampDraft(): ClampDraft {
  return {
    display_name: "",
    min_value: "",
    max_value: "",
    max_pct_of_input: "",
    apply_as_multiplier: false,
    citation_rule: "",
    citation_page: "",
  };
}

export function isClampDraftComplete(draft: ClampDraft): boolean {
  if (draft.display_name.trim() === "") return false;
  const hasMin =
    typeof draft.min_value === "number" && Number.isFinite(draft.min_value);
  const hasMax =
    typeof draft.max_value === "number" && Number.isFinite(draft.max_value);
  const hasPct = draft.max_pct_of_input.trim() !== "";
  // Substrate requires at least one of the three bounds set.
  return hasMin || hasMax || hasPct;
}

export interface ClampStageDrawerProps {
  readonly open: boolean;
  readonly mode: "add" | "edit";
  readonly contextLabel?: string;
  readonly draft: ClampDraft;
  readonly onDraftChange: (next: ClampDraft) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly saving?: boolean;
  readonly errorMessage?: string;
  readonly testId?: string;
}

export function ClampStageDrawer(props: ClampStageDrawerProps): JSX.Element {
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
    testId = "rater-clamp-stage-drawer",
  } = props;

  // PR-D — "clamp stage" is the internal stage_kind; users see "premium limit".
  const title = mode === "add" ? "Add premium limit" : "Edit premium limit";
  const saveLabel = mode === "add" ? "Add limit" : "Save changes";
  const subtitle =
    contextLabel !== undefined && contextLabel !== "" ? contextLabel : undefined;

  const canSave = useMemo(
    () => isClampDraftComplete(draft) && !saving,
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
        <div className="rater-clamp-stage-drawer__body" data-testid={testId}>
          {/* P2 G6-full (ADR-0056) — clamp stages PRICE now: the saved
            * min/max applies to the referenced output at score time.
            * The banner flipped from "not yet priced" to what it does. */}
          <div
            className="rater-clamp-stage-drawer__unpriced"
            role="status"
            data-testid={`${testId}-priced`}
          >
            <TriangleAlert size={14} strokeWidth={1.8} aria-hidden />
            <span>
              <b>Prices at score time.</b> These limits floor/cap the
              referenced premium in the live scorer. For the plan-wide
              minimum premium, prefer <b>Minimum premium</b> in the
              build-up sheet&apos;s Final adjustments (the round
              step&apos;s floor).
            </span>
          </div>
          {showError && (
            <div
              className="rater-clamp-stage-drawer__error"
              role="alert"
              data-testid={`${testId}-error`}
            >
              {errorMessage}
            </div>
          )}

          <div className="rater-clamp-stage-drawer__field">
            <label
              className="rater-clamp-stage-drawer__label"
              htmlFor={`${testId}-display-name`}
            >
              Display name
            </label>
            <input
              id={`${testId}-display-name`}
              type="text"
              className="rater-clamp-stage-drawer__input"
              value={draft.display_name}
              onChange={(e) =>
                onDraftChange({ ...draft, display_name: e.target.value })
              }
              placeholder="e.g., Minimum premium"
              aria-label="Display name"
            />
            <p className="rater-clamp-stage-drawer__hint">
              Actuary-facing label that surfaces in the trace.
            </p>
          </div>

          <div className="rater-clamp-stage-drawer__bounds">
            <div className="rater-clamp-stage-drawer__field">
              <label
                className="rater-clamp-stage-drawer__label"
                htmlFor={`${testId}-min-value`}
              >
                Minimum
              </label>
              <input
                id={`${testId}-min-value`}
                type="number"
                step="any"
                className="rater-clamp-stage-drawer__input"
                value={draft.min_value}
                onChange={(e) => {
                  const raw = e.target.value;
                  onDraftChange({
                    ...draft,
                    min_value: raw === "" ? "" : Number(raw),
                  });
                }}
                placeholder="e.g., 500"
                aria-label="Minimum value"
              />
              <p className="rater-clamp-stage-drawer__hint">
                Floor — never go below.
              </p>
            </div>

            <div className="rater-clamp-stage-drawer__field">
              <label
                className="rater-clamp-stage-drawer__label"
                htmlFor={`${testId}-max-value`}
              >
                Maximum
              </label>
              <input
                id={`${testId}-max-value`}
                type="number"
                step="any"
                className="rater-clamp-stage-drawer__input"
                value={draft.max_value}
                onChange={(e) => {
                  const raw = e.target.value;
                  onDraftChange({
                    ...draft,
                    max_value: raw === "" ? "" : Number(raw),
                  });
                }}
                placeholder="leave blank for no cap"
                aria-label="Maximum value"
              />
              <p className="rater-clamp-stage-drawer__hint">
                Cap — never go above.
              </p>
            </div>
          </div>

          <div className="rater-clamp-stage-drawer__field">
            <label
              className="rater-clamp-stage-drawer__label"
              htmlFor={`${testId}-max-pct`}
            >
              Max pct of input (advanced)
            </label>
            <input
              id={`${testId}-max-pct`}
              type="text"
              className="rater-clamp-stage-drawer__input rater-clamp-stage-drawer__input--mono"
              value={draft.max_pct_of_input}
              onChange={(e) =>
                onDraftChange({ ...draft, max_pct_of_input: e.target.value })
              }
              placeholder='e.g., "input * 0.10"'
              aria-label="Max percent of input"
            />
            <p className="rater-clamp-stage-drawer__hint">
              Formula string. Rarely used in BOP. Leave blank for
              fixed-value bounds above.
            </p>
          </div>

          <div className="rater-clamp-stage-drawer__field rater-clamp-stage-drawer__field--checkbox">
            <Checkbox
              className="rater-clamp-stage-drawer__checkbox-row"
              id={`${testId}-apply-multiplier`}
              checked={draft.apply_as_multiplier}
              onChange={(next) =>
                onDraftChange({
                  ...draft,
                  apply_as_multiplier: next,
                })
              }
              label="Apply as multiplier"
            />
            <p className="rater-clamp-stage-drawer__hint">
              When on, the limit adjusts the running subtotal as a
              factor (rare). Default off — an absolute floor / cap.
            </p>
          </div>

          <div className="rater-clamp-stage-drawer__field">
            <label
              className="rater-clamp-stage-drawer__label"
              htmlFor={`${testId}-citation-rule`}
            >
              Citation
            </label>
            <input
              id={`${testId}-citation-rule`}
              type="text"
              className="rater-clamp-stage-drawer__input"
              value={draft.citation_rule}
              onChange={(e) =>
                onDraftChange({ ...draft, citation_rule: e.target.value })
              }
              placeholder="e.g., Meridian BOP §6.A.1"
              aria-label="Citation rule"
            />
          </div>

          <div className="rater-clamp-stage-drawer__field">
            <label
              className="rater-clamp-stage-drawer__label"
              htmlFor={`${testId}-citation-page`}
            >
              Citation page
            </label>
            <input
              id={`${testId}-citation-page`}
              type="text"
              className="rater-clamp-stage-drawer__input rater-clamp-stage-drawer__input--mono"
              value={draft.citation_page}
              onChange={(e) =>
                onDraftChange({ ...draft, citation_page: e.target.value })
              }
              placeholder="e.g., p. 47"
              aria-label="Citation page"
            />
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
