/**
 * <FreezeVersionDialog> — name + freeze the current draft state of a plan
 * into an immutable, append-only snapshot. (Brief 43 / PR 43.1.)
 *
 * Triggered from the plan header. On confirm the parent calls the
 * `useFreezeSnapshot` mutation; the dialog stays open through the
 * round-trip so it can:
 *
 *   · Disable the primary button + show a busy state (spinner).
 *   · Surface a 409 name-collision error inline (the only failure
 *     mode that's a user-correctable mistake — the user can simply
 *     edit the display name and retry without losing the notes).
 *
 * Pure presentation: the parent owns the open state, the mutation
 * call, and what to do on success (close + invalidate list query).
 * No `useFreezeSnapshot` import here — that would bind the primitive
 * to the hooks layer, blocking @openrater/ui from rendering inside
 * Storybook or design fixtures.
 *
 * Q1 lock — Brief 43 §−1: display_name is required + unique within
 * the plan, append-only. The dialog enforces UNIQUE client-side only
 * by surfacing the 409; pre-flight checking the list and disabling
 * the button would race the backend, so we let the user submit and
 * surface the conflict honestly.
 *
 * Q6 lock — name suggestions: the parent supplies a `defaultName`
 * (e.g. `draft_2026-05-26`); we don't compute it here because the
 * route knows the current snapshot count and any collision-avoidance
 * pattern (e.g. `_v2`, `_v3`) better than this primitive can.
 */

