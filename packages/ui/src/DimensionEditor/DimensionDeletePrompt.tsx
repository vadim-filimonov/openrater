/**
 * <DimensionDeletePrompt> — delete confirmation modal (Frame 10).
 *
 * Brief 30 §7 / §−1 Q6 — "show impact, allow with explicit
 * confirmation." Two variants based on the dim's reference count:
 *
 *   0 refs → simple "Delete this dim?" with [Cancel] [Delete].
 *            One-click confirmation; the dim has no consumers, so
 *            there's nothing to warn about.
 *
 *   1+ refs → full impact preview. Lists each reference as a
 *             click-to-jump row + a warning chip explaining that
 *             the references will be broken. The user can:
 *               · Click Cancel
 *               · Click a reference row → navigate away to fix it
 *                 (the modal stays open until the user returns)
 *               · Click "Delete dimension" (danger button) → the
 *                 dim is removed; consumers get orphaned.
 *
 * Per Q6 lock: Delete stays ENABLED even with N refs (the user is
 * empowered to proceed once informed). Matches GitHub's repo-delete
 * pattern: aware-then-confirm, not blocked-until-fixed.
 *
 * Pure presentation. Parent owns the open state + the actual
 * mutation that runs on confirm.
 */

import type { JSX, ReactNode } from "react";
import { GitBranch, Sparkles, Table2, TriangleAlert } from "lucide-react";
import { Button, Modal } from "@openrater/design-system";
import type { DimensionRow } from "../DimensionsTable";
import type { DimensionReference } from "./UsedInPanel";
import "./DimensionDeletePrompt.css";

export interface DimensionDeletePromptProps {
  /**
   * Controls visibility. When `false` the modal is unmounted — pass
   * `null` when no dim is targeted to keep the JSX clean.
   */
  readonly open: boolean;
  /** The dim being deleted. Drives the title + body copy. */
  readonly dim: DimensionRow | null;
  /**
   * Downstream references to this dim. The route computes via
   * `findDimensionReferences()` from @openrater/contracts (PR 30.4).
   * Empty array → simple confirm. Non-empty → impact preview.
   */
  readonly references: readonly DimensionReference[];
  /** Confirm-and-delete handler. Called when the danger button is clicked. */
  readonly onConfirm: () => void;
  /** Cancel / backdrop / Escape handler. Called when the user backs out. */
  readonly onCancel: () => void;
  /**
   * Optional jump handler — called when the user clicks a reference
   * row. When omitted, rows render but are not clickable (mostly
   * for testing). The route provides the same handler the
   * <UsedInPanel> uses.
   */
  readonly onJumpToReference?: (ref: DimensionReference) => void;
  readonly testId?: string;
}

export function DimensionDeletePrompt(
  props: DimensionDeletePromptProps,
): JSX.Element | null {
  const {
    open,
    dim,
    references,
    onConfirm,
    onCancel,
    onJumpToReference,
    testId = "rater-dim-delete-prompt",
  } = props;

  if (!open || dim === null) return null;

  const refCount = references.length;
  const isImpactful = refCount > 0;
  const displayLabel = dim.display_name || dim.slug || dim.id;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Delete "${displayLabel}"?`}
      {...(isImpactful
        ? {
            subtitle: `${refCount} reference${refCount === 1 ? "" : "s"} will break.`,
          }
        : {})}
      size={isImpactful ? "lg" : "sm"}
    >
      <div
        className="rater-dim-delete-prompt"
        data-testid={testId}
        data-variant={isImpactful ? "impact" : "simple"}
      >
        {isImpactful ? (
          <>
            <p className="rater-dim-delete-prompt__intro">
              This will remove <strong>{displayLabel}</strong> from the plan.
              The references below will become orphans — you can fix them
              before deleting (jump-to-each) or proceed and fix them after.
            </p>
            <div
              className="rater-dim-delete-prompt__warning"
              role="alert"
              data-testid={`${testId}-warning`}
            >
              <span
                className="rater-dim-delete-prompt__warning-icon"
                aria-hidden
              >
                <TriangleAlert size={16} />
              </span>
              <span>
                Each reference will become an orphan. Delete is irreversible
                in fixture mode (API Lab slice 4 will add undo).
              </span>
            </div>
            <ul
              className="rater-dim-delete-prompt__refs"
              data-testid={`${testId}-refs`}
            >
              {references.map((ref) => (
                <li key={`${ref.kind}-${ref.id}`}>
                  <button
                    type="button"
                    className={`rater-dim-delete-prompt__ref rater-dim-delete-prompt__ref--${ref.kind}`}
                    onClick={() => onJumpToReference?.(ref)}
                    disabled={onJumpToReference === undefined}
                    data-testid={`${testId}-ref-${ref.kind}-${ref.id}`}
                    aria-label={`Jump to ${ref.label}`}
                  >
                    <span
                      className={`rater-dim-delete-prompt__ref-icon rater-dim-delete-prompt__ref-icon--${ref.kind}`}
                      aria-hidden
                    >
                      {iconFor(ref.kind)}
                    </span>
                    <span className="rater-dim-delete-prompt__ref-label">
                      <code>{ref.label}</code>
                    </span>
                    <span className="rater-dim-delete-prompt__ref-context">
                      {ref.context}
                    </span>
                    <span
                      className="rater-dim-delete-prompt__ref-jump"
                      aria-hidden
                    >
                      ↗ jump
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="rater-dim-delete-prompt__intro">
            This dimension has no consumers. Removing it from the plan is
            safe — no factor tables, chains, or curves reference it.
          </p>
        )}
        <div className="rater-dim-delete-prompt__actions">
          <Button
            variant="ghost"
            size="md"
            onClick={onCancel}
            data-testid={`${testId}-cancel`}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={onConfirm}
            data-testid={`${testId}-confirm`}
          >
            {isImpactful ? "Delete dimension" : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function iconFor(kind: DimensionReference["kind"]): ReactNode {
  switch (kind) {
    case "chain":
      return <GitBranch size={12} />;
    case "factor-table":
      return <Table2 size={12} />;
    case "modifier":
      return <Sparkles size={12} />;
    case "curve":
      return <Sparkles size={12} />;
  }
}
