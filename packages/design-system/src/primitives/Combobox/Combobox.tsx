/**
 * <Combobox> — type-to-search single-select picker.
 *
 * The foundation for Brief 7's <EntityRefPicker> (which adds the
 * insurance-domain layering: subLabel hint, stale-ref warning,
 * empty-state handoff, browse CTA). This primitive provides the
 * pure combobox mechanics + ARIA pattern; reference-picker semantics
 * are layered on top.
 *
 *   <Combobox
 *     value={classCode}
 *     onValueChange={setClassCode}
 *     options={classes}
 *     placeholder="Pick a class…"
 *     emptyState={<>No classes match. <Button>Browse all</Button></>}
 *     ariaLabel="Class code"
 *   />
 *
 * Behavior:
 *   - Input field anchors the combobox; click/focus auto-opens the
 *     listbox (cold-test rhythm: actuary sees options without an extra
 *     click)
 *   - Type-to-search filters the option list (case-insensitive substring
 *     match on label OR value, by default; overridable via `filter`)
 *   - ArrowDown / ArrowUp navigate the highlighted option (wraps; skips
 *     disabled)
 *   - Home / End jump to first / last enabled option
 *   - Enter selects the highlighted option + closes
 *   - Escape closes WITHOUT selecting (restores input text to the
 *     current value's label)
 *   - Tab closes WITHOUT selecting (allows normal form-field flow)
 *   - Click outside closes (with restore)
 *   - Clicking an option selects it + closes
 *   - Restricted to in-list values — typed text that doesn't match
 *     anything stays in the input until blur, then reverts to the
 *     last valid label (so the actuary can't accidentally save a
 *     made-up class code; for free-text use a plain Input instead)
 *
 * ARIA (WAI-ARIA 1.2 combobox pattern):
 *   - The input has role="combobox"
 *   - aria-autocomplete="list" (we filter the list, don't autocomplete in-place)
 *   - aria-expanded={open}
 *   - aria-controls={listboxId}
 *   - aria-activedescendant={highlightedOptionId} when open
 *   - The portal-rendered panel has role="listbox" + aria-label
 *   - Each option has role="option" + aria-selected
 *
 * BEM class names:
 *   .rater-combobox                          (root wrapper around input)
 *   .rater-combobox__field                   (the input)
 *   .rater-combobox__chevron                 (trailing dropdown indicator)
 *   .rater-combobox__listbox                 (portal-rendered panel)
 *   .rater-combobox__option                  (one option row)
 *   .rater-combobox__option--highlighted     (ArrowDown/Up focus)
 *   .rater-combobox__option--selected        (current value)
 *   .rater-combobox__option--disabled
 *   .rater-combobox__option-label
 *   .rater-combobox__option-hint
 *   .rater-combobox__empty                   (no-matches state)
 *
 * Tokens consumed:
 *   - --rater-surface-1, --rater-surface-2, --rater-surface-3
 *   - --rater-text-strong, --rater-text-default, --rater-text-muted
 *   - --rater-border-default, --rater-border-strong
 *   - --rater-r-6, --rater-r-4
 *   - --rater-s-{4,6,8,10,12}, --rater-t-{12,13,14}
 *   - --rater-focus-ring, --rater-shadow-floating, --rater-z-popover
 *   - --rater-d-140, --rater-ease-soft, --rater-fw-medium
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./Combobox.css";

export interface ComboboxOption {
  /** Stable id stored in `value`. Used as the form-submitted value. */
  readonly value: string;
  /** Display label shown in the input + option row. */
  readonly label: string;
  /** Optional secondary text under the label (e.g., NAICS code, family
   *  context). Rendered muted. */
  readonly hint?: string;
  /** Disabled options are non-interactive + skipped by keyboard nav. */
  readonly disabled?: boolean;
}

export interface ComboboxRenderOptionState {
  readonly highlighted: boolean;
  readonly selected: boolean;
  readonly query: string;
}

