/**
 * <SearchField> — the search/filter input (Shell v3 polish; Wave 1).
 *
 * Before this primitive, six surfaces hand-rolled their own icon+input
 * box, none with a clear affordance, none clearing on Escape, and the
 * dims2 copy never visibly focused. This locks the pattern once:
 *
 *   - lucide Search leading at text-subtle
 *   - the canonical text-entry focus ring (focus-ring border +
 *     2px cat-input-soft halo)
 *   - a clear (×) IconButton shown only when there's a value —
 *     clears + refocuses
 *   - Escape clears the value (and stops the event); a second Escape
 *     propagates (so a surface-level Esc handler can take over)
 *   - an optional shortcut hint slot (e.g. <Kbd>/</Kbd>) shown while
 *     empty + unfocused
 *
 * Controlled-only: `value` + `onChange(next)`.
 *
 * BEM:
 *   .rater-searchfield
 *   .rater-searchfield--sm | --md
 *   .rater-searchfield__icon
 *   .rater-searchfield__input
 *   .rater-searchfield__hint
 *   (the clear button is a design-system <IconButton variant="plain">)
 */

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Search, X } from "lucide-react";
import { IconButton } from "../IconButton";
import "./SearchField.css";

export type SearchFieldSize = "sm" | "md";

export interface SearchFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "size" | "onChange" | "value" | "type"
  > {
  readonly value: string;
  /** Fires with the next text (already a string — no event plumbing). */
  readonly onChange: (next: string) => void;
  /** Accessible name for the input. Required — a search box must say
   *  what it searches. */
  readonly "aria-label": string;
  /** md: 32px (default) · sm: 28px (dense headers). */
  readonly size?: SearchFieldSize;
  /**
   * Optional shortcut hint (typically `<Kbd>/</Kbd>`), shown while the
   * field is empty and unfocused. The keybinding itself belongs to the
   * consumer — this is just the affordance.
   */
  readonly shortcutHint?: ReactNode;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    {
      value,
      onChange,
      size = "md",
      shortcutHint,
      className,
      onKeyDown,
      onFocus,
      onBlur,
      ...rest
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
    const [focused, setFocused] = useState(false);

    const classes = [
      "rater-searchfield",
      `rater-searchfield--${size}`,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={classes}>
        <span className="rater-searchfield__icon" aria-hidden>
          <Search />
        </span>
        <input
          ref={inputRef}
          type="search"
          className="rater-searchfield__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && value !== "") {
              e.stopPropagation();
              onChange("");
            }
            onKeyDown?.(e);
          }}
          {...rest}
        />
        {value !== "" ? (
          <IconButton
            variant="plain"
            size="xs"
            icon={<X />}
            aria-label="Clear search"
            className="rater-searchfield__clear"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
          />
        ) : shortcutHint !== undefined && !focused ? (
          <span className="rater-searchfield__hint" aria-hidden>
            {shortcutHint}
          </span>
        ) : null}
      </div>
    );
  },
);
