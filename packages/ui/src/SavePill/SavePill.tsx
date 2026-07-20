/**
 * <SavePill> — the one save-status pill.
 *
 * Before this primitive, four surfaces hand-rolled their own pill with
 * divergent DNA: BuildUpSheet / AppetiteStatement / ParametrizeCanvas
 * rendered SHOUTY uppercase text with no status dot, while GeoDimEditor
 * rendered calm sentence-case WITH a 6px dot — and the three even
 * disagreed on the "saving" tone (text-subtle vs text-muted). This
 * unifies them on one calm grammar: a 6px status dot (carrying the
 * domain color) + sentence-case t-11 text.
 *
 * Pure presentation. The parent owns the lifecycle state; the pill only
 * renders it. Color stays inside the status domain (V2 §1.1):
 *   dirty  → feedback-warn   ("Unsaved changes")
 *   saving → text-subtle     ("Saving…")
 *   saved  → feedback-success("Saved" — transient, fades after a hold)
 *   error  → feedback-error  ("Save failed")
 *   idle   → renders nothing
 *
 * `role="status"` makes it a polite live region so screen readers
 * announce transitions without stealing focus.
 */

import type { JSX } from "react";
import "./SavePill.css";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const DEFAULT_LABELS: Record<Exclude<SaveState, "idle">, string> = {
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

export interface SavePillProps {
  /** Current save lifecycle state. "idle" renders nothing. */
  readonly state: SaveState;
  /**
   * Override the label for the current state. Use sparingly — only when
   * the consumer carries genuinely more specific info than the canonical
   * copy (e.g. an auto-retrying save shows "Save failed — retrying").
   */
  readonly label?: string;
  /** Test id applied to the root span. */
  readonly testId?: string;
  /** Layout passthrough (margins/alignment at the call site). */
  readonly className?: string;
}

export function SavePill({
  state,
  label,
  testId,
  className,
}: SavePillProps): JSX.Element | null {
  if (state === "idle") return null;
  const text = label ?? DEFAULT_LABELS[state];
  return (
    <span
      className={`rater-savepill rater-savepill--${state}${
        className ? ` ${className}` : ""
      }`}
      role="status"
      {...(testId ? { "data-testid": testId } : {})}
    >
      {text}
    </span>
  );
}
