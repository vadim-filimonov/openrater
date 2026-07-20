/**
 * <PlanDeleteDialog> — confirmation modal for the two-stage plan
 * delete flow (K1.4).
 *
 * The plan lifecycle has two delete states with very different
 * consequences:
 *
 *   mode="discard"  — soft delete. Draft → archived. Reversible via
 *                     rollback. Tone is "warning, not danger": the
 *                     plan still exists and you can bring it back.
 *
 *   mode="delete"   — hard delete. Archived → gone. Cascades through
 *                     dimensions, factor tables (+ cells), stages,
 *                     input mappings, snapshots. Audit-log rows
 *                     survive as a compliance soft reference but
 *                     the editable plan is permanently removed. Tone
 *                     is danger.
 *
 * Apple-grade confirmation discipline:
 *   - Cancel is the default action (autofocus, first in tab order)
 *     so accidental Enter-presses don't destroy work.
 *   - Confirm button uses `variant="danger"` so the destructive
 *     intent reads at a glance.
 *   - The plan's display name is echoed in the title — the user is
 *     confirming THIS plan, not "a plan."
 *   - An impact summary lists what disappears, so the user is
 *     informed before they're empowered (GitHub repo-delete pattern).
 *
 * Pure presentation. Parent owns the open state, the loading state
 * (pass `pending`), and the actual mutation that runs on confirm.
 */

import { useEffect, useRef, type JSX } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { Button, Modal } from "@openrater/design-system";
import "./PlanDeleteDialog.css";

export type PlanDeleteMode = "discard" | "delete";

export interface PlanDeleteDialogProps {
  /** Visibility. The modal is unmounted when false. */
  readonly open: boolean;
  /**
   * Which stage of the two-stage flow this dialog represents. Drives
   * title, body copy, button label, button tone, and impact phrasing.
   */
  readonly mode: PlanDeleteMode;
  /**
   * Plan being acted on. `null` short-circuits the render to null —
   * lets consumers keep their JSX clean while the modal is mounted
   * but no plan is targeted yet.
   */
  readonly plan: PlanDeleteTarget | null;
  /**
   * Optional summary of what gets removed when the user confirms.
   * Rendered as a bulleted list under the body copy. Skip lines that
   * are zero (don't show "0 stages will be removed" — it's noise).
   * The consumer counts from PlanDetail.stages.length, etc.
   */
  readonly impact?: PlanDeleteImpact;
  /** Confirm-and-act handler. */
  readonly onConfirm: () => void;
  /** Cancel / Escape / backdrop handler. */
  readonly onCancel: () => void;
  /**
   * When true, the confirm button shows a pending state + becomes
   * un-clickable. Cancel stays clickable so the user can back out
   * of a slow request. The consumer flips this on the mutation's
   * `isPending` flag.
   */
  readonly pending?: boolean;
  /**
   * When set, an inline error row renders just above the actions and
   * the dialog STAYS OPEN so the user can read it and retry. The
   * consumer feeds this from the mutation's `onError`.
   *
   * Apple-grade discipline: a destructive action that fails must never
   * fail silently. Without this, a backend hiccup looks like "I clicked
   * and nothing happened." The dialog already stays open on failure
   * (the success path is what closes it); this gives that open state a
   * voice.
   */
  readonly error?: string | null;
  /**
   * Brief 84 D-E — the plan is LIVE (a published version serves the
   * quote API). Archiving it turns the API off in the same transaction;
   * the confirm must NAME that consequence, never bury it.
   */
  readonly isLive?: boolean | undefined;
  /**
   * The live version's display name ("v3"). When known, the D-E line
   * names WHICH version stops serving — the consequence is concrete.
   * Null/omitted falls back to the unnamed phrasing.
   */
  readonly publishedVersionName?: string | null | undefined;
  /** How many integrations serve this plan live (sharpens the D-E line). */
  readonly liveIntegrationCount?: number | undefined;
  readonly testId?: string;
}

/** Minimal plan shape this dialog needs — independent of @openrater/api-client. */
export interface PlanDeleteTarget {
  readonly rating_plan_id: string;
  readonly display_name: string;
  /** Required for the discard-vs-delete copy to read accurately. */
  readonly status: string;
}

/**
 * Counts of child entities that disappear when the user confirms.
 * Each line renders only if its value is > 0. The consumer doesn't
 * need to filter — pass whatever it has and the dialog displays
 * just the non-zero lines.
 */
export interface PlanDeleteImpact {
  readonly stages?: number;
  readonly dimensions?: number;
  readonly factorTables?: number;
  readonly inputMappings?: number;
  readonly snapshots?: number;
}

