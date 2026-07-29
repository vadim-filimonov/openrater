/**
 * <RoundStageDrawer> — drawer surface for adding/editing a `round` stage.
 *
 * Round stages snap the final premium to a filed increment (usually $1
 * for most BOP plans; $0.01 for some commercial; $5/$10 for some
 * specialty) and optionally floor it at a minimum premium first —
 * max(total, floor) → round. This floor IS the plan's minimum premium:
 * the build-up sheet's "+ Minimum premium" affordance lands here
 * (v4 G6 — the old `clamp` path was never executed by the live scorer).
 *
 * Substrate config (RoundConfig in api-lab/.../configs.py):
 *   · input_path           — predecessor stage output (supplied by route)
 *   · increment_input      — literal amount ("literal:1" or "1")
 *   · min_value_input      — literal amount ("literal:500" or "500");
 *                            empty = no floor
 *   · output_field         — `total_premium` (Brief 80 D-D: the ledger
 *                            contract; the route writes it on add and
 *                            offers a one-click normalize for legacy
 *                            stages publishing a bespoke field)
 *
 * The substrate also accepts form-input PATHS ("form_input.min_premium")
 * for per-submission values, but the live scorer doesn't resolve them
 * yet — it prices literals only. The drawer says so; defaults are
 * literals so what the actuary saves is what the scorer executes.
 */

import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Drawer } from "@openrater/design-system";
import "./RoundStageDrawer.css";

/**
 * Brief 80 D-D — the field every composition consumer (the run
 * ledger, the policy roll-up, the quote API) reads the plan total
 * from. Mirrors `TOTAL_TOWER_OUTPUT_FIELD`; declared locally so the
 * drawer stays a leaf module.
 */
export const ROUND_STANDARD_OUTPUT_FIELD = "total_premium";

export interface RoundDraft {
  readonly display_name: string;
  readonly increment_input: string;
  readonly min_value_input: string;
  readonly citation_rule: string;
  readonly citation_page: string;
}

export function emptyRoundDraft(): RoundDraft {
  return {
    display_name: "",
    // Literals — the live scorer prices these as-is. (The old
    // form_input.* defaults parsed to "no increment / no floor" and
    // scored as if the stage weren't there.)
    increment_input: "literal:1",
    min_value_input: "",
    citation_rule: "",
    citation_page: "",
  };
}

export function isRoundDraftComplete(draft: RoundDraft): boolean {
  if (draft.display_name.trim() === "") return false;
  if (draft.increment_input.trim() === "") return false;
  // min_value_input may be empty — a round stage without a floor is
  // legitimate (it just rounds).
  return true;
}

export interface RoundStageDrawerProps {
  readonly open: boolean;
  readonly mode: "add" | "edit";
  readonly contextLabel?: string;
  readonly draft: RoundDraft;
  readonly onDraftChange: (next: RoundDraft) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly saving?: boolean;
  readonly errorMessage?: string;
  /**
   * Brief 80 D-D — the stage's CURRENT persisted `output_field` (edit
   * mode). When it differs from the `total_premium` contract the
   * drawer shows the nonstandard warning + the one-click normalize.
   * Absent / equal to the contract ⇒ just the static contract line.
   */
  readonly outputField?: string;
  /** One-click "Use the standard total field" (a config patch owned
   *  by the route). Only rendered when `outputField` is nonstandard. */
  readonly onNormalizeOutputField?: () => void;
  readonly testId?: string;
}