import {
  useEffect,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { Button, Modal } from "@openrater/design-system";
import { Camera, TriangleAlert } from "lucide-react";
import "./FreezeVersionDialog.css";

const MAX_DISPLAY_NAME = 200;
const MAX_NOTES = 2000;

export interface FreezeVersionDialogProps {
  /** Controls modal visibility — parent owns the state. */
  readonly open: boolean;
  /**
   * Plan summary used to render the context strip — proves to the user
   * which version they're capturing. Compact intentionally; the source
   * of truth is the live plan header right behind the modal backdrop.
   */
  readonly plan: {
    readonly display_name: string;
    readonly line_of_business: string;
    readonly effective_date: string;
    readonly content_hash?: string | null;
  };
  /**
   * Pre-filled value for the display name field. Typically a date-
   * stamped suggestion like `draft_2026-05-26`; the user is free to
   * override. Empty string is allowed (the input renders blank).
   */
  readonly defaultName?: string;
  /** True while the freeze request is in flight. */
  readonly isSubmitting?: boolean;
  /**
   * Inline error to surface above the form. The parent maps a
   * `RaterApiError` (typically the 409 `snapshot_name_collision`) to a
   * human-readable string. `null`/`undefined` clears the banner.
   */
  readonly errorMessage?: string | null;
  /** Backdrop click / Escape / Cancel / close-X. */
  readonly onClose: () => void;
  /**
   * Confirm handler. Receives the trimmed name + notes. Notes is
   * `null` when the user left the field blank — round-trips to the
   * backend's `Optional[str]`.
   */
  readonly onConfirm: (body: {
    readonly display_name: string;
    readonly notes: string | null;
  }) => void;
  readonly testId?: string;
}

export function FreezeVersionDialog(
  props: FreezeVersionDialogProps,
): JSX.Element | null {
  const {
    open,
    plan,
    defaultName = "",
    isSubmitting = false,
    errorMessage,
    onClose,
    onConfirm,
    testId = "rater-freeze-version-dialog",
  } = props;

  const [displayName, setDisplayName] = useState(defaultName);
  const [notes, setNotes] = useState("");

  // Reset form state on every reopen so the default name takes effect
  // and stale input from a previous open doesn't leak through.
  useEffect(() => {
    if (open) {
      setDisplayName(defaultName);
      setNotes("");
    }
  }, [open, defaultName]);

  if (!open) return null;

  const trimmedName = displayName.trim();
  const trimmedNotes = notes.trim();
  const nameOverflow = displayName.length > MAX_DISPLAY_NAME;
  const notesOverflow = notes.length > MAX_NOTES;
  const canSubmit =
    trimmedName.length > 0 &&
    !nameOverflow &&
    !notesOverflow &&
    !isSubmitting;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    onConfirm({
      display_name: trimmedName,
      notes: trimmedNotes.length > 0 ? trimmedNotes : null,
    });
  };

  const shortHash = plan.content_hash
    ? plan.content_hash.slice(0, 7)
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save a version"
      subtitle="Capture the current draft as an immutable checkpoint. It won't change what callers get — publish it from the timeline when ready; Analytics can re-rate against it."
      size="md"
      dismissable={!isSubmitting}
    >
      <form
        className="rater-freeze-version-dialog"
        data-testid={testId}
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="rater-modal__body">
          {/* Context strip — mirrors the plan-studio-header meta row so
              the user reads the same identifiers in both places. */}
          <div
            className="rater-freeze-version-dialog__context"
            aria-label="Plan being frozen"
            data-testid={`${testId}-context`}
          >
            <span
              className="rater-freeze-version-dialog__context-icon"
              aria-hidden
            >
              <Camera size={14} />
            </span>
            <span className="rater-freeze-version-dialog__context-name">
              {plan.display_name}
            </span>
            <span
              className="rater-freeze-version-dialog__context-sep"
              aria-hidden
            >
              ·
            </span>
            <span className="rater-freeze-version-dialog__context-meta">
              {plan.line_of_business.toUpperCase()}
            </span>
            <span
              className="rater-freeze-version-dialog__context-sep"
              aria-hidden
            >
              ·
            </span>
            <span className="rater-freeze-version-dialog__context-meta rater-freeze-version-dialog__context-meta--mono">
              {plan.effective_date}
            </span>
            {shortHash ? (
              <>
                <span
                  className="rater-freeze-version-dialog__context-sep"
                  aria-hidden
                >
                  ·
                </span>
                <span
                  className="rater-freeze-version-dialog__context-meta rater-freeze-version-dialog__context-meta--mono"
                  title={plan.content_hash ?? undefined}
                >
                  {shortHash}
                </span>
              </>
            ) : null}
          </div>

          {/* Inline error banner — collisions surface here so the user
              can fix the name without losing the notes they typed. */}
          {errorMessage ? (
            <div
              className="rater-freeze-version-dialog__error"
              role="alert"
              data-testid={`${testId}-error`}
            >
              <span
                className="rater-freeze-version-dialog__error-icon"
                aria-hidden
              >
                <TriangleAlert size={14} />
              </span>
              <span>{errorMessage}</span>
            </div>
          ) : null}

          {/* Display name (required) */}
          <label
            className="rater-freeze-version-dialog__field"
            htmlFor={`${testId}-name`}
          >
            <span className="rater-freeze-version-dialog__field-label">
              Version name
              <span
                className="rater-freeze-version-dialog__field-required"
                aria-hidden
              >
                *
              </span>
            </span>
            <input
              id={`${testId}-name`}
              type="text"
              className="rater-freeze-version-dialog__input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="filed_2026_q3"
              maxLength={MAX_DISPLAY_NAME + 50}
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
              aria-invalid={nameOverflow || undefined}
              data-testid={`${testId}-name`}
              required
            />
            <span
              className="rater-freeze-version-dialog__field-hint"
              data-tone={nameOverflow ? "error" : "muted"}
            >
              {nameOverflow
                ? `Trim to ${MAX_DISPLAY_NAME} characters.`
                : "Unique within this plan. Use a stable label like a filing tag or release name."}
            </span>
          </label>

          {/* Notes (optional) */}
          <label
            className="rater-freeze-version-dialog__field"
            htmlFor={`${testId}-notes`}
          >
            <span className="rater-freeze-version-dialog__field-label">
              Notes
              <span className="rater-freeze-version-dialog__field-optional">
                optional
              </span>
            </span>
            <textarea
              id={`${testId}-notes`}
              className="rater-freeze-version-dialog__textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What's different since the last version? Cite the filing memo, ADR, or change request."
              rows={4}
              maxLength={MAX_NOTES + 200}
              disabled={isSubmitting}
              aria-invalid={notesOverflow || undefined}
              data-testid={`${testId}-notes`}
            />
            <span
              className="rater-freeze-version-dialog__field-hint"
              data-tone={notesOverflow ? "error" : "muted"}
            >
              {notesOverflow
                ? `Trim to ${MAX_NOTES} characters.`
                : `${notes.length} / ${MAX_NOTES}`}
            </span>
          </label>
        </div>

        <footer className="rater-modal__footer">
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={onClose}
            disabled={isSubmitting}
            data-testid={`${testId}-cancel`}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!canSubmit}
            icon={<Camera size={14} />}
            data-testid={`${testId}-confirm`}
          >
            {isSubmitting ? "Saving…" : "Save version"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