export interface ComboboxProps {
  /** Currently selected value (matches one option's `value`). Empty
   *  string means "unselected". Controlled — pair with `onValueChange`. */
  readonly value: string;
  /** Fires when the user picks an option. */
  readonly onValueChange: (next: string) => void;
  /** The options to choose from. Order is preserved (no auto-sort). */
  readonly options: readonly ComboboxOption[];
  /** Placeholder shown when no value is selected. */
  readonly placeholder?: string;
  /** Rendered inside the listbox when no options match the current
   *  query. Common pattern: a "Browse all" CTA that opens a richer
   *  picker UI elsewhere. */
  readonly emptyState?: ReactNode;
  /** Render override for each option row. Default: label on top,
   *  hint underneath (muted). */
  readonly renderOption?: (
    option: ComboboxOption,
    state: ComboboxRenderOptionState,
  ) => ReactNode;
  /** Filter override. Default: case-insensitive substring on label OR
   *  value OR hint. */
  readonly filter?: (option: ComboboxOption, query: string) => boolean;
  /** Marks the input invalid (e.g., when the value is a stale ref that
   *  doesn't match any option). Sets aria-invalid. */
  readonly hasError?: boolean;
  /** Disabled combobox is non-interactive. */
  readonly disabled?: boolean;
  /** Accessibility label — required when no <Label> wraps the field. */
  readonly ariaLabel?: string;
  /** Optional id for the input (for label.htmlFor pairing). */
  readonly inputId?: string;
}

const DEFAULT_FILTER = (option: ComboboxOption, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    option.label.toLowerCase().includes(q) ||
    option.value.toLowerCase().includes(q) ||
    (option.hint?.toLowerCase().includes(q) ?? false)
  );
};