export function RoundStageDrawer(props: RoundStageDrawerProps): JSX.Element {
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
    outputField,
    onNormalizeOutputField,
    testId = "rater-round-stage-drawer",
  } = props;

  // Brief 80 D-D — a persisted bespoke total field breaks the ledger,
  // the roll-up, and the quote composition. Named + one-click fixable.
  const outputNonstandard =
    typeof outputField === "string" &&
    outputField.trim() !== "" &&
    outputField.trim() !== ROUND_STANDARD_OUTPUT_FIELD;

  const title = mode === "add" ? "Add round stage" : "Edit round stage";
  const saveLabel = mode === "add" ? "Add stage" : "Save changes";
  const subtitle =
    contextLabel !== undefined && contextLabel !== "" ? contextLabel : undefined;

  const canSave = useMemo(
    () => isRoundDraftComplete(draft) && !saving,
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
        <div className="rater-round-stage-drawer__body" data-testid={testId}>
          {showError && (
            <div
              className="rater-round-stage-drawer__error"
              role="alert"
              data-testid={`${testId}-error`}
            >
              {errorMessage}
            </div>
          )}

          {/* Brief 80 D-D — the total-field contract, stated plainly. */}
          {outputNonstandard ? (
            <div
              className="rater-round-stage-drawer__contract rater-round-stage-drawer__contract--warn"
              role="status"
              data-testid={`${testId}-output-nonstandard`}
            >
              <TriangleAlert size={14} strokeWidth={1.8} aria-hidden />
              <span>
                This stage publishes the total as{" "}
                <code>{outputField?.trim()}</code> — the policy ledger and
                the API read <code>{ROUND_STANDARD_OUTPUT_FIELD}</code>, so
                composed premiums will come back empty.
              </span>
              {onNormalizeOutputField ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={onNormalizeOutputField}
                  disabled={saving}
                  data-testid={`${testId}-normalize-output`}
                >
                  Use standard
                </Button>
              ) : null}
            </div>
          ) : (
            <p
              className="rater-round-stage-drawer__contract"
              data-testid={`${testId}-output-standard`}
            >
              Publishes the plan total as{" "}
              <code>{ROUND_STANDARD_OUTPUT_FIELD}</code> — the field the
              policy ledger and the quote API read.
            </p>
          )}

          <div className="rater-round-stage-drawer__field">
            <label
              className="rater-round-stage-drawer__label"
              htmlFor={`${testId}-display-name`}
            >
              Display name
            </label>
            <input
              id={`${testId}-display-name`}
              type="text"
              className="rater-round-stage-drawer__input"
              value={draft.display_name}
              onChange={(e) =>
                onDraftChange({ ...draft, display_name: e.target.value })
              }
              placeholder="e.g., Round to nearest dollar"
              aria-label="Display name"
            />
            <p className="rater-round-stage-drawer__hint">
              Actuary-facing label for the trace.
            </p>
          </div>

          <div className="rater-round-stage-drawer__field">
            <label
              className="rater-round-stage-drawer__label"
              htmlFor={`${testId}-increment-input`}
            >
              Rounding increment
            </label>
            <input
              id={`${testId}-increment-input`}
              type="text"
              className="rater-round-stage-drawer__input rater-round-stage-drawer__input--mono"
              value={draft.increment_input}
              onChange={(e) =>
                onDraftChange({ ...draft, increment_input: e.target.value })
              }
              placeholder="literal:1"
              aria-label="Rounding increment"
            />
            <p className="rater-round-stage-drawer__hint">
              Dollar increment the premium rounds to — enter an amount
              (<code>1</code>, <code>0.01</code>, <code>5</code>) or{" "}
              <code>literal:1</code>. Form-input paths
              (<code>form_input.…</code>) aren&apos;t priced by the live
              scorer yet.
            </p>
          </div>

          <div className="rater-round-stage-drawer__field">
            <label
              className="rater-round-stage-drawer__label"
              htmlFor={`${testId}-min-value-input`}
            >
              Minimum premium (floor)
            </label>
            <input
              id={`${testId}-min-value-input`}
              type="text"
              className="rater-round-stage-drawer__input rater-round-stage-drawer__input--mono"
              value={draft.min_value_input}
              onChange={(e) =>
                onDraftChange({ ...draft, min_value_input: e.target.value })
              }
              placeholder="literal:500"
              aria-label="Minimum premium floor"
            />
            <p className="rater-round-stage-drawer__hint">
              The scored premium never drops below this — enter an amount
              (<code>500</code>) or <code>literal:500</code>; leave empty
              for no floor. Form-input paths aren&apos;t priced by the
              live scorer yet.
            </p>
          </div>

          <div className="rater-round-stage-drawer__field">
            <label
              className="rater-round-stage-drawer__label"
              htmlFor={`${testId}-citation-rule`}
            >
              Citation
            </label>
            <input
              id={`${testId}-citation-rule`}
              type="text"
              className="rater-round-stage-drawer__input"
              value={draft.citation_rule}
              onChange={(e) =>
                onDraftChange({ ...draft, citation_rule: e.target.value })
              }
              placeholder="e.g., ISO BOP §6.B.1"
              aria-label="Citation rule"
            />
          </div>

          <div className="rater-round-stage-drawer__field">
            <label
              className="rater-round-stage-drawer__label"
              htmlFor={`${testId}-citation-page`}
            >
              Citation page
            </label>
            <input
              id={`${testId}-citation-page`}
              type="text"
              className="rater-round-stage-drawer__input rater-round-stage-drawer__input--mono"
              value={draft.citation_page}
              onChange={(e) =>
                onDraftChange({ ...draft, citation_page: e.target.value })
              }
              placeholder="e.g., p. 48"
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
