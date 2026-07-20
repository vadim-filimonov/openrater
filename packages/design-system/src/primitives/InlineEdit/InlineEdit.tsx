/**
 * <InlineEdit> — click-to-edit text (Shell v3 polish; Wave 1).
 *
 * The "invisible until you touch it" editable text pattern, done once:
 * text-identical at idle (transparent border + background, the
 * negative-margin optical trick so the glyphs sit exactly where a
 * static heading would), a hairline + wash on hover, the canonical
 * text-entry focus ring when editing.
 *
 * The audit found this pattern hand-rolled 5+ times with divergent
 * physics (dims2 name/slug, DimensionEditor name/slug/description,
 * level cells…). New surfaces use this primitive; existing copies
 * migrate as their surfaces get reworked.
 *
 * Interaction contract (Linear inline-title grammar):
 *   - commit on BLUR (trimmed; empty or unchanged → silent revert)
 *   - Enter commits (routes through blur — one commit path)
 *   - Escape reverts the draft and blurs (and stops the event so a
 *     surface-level Esc handler doesn't also fire)
 *
 * Controlled-committed / uncontrolled-draft: `value` is the committed
 * truth (the draft re-seeds when it changes upstream); the in-flight
 * draft lives here. `onDraftChange` streams the draft for coupled
 * fields (e.g. a name field live-mirroring into a slug).
 *
 * BEM:
 *   .rater-inline-edit
 *   .rater-inline-edit--title | --body | --mono
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import "./InlineEdit.css";

export type InlineEditVariant = "title" | "body" | "mono";

export interface InlineEditProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "size" | "type"
  > {
  /** The committed value. The draft re-seeds when this changes. */
  readonly value: string;
  /** Fires the trimmed draft on blur/Enter when it actually changed. */
  readonly onCommit: (next: string) => void;
  /** Streams every keystroke — for coupled fields (label-drives-id). */
  readonly onDraftChange?: (draft: string) => void;
  /**
   * - `title`: 20px semibold (the dims2/editor heading scale)
   * - `body`: 13px regular (descriptions, cells)
   * - `mono`: mono 12px, width tracks the value (ids, slugs)
   */
  readonly variant?: InlineEditVariant;
  /** Accessible name. Required — an invisible input must still say
   *  what it edits. */
  readonly "aria-label": string;
}

export const InlineEdit = forwardRef<HTMLInputElement, InlineEditProps>(
  function InlineEdit(
    {
      value,
      onCommit,
      onDraftChange,
      variant = "body",
      className,
      onKeyDown,
      onBlur,
      ...rest
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
    const [draft, setDraft] = useState(value);
    const revertedRef = useRef(false);

    // Re-seed when the committed value changes upstream (a different
    // entity selected, or a commit landed). Mid-edit upstream commits of
    // the SAME value leave the draft alone.
    useEffect(() => {
      setDraft(value);
    }, [value]);

    const classes = [
      "rater-inline-edit",
      `rater-inline-edit--${variant}`,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <input
        ref={inputRef}
        type="text"
        className={classes}
        value={draft}
        // mono ids read best when the box hugs the value
        {...(variant === "mono"
          ? { size: Math.max(6, draft.length + 1) }
          : {})}
        onChange={(e) => {
          setDraft(e.target.value);
          onDraftChange?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur(); // ride the blur-commit path
          } else if (e.key === "Escape") {
            e.stopPropagation();
            revertedRef.current = true;
            setDraft(value);
            onDraftChange?.(value);
            e.currentTarget.blur();
          }
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          if (revertedRef.current) {
            revertedRef.current = false;
          } else {
            const trimmed = draft.trim();
            if (trimmed === "" || trimmed === value) {
              setDraft(value); // silent revert
              onDraftChange?.(value);
            } else {
              onCommit(trimmed);
            }
          }
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  },
);