export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(
  function Combobox(
    {
      value,
      onValueChange,
      options,
      placeholder,
      emptyState,
      renderOption,
      filter = DEFAULT_FILTER,
      hasError = false,
      disabled = false,
      ariaLabel,
      inputId,
    },
    forwardedRef,
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listboxRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const generatedListboxId = useId();
    const listboxId = `${generatedListboxId}-listbox`;
    const optionIdBase = `${generatedListboxId}-option`;

    // Find the option matching the current value (if any).
    const selectedOption = useMemo(
      () => options.find((o) => o.value === value),
      [options, value],
    );

    // Input shows the user's query while typing; otherwise the
    // selected option's label (or empty for no selection).
    const [query, setQuery] = useState<string>(selectedOption?.label ?? "");
    const [open, setOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

    // When the external value changes (parent updates), sync the
    // displayed text to that option's label. Only when closed —
    // changing it while the user is mid-type would steal their input.
    useEffect(() => {
      if (open) return;
      setQuery(selectedOption?.label ?? "");
    }, [open, selectedOption?.label]);

    // Filtered options. When open + the user is querying, filter by
    // their text. When open but query exactly matches the selected
    // label (initial state), show ALL options so they can change
    // selection. The heuristic: filter only when query differs from
    // the selected label (i.e., user has typed something else).
    const filteredOptions = useMemo(() => {
      if (!open) return [];
      const isInitialQuery =
        selectedOption && query === selectedOption.label;
      if (isInitialQuery) return options;
      return options.filter((o) => filter(o, query));
    }, [open, query, options, filter, selectedOption]);

    // Reset highlightedIndex when the filtered list changes; start at
    // the selected option if it's in the list, else 0 (first enabled).
    useEffect(() => {
      if (!open) {
        setHighlightedIndex(-1);
        return;
      }
      if (filteredOptions.length === 0) {
        setHighlightedIndex(-1);
        return;
      }
      const selectedIdx = filteredOptions.findIndex(
        (o) => o.value === value && !o.disabled,
      );
      if (selectedIdx !== -1) {
        setHighlightedIndex(selectedIdx);
        return;
      }
      const firstEnabled = filteredOptions.findIndex((o) => !o.disabled);
      setHighlightedIndex(firstEnabled === -1 ? -1 : firstEnabled);
    }, [open, filteredOptions, value]);

    // Position the listbox below the input.
    const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
    useLayoutEffect(() => {
      if (!open) {
        setPosition(null);
        return;
      }
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }, [open]);

    // Outside-click closes (restore on close).
    useEffect(() => {
      if (!open) return;
      const handler = (e: globalThis.MouseEvent) => {
        const target = e.target as Node | null;
        if (!target) return;
        if (rootRef.current?.contains(target)) return;
        if (listboxRef.current?.contains(target)) return;
        closeAndRestore();
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
      // closeAndRestore identity is stable enough via the deps below
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const closeAndRestore = useCallback(() => {
      setOpen(false);
      // Restore the displayed text to the current value's label.
      setQuery(selectedOption?.label ?? "");
    }, [selectedOption?.label]);

    const handleSelect = useCallback(
      (next: ComboboxOption) => {
        if (next.disabled) return;
        onValueChange(next.value);
        setQuery(next.label);
        setOpen(false);
      },
      [onValueChange],
    );

    const onKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;
        switch (e.key) {
          case "ArrowDown": {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (filteredOptions.length === 0) return;
            let next = highlightedIndex;
            for (let i = 0; i < filteredOptions.length; i++) {
              next = (next + 1) % filteredOptions.length;
              if (!filteredOptions[next]?.disabled) break;
            }
            setHighlightedIndex(next);
            return;
          }
          case "ArrowUp": {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (filteredOptions.length === 0) return;
            let prev = highlightedIndex < 0 ? 0 : highlightedIndex;
            for (let i = 0; i < filteredOptions.length; i++) {
              prev = (prev - 1 + filteredOptions.length) % filteredOptions.length;
              if (!filteredOptions[prev]?.disabled) break;
            }
            setHighlightedIndex(prev);
            return;
          }
          case "Home": {
            if (!open) return;
            e.preventDefault();
            const first = filteredOptions.findIndex((o) => !o.disabled);
            if (first !== -1) setHighlightedIndex(first);
            return;
          }
          case "End": {
            if (!open) return;
            e.preventDefault();
            for (let i = filteredOptions.length - 1; i >= 0; i--) {
              if (!filteredOptions[i]?.disabled) {
                setHighlightedIndex(i);
                break;
              }
            }
            return;
          }
          case "Enter": {
            if (!open) return;
            const opt = filteredOptions[highlightedIndex];
            if (opt) {
              e.preventDefault();
              handleSelect(opt);
            }
            return;
          }
          case "Escape": {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              closeAndRestore();
            }
            return;
          }
          case "Tab": {
            // Don't preventDefault — let Tab move focus away.
            if (open) closeAndRestore();
            return;
          }
          default:
            return;
        }
      },
      [
        disabled,
        open,
        filteredOptions,
        highlightedIndex,
        handleSelect,
        closeAndRestore,
      ],
    );

    const setInputRef = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          // The forwarded ref is a MutableRefObject in practice; React's
          // ForwardedRef type marks `current` readonly to discourage
          // direct writes, but assigning the resolved DOM node is the
          // canonical pattern. Cast through unknown.
          (forwardedRef as unknown as { current: HTMLInputElement | null }).current =
            node;
        }
      },
      [forwardedRef],
    );

    const activeOptionId =
      open && highlightedIndex >= 0
        ? `${optionIdBase}-${highlightedIndex}`
        : undefined;

    return (
      <div ref={rootRef} className="rater-combobox">
        <input
          ref={setInputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-invalid={hasError || undefined}
          aria-label={ariaLabel}
          disabled={disabled}
          placeholder={placeholder}
          value={query}
          className={[
            "rater-combobox__field",
            hasError ? "rater-combobox__field--error" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        <span className="rater-combobox__chevron" aria-hidden>
          ▾
        </span>
        {open
          ? createPortal(
              <div
                ref={listboxRef}
                id={listboxId}
                role="listbox"
                aria-label={ariaLabel ?? "Options"}
                className="rater-combobox__listbox"
                style={
                  position
                    ? {
                        top: `${position.top}px`,
                        left: `${position.left}px`,
                        minWidth: `${position.width}px`,
                      }
                    : { top: "-9999px", left: "-9999px" }
                }
              >
                {filteredOptions.length === 0 ? (
                  <div className="rater-combobox__empty">
                    {emptyState ?? "No matches."}
                  </div>
                ) : (
                  filteredOptions.map((opt, i) => {
                    const highlighted = i === highlightedIndex;
                    const selected = opt.value === value;
                    return (
                      <div
                        key={opt.value}
                        id={`${optionIdBase}-${i}`}
                        role="option"
                        aria-selected={selected}
                        aria-disabled={opt.disabled || undefined}
                        className={[
                          "rater-combobox__option",
                          highlighted
                            ? "rater-combobox__option--highlighted"
                            : null,
                          selected
                            ? "rater-combobox__option--selected"
                            : null,
                          opt.disabled
                            ? "rater-combobox__option--disabled"
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        // Use onMouseDown — mouseup runs after blur which
                        // would close the listbox first. mousedown +
                        // preventDefault keeps focus on the input.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelect(opt);
                        }}
                        onPointerEnter={() => {
                          if (!opt.disabled) setHighlightedIndex(i);
                        }}
                      >
                        {renderOption ? (
                          renderOption(opt, {
                            highlighted,
                            selected,
                            query,
                          })
                        ) : (
                          <>
                            <span className="rater-combobox__option-label">
                              {opt.label}
                            </span>
                            {opt.hint ? (
                              <span className="rater-combobox__option-hint">
                                {opt.hint}
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  },
);
