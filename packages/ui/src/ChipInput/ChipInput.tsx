/**
 * <ChipInput> — controlled chip-cloud editor (Brief 26 §16 PR 6).
 *
 * Renders a horizontal cloud of removable chips followed by an
 * inline text input. Used for:
 *   • Categorical dimension level aliases ("Meridian Cafe",
 *     "Meridian Cafe - dine-in" → c102)
 *   • Free-text tag lists in editors that need many-strings-per-row
 *
 * Pure presentation:
 *   • Parent owns the chip list (`values`).
 *   • `onChange` fires with the new sorted vector on every add /
 *     remove.
 *   • Internal `draft` state holds the in-progress input string;
 *     commit happens on Enter, Tab, comma, or blur.
 *
 * Add semantics:
 *   • Enter / Tab / "," commit the current draft.
 *   • Whitespace-only drafts are dropped.
 *   • Exact-match-trim-case-insensitive duplicates are ignored.
 *   • Pasting "frame, masonry, non-combustible" auto-splits on
 *     commas + commits all three at once.
 *
 * Remove semantics:
 *   • Click a chip's ✕ to remove that chip.
 *   • Backspace on an empty input removes the trailing chip
 *     (Linear / Notion convention).
 *
 * Keyboard nav:
 *   • Tab in the input cycles to the next focusable as expected.
 *   • Arrow keys are NOT hijacked — let the browser handle them
 *     so screen readers can announce chips normally.
 *
 * a11y: container is `role="list"`; each chip is `role="listitem"`
 * with its delete button labelled "Remove {value}". The input
 * carries `aria-label` from the consumer.
 */

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { X } from "lucide-react";
import "./ChipInput.css";

export interface ChipInputProps {
  /** The current chip values. */
  readonly values: readonly string[];
  /** Fires with the new chip vector on every add / remove. */
  readonly onChange: (next: readonly string[]) => void;
  /** Optional placeholder for the inline input. */
  readonly placeholder?: string;
  /**
   * Optional aria-label for the inline input. When omitted falls
   * back to "Add chip" — consumers should override for clarity
   * (e.g., "Add alias for Meridian Recreation").
   */
  readonly ariaLabel?: string;
  /** Disables add + remove. */
  readonly disabled?: boolean;
  /**
   * Maximum chip count. When set, adding past the cap is a no-op
   * (the input keeps focus + clears the draft). 0 means unlimited.
   */
  readonly maxChips?: number;
  /**
   * Optional custom comparator for duplicate detection. Default
   * is case-insensitive trimmed equality. Override when chips
   * are case-sensitive identifiers.
   */
  readonly isDuplicate?: (next: string, existing: string) => boolean;
  /** Optional test id for the root + sub-elements. */
  readonly testId?: string;
}

/** Default duplicate check — case-insensitive trim match. */
function defaultIsDuplicate(next: string, existing: string): boolean {
  return next.trim().toLowerCase() === existing.trim().toLowerCase();
}

export function ChipInput(props: ChipInputProps): JSX.Element {
  const {
    values,
    onChange,
    placeholder,
    ariaLabel = "Add chip",
    disabled = false,
    maxChips = 0,
    isDuplicate = defaultIsDuplicate,
    testId = "rater-chip-input",
  } = props;

  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const atCap = maxChips > 0 && values.length >= maxChips;

  const addValues = useCallback(
    (raw: string | readonly string[]): void => {
      if (disabled) return;
      const tokens: string[] = Array.isArray(raw)
        ? (raw as readonly string[]).flatMap((s) => s.split(","))
        : (raw as string).split(",");
      const out: string[] = [...values];
      for (const tok of tokens) {
        const trimmed = tok.trim();
        if (trimmed === "") continue;
        if (out.some((existing) => isDuplicate(trimmed, existing))) continue;
        if (maxChips > 0 && out.length >= maxChips) break;
        out.push(trimmed);
      }
      if (out.length !== values.length) {
        onChange(out);
      }
      setDraft("");
    },
    [disabled, values, isDuplicate, maxChips, onChange],
  );

  const removeAt = useCallback(
    (index: number): void => {
      if (disabled) return;
      if (index < 0 || index >= values.length) return;
      const out = values.filter((_, i) => i !== index);
      onChange(out);
    },
    [disabled, values, onChange],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (disabled) return;
      if (event.key === "Enter" || event.key === ",") {
        // Comma also commits — accommodates the "frame, masonry"
        // paste flow when the user types instead of pastes.
        event.preventDefault();
        addValues(draft);
      } else if (event.key === "Tab" && draft.trim() !== "") {
        // Tab commits the draft but DOESN'T preventDefault so
        // focus advances naturally to the next focusable.
        addValues(draft);
      } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
        // Linear / Notion convention — Backspace on empty input
        // removes the trailing chip.
        event.preventDefault();
        removeAt(values.length - 1);
      }
    },
    [disabled, draft, values.length, addValues, removeAt],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      setDraft(event.target.value);
    },
    [],
  );

  const handleBlur = useCallback((): void => {
    if (draft.trim() !== "") {
      addValues(draft);
    }
  }, [draft, addValues]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>): void => {
      if (disabled) return;
      const text = event.clipboardData.getData("text/plain");
      if (text.includes(",") || text.includes("\n")) {
        // Multi-value paste → bypass the input + add directly.
        event.preventDefault();
        const tokens = text.split(/[,\n]/);
        addValues(tokens);
      }
      // Single-value paste falls through to the default input
      // behaviour (becomes the draft).
    },
    [disabled, addValues],
  );

  return (
    <div
      className={`rater-chip-input${disabled ? " rater-chip-input--disabled" : ""}`}
      data-testid={testId}
    >
      <ul
        className="rater-chip-input__chips"
        role="list"
        aria-label={`${values.length} chip${values.length === 1 ? "" : "s"}`}
      >
        {values.map((value, index) => (
          <li
            key={`${value}-${index}`}
            className="rater-chip-input__chip"
            role="listitem"
            data-testid={`${testId}-chip-${index}`}
          >
            <span className="rater-chip-input__chip-text" title={value}>
              {value}
            </span>
            <button
              type="button"
              className="rater-chip-input__chip-remove"
              aria-label={`Remove ${value}`}
              onClick={() => removeAt(index)}
              disabled={disabled}
              data-testid={`${testId}-chip-${index}-remove`}
            >
              <X size={12} aria-hidden />
            </button>
          </li>
        ))}
        <li className="rater-chip-input__input-wrap" role="presentation">
          <input
            ref={inputRef}
            type="text"
            className="rater-chip-input__input"
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onPaste={handlePaste}
            placeholder={atCap ? "" : placeholder}
            aria-label={ariaLabel}
            disabled={disabled || atCap}
            data-testid={`${testId}-input`}
          />
        </li>
      </ul>
      {atCap ? (
        <p className="rater-chip-input__cap-hint">
          {maxChips}-chip cap reached. Remove a chip to add more.
        </p>
      ) : null}
    </div>
  );
}