export function PlanDeleteDialog(
  props: PlanDeleteDialogProps,
): JSX.Element | null {
  const {
    open,
    mode,
    plan,
    impact,
    onConfirm,
    onCancel,
    pending = false,
    error = null,
    isLive = false,
    publishedVersionName = null,
    liveIntegrationCount = 0,
    testId = "rater-plan-delete-dialog",
  } = props;

  const cancelRef = useRef<HTMLButtonElement>(null);

  // Autofocus Cancel each time the dialog opens — the safe default
  // so a stray Enter press doesn't destroy work. The Modal primitive
  // owns Escape + backdrop dismissal; we just steer initial focus.
  useEffect(() => {
    if (open && cancelRef.current !== null) {
      cancelRef.current.focus();
    }
  }, [open]);

  if (!open || plan === null) return null;

  const copy = COPY[mode];
  // Brief 84 D-E — archiving a LIVE plan turns its API off; that
  // consequence leads the impact list, above the child-entity counts.
  const liveLines =
    mode === "discard" && isLive
      ? [
          // Name the version when we know it — "live (v3)" makes the
          // turn-off concrete. Unnamed phrasing is the fallback only.
          publishedVersionName
            ? `This plan is live (${publishedVersionName}) — archiving turns its quote API off and callers stop getting quotes immediately`
            : "The quote API turns off — callers stop getting quotes immediately",
          ...(liveIntegrationCount > 0
            ? [
                `${liveIntegrationCount} connected app${
                  liveIntegrationCount === 1 ? "" : "s"
                } stop${liveIntegrationCount === 1 ? "s" : ""} receiving quotes from this plan`,
              ]
            : []),
        ]
      : [];
  const impactLines = [...liveLines, ...renderImpactLines(impact, mode)];

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={copy.title(plan.display_name)}
      subtitle={copy.subtitle}
      size="sm"
    >
      {/* Body + footer use the Modal primitive's documented slot model
       * (<Modal.Body> / <Modal.Footer>) so the content inherits the
       * canonical 20/24 body padding + the bordered, right-aligned
       * footer. Passing raw children to <Modal> bypasses both and the
       * text/buttons end up flush against the panel border. */}
      <Modal.Body>
        <div
          className="rater-plan-delete-dialog"
          data-testid={testId}
          data-mode={mode}
        >
          <p className="rater-plan-delete-dialog__intro">{copy.body}</p>

          {impactLines.length > 0 && (
            <div
              className="rater-plan-delete-dialog__impact"
              data-testid={`${testId}-impact`}
            >
              <span className="rater-plan-delete-dialog__impact-icon" aria-hidden>
                <TriangleAlert size={14} />
              </span>
              <ul className="rater-plan-delete-dialog__impact-list">
                {impactLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {error ? (
            <div
              className="rater-plan-delete-dialog__error"
              role="alert"
              data-testid={`${testId}-error`}
            >
              <span className="rater-plan-delete-dialog__error-icon" aria-hidden>
                <CircleAlert size={14} />
              </span>
              <span>{error}</span>
            </div>
          ) : null}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button
          ref={cancelRef}
          variant="primary"
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
          disabled={pending}
          data-testid={`${testId}-confirm`}
        >
          {pending ? copy.confirmPending : copy.confirm}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Mode-specific copy. Centralized so the wording stays consistent across
// any future delete surfaces (a discard menu inside the editor, a bulk-
// archive action, etc.) — they import COPY rather than redefining strings.
// ---------------------------------------------------------------------------

interface ModeCopy {
  readonly title: (displayName: string) => string;
  readonly subtitle: string;
  readonly body: string;
  readonly confirm: string;
  readonly confirmPending: string;
}

const COPY: Record<PlanDeleteMode, ModeCopy> = {
  discard: {
    title: (n) => `Discard "${n}"?`,
    subtitle: "Soft delete — reversible by rolling back.",
    body:
      "The plan moves to the archive. It stays in the database, so you " +
      "can still see it under “Show archived” and roll it back " +
      "to the active version later. Use this for drafts you’re done " +
      "iterating on but might want to revisit.",
    confirm: "Discard plan",
    confirmPending: "Discarding…",
  },
  delete: {
    title: (n) => `Permanently delete "${n}"?`,
    subtitle: "Hard delete — this cannot be undone.",
    body:
      "The plan and all of its authoring data will be permanently " +
      "removed. The audit log keeps a record that the plan existed " +
      "(who created it, who deleted it) but the editable content is " +
      "gone forever. Roll back is not available after this.",
    confirm: "Delete permanently",
    confirmPending: "Deleting…",
  },
};

// ---------------------------------------------------------------------------
// Impact list rendering. The dialog never lies: only counts > 0 render.
// "1 stage" / "3 stages" plurals are inlined for readability. Discard
// mode shows "will be archived alongside the plan" wording; delete mode
// uses "will be permanently removed."
// ---------------------------------------------------------------------------

function renderImpactLines(
  impact: PlanDeleteImpact | undefined,
  mode: PlanDeleteMode,
): readonly string[] {
  if (!impact) return [];
  const verb = mode === "delete" ? "permanently removed" : "archived";
  const lines: string[] = [];
  const push = (count: number | undefined, singular: string, plural: string) => {
    if (count === undefined || count <= 0) return;
    lines.push(`${count} ${count === 1 ? singular : plural} will be ${verb}.`);
  };
  push(impact.stages, "stage", "stages");
  push(impact.dimensions, "dimension", "dimensions");
  push(impact.factorTables, "factor table (incl. cells)", "factor tables (incl. cells)");
  push(impact.inputMappings, "input mapping", "input mappings");
  push(impact.snapshots, "frozen snapshot", "frozen snapshots");
  return lines;
}
