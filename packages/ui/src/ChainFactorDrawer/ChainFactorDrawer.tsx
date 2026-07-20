/**
 * <ChainFactorDrawer> — drawer surface for adding / editing a chain factor.
 *
 * Composes the M4.3.3–6 <FactorEditor> + design-system <Drawer> into the
 * canonical "Add chain factor" / "Edit chain factor" affordance off
 * <RatingChainCard>.
 *
 * Pure presentation. Parent owns:
 *   · the `open` flag + `draft` state
 *   · the Save semantics (HTTP, optimistic cache update, etc.)
 *
 * Save is gated by `isFactorDraftComplete(draft)`; the Save button stays
 * disabled until every required field for the selected kind is filled.
 * On click, this primitive fires `onSave()` — the parent already holds
 * the draft and decides how to persist it.
 *
 * ## Why a composite primitive?
 *
 * Every section editor eventually follows the same shape: Drawer shell
 * with title + subtitle, per-section form in the body, Cancel + Save
 * buttons in the footer. Bundling that shape for chain factors lets
 * the route wiring (M4.3.8+) compose against one prop surface instead
 * of restating the same wiring five primitives deep at every entry
 * point. Trade-off — less footer flexibility — is fine here: the
 * chain-factor editor footer is uniform across all entry points.
 *
 * ## Affordances honored
 *
 *   · Backdrop click / Escape / Close (×) → onCancel
 *   · Cancel button                       → onCancel
 *   · Save button (enabled when complete) → onSave
 *   · `saving` prop                       → button loading + disabled-Cancel
 *   · `errorMessage` prop                 → inline banner above the form
 *
 * Tokens consumed (CSS file): only --rater-feedback-error,
 * --rater-feedback-error-bg, --rater-r-6, --rater-s-* — no new tokens.
 */

import { useMemo } from "react";
import { Button, Drawer } from "@openrater/design-system";
import {
  FactorEditor,
  isFactorDraftComplete,
  type FactorDraft,
} from "../FactorEditor";
import type { ClassPickerOption } from "../ClassPicker";
import type { DimensionRefOption } from "../DimensionRefPicker";
import type { FactorTableRefOption } from "../FactorTableRefPicker";
import type { EntityRefPickerEmptyAction } from "../EntityRefPicker";
import "./ChainFactorDrawer.css";

export interface ChainFactorDrawerProps {
  /** Drawer visibility. */
  readonly open: boolean;
  /** Drives the title + Save button label. */
  readonly mode: "add" | "edit";
  /**
   * Optional context for the subtitle (e.g., the chain's display
   * name). Renders as "Chain: {name}" under the title.
   */
  readonly chainName?: string;

  /** Current draft state — owned by the parent. */
  readonly draft: FactorDraft;
  /** Fired on every keystroke / picker change inside the editor. */
  readonly onDraftChange: (next: FactorDraft) => void;

  /** Fired on Cancel button click / backdrop click / Escape. */
  readonly onCancel: () => void;
  /**
   * Fired when Save is clicked. Only callable when the draft is
   * complete (the button is disabled otherwise).
   */
  readonly onSave: () => void;

  /** Busy state for the Save button while a parent mutation is in flight. */
  readonly saving?: boolean;
  /** Inline error banner above the form (e.g., from a failed Save). */
  readonly errorMessage?: string;

  /** Class library for the lookup.classification picker. */
  readonly classes?: readonly ClassPickerOption[];
  /** Dimensions for the lookup.direct picker. */
  readonly dimensions?: readonly DimensionRefOption[];
  /** Factor tables for the lookup.direct picker. */
  readonly factorTables?: readonly FactorTableRefOption[];

  readonly classPickerEmptyAction?: EntityRefPickerEmptyAction;
  readonly dimensionPickerEmptyAction?: EntityRefPickerEmptyAction;
  readonly factorTablePickerEmptyAction?: EntityRefPickerEmptyAction;

  /**
   * Disable the factor-kind dropdown. Edit mode (M4.3.9) sets this
   * so the actuary can't accidentally wipe an existing factor's
   * fields by flipping kinds; if they want a different kind, they
   * delete-and-re-add. Defaults to `mode === "edit"`.
   */
  readonly kindLocked?: boolean;

  readonly testId?: string;
}

export function ChainFactorDrawer(props: ChainFactorDrawerProps): JSX.Element {
  const {
    open,
    mode,
    chainName,
    draft,
    onDraftChange,
    onCancel,
    onSave,
    saving = false,
    errorMessage,
    classes,
    dimensions,
    factorTables,
    classPickerEmptyAction,
    dimensionPickerEmptyAction,
    factorTablePickerEmptyAction,
    kindLocked = mode === "edit",
    testId = "rater-chain-factor-drawer",
  } = props;

  const title = mode === "add" ? "Add chain factor" : "Edit chain factor";
  const saveLabel = mode === "add" ? "Add factor" : "Save changes";
  const subtitle =
    chainName !== undefined && chainName !== ""
      ? `Chain: ${chainName}`
      : undefined;

  const canSave = useMemo(
    () => isFactorDraftComplete(draft) && !saving,
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
        <div className="rater-chain-factor-drawer__body" data-testid={testId}>
          {showError && (
            <div
              className="rater-chain-factor-drawer__error"
              role="alert"
              data-testid={`${testId}-error`}
            >
              {errorMessage}
            </div>
          )}
          <FactorEditor
            value={draft}
            onChange={onDraftChange}
            kindLocked={kindLocked}
            {...(classes !== undefined ? { classes } : {})}
            {...(dimensions !== undefined ? { dimensions } : {})}
            {...(factorTables !== undefined ? { factorTables } : {})}
            {...(classPickerEmptyAction !== undefined
              ? { classPickerEmptyAction }
              : {})}
            {...(dimensionPickerEmptyAction !== undefined
              ? { dimensionPickerEmptyAction }
              : {})}
            {...(factorTablePickerEmptyAction !== undefined
              ? { factorTablePickerEmptyAction }
              : {})}
          />
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
