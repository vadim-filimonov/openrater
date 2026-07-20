/**
 * <StatementComposer> — Brief 70 Phase 1 (the mad-libs sentence
 * grammar).
 *
 * THE one way the platform builds statements from slots: Eligibility
 * rules ("[Decline] when [field] [is at least] [value] — at [each
 * location]"), the Factor Tables axis choice, the Algorithm step
 * bindings. A template of words and slot tokens renders as a sentence;
 * each slot is either a PICKER (popover with search over options — the
 * dims/inputs visual language rides `renderOption`) or a VALUE input
 * (dtype-coerced, commit on Enter/blur). A VALUE slot GIVEN `options`
 * (Brief 89.3 follow-up — a dimension's authored levels) renders as a
 * picker instead, with one honest escape: when the search matches
 * nothing, a "Use …" row commits the typed text verbatim, labeled by
 * the slot's `freeTextHint` so an off-vocabulary value is a visible
 * choice, never a silent one.
 *
 * THE WITHHOLDING DOCTRINE (ADR-0050) lives in the consumer: slots
 * receive ONLY options the save path can hold. The composer never
 * invents options and renders exactly what it's given — a slot with no
 * legal options simply doesn't render an affordance.
 *
 * Keyboard contract: slots are real buttons; Enter/click opens the
 * picker (search autofocused, ↑↓ + Enter commits); committing
 * auto-advances focus to the next EMPTY slot, so a whole rule can be
 * authored without the mouse.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { SearchField } from "@openrater/design-system";
import "./StatementComposer.css";

export type ComposerSlotKind =
  | "tier"
  | "field"
  | "dimension"
  | "operator"
  | "value"
  | "table";

export interface ComposerOption {
  readonly value: string;
  readonly label: string;
  /** Muted secondary line (slug, dtype). */
  readonly hint?: string;
  /** Optional custom row body (e.g., a <DimToken density="row">). */
  readonly render?: ReactNode;
  readonly disabled?: boolean;
}

export interface ComposerSlot {
  readonly id: string;
  readonly kind: ComposerSlotKind;
  /** The committed value's id ("" = empty). */
  readonly value: string;
  /** How the committed value renders in the sentence (defaults to the
   *  matching option's label, or the raw value for value-slots). */
  readonly display?: ReactNode;
  readonly placeholder: string;
  /**
   * Picker slots: the legal options (capability-flagged upstream).
   * On a VALUE slot (Brief 89.3 follow-up): present + non-empty turns
   * the free-text input into a picker over these options — the seat
   * for a dimension-backed field offers the authored levels instead
   * of accepting text that can never match.
   */
  readonly options?: readonly ComposerOption[];
  /** Value slots: the input dtype ("number" coerces; default text). */
  readonly dtype?: "number" | "text";
  /**
   * Value-slots-as-pickers only: enables the no-match escape row
   * ("Use “…”" — commits the typed search text verbatim) and captions
   * it, e.g. "matches no authored level". Omitted → the picker is
   * strict and a no-match query shows the plain empty state.
   */
  readonly freeTextHint?: string;
  readonly disabled?: boolean;
}

export interface StatementComposerProps {
  /**
   * The sentence: plain strings render as words; "$slotId" tokens
   * render the matching slot. Example:
   *   ["$tier", "when", "$field", "$op", "$value", "— at", "$scope"]
   */
  readonly template: readonly string[];
  readonly slots: readonly ComposerSlot[];
  /** Fires when a slot commits (picker pick or value commit). */
  readonly onSlotCommit: (slotId: string, value: string) => void;
  readonly readOnly?: boolean;
  readonly testId?: string;
}

export function StatementComposer(
  props: StatementComposerProps,
): JSX.Element {
  const {
    template,
    slots,
    onSlotCommit,
    readOnly = false,
    testId = "rater-composer",
  } = props;
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close the picker on outside click.
  useEffect(() => {
    if (openSlot === null) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenSlot(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openSlot]);

  /** Focus the next EMPTY slot's button (the keyboard chain). */
  const advance = useCallback(
    (fromId: string) => {
      const order = template
        .filter((t) => t.startsWith("$"))
        .map((t) => t.slice(1));
      const from = order.indexOf(fromId);
      const next = order
        .slice(from + 1)
        .find((id) => (slotById.get(id)?.value ?? "x") === "");
      if (next) {
        requestAnimationFrame(() => {
          rootRef.current
            ?.querySelector<HTMLElement>(`[data-slot-id="${next}"]`)
            ?.focus();
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template, slots],
  );

  const commit = useCallback(
    (slotId: string, value: string) => {
      onSlotCommit(slotId, value);
      setOpenSlot(null);
      setQuery("");
      setHighlight(0);
      advance(slotId);
    },
    [onSlotCommit, advance],
  );

  const renderPicker = (slot: ComposerSlot): JSX.Element => {
    const options = (slot.options ?? []).filter(
      (o) =>
        !query.trim() ||
        (o.label + " " + (o.hint ?? ""))
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    );
    // The value-seat escape hatch (Brief 89.3 follow-up): a typed
    // entry that matches NO option can still commit — but only as an
    // explicit, captioned row, never as a silent free-text fallback.
    const freeText =
      slot.kind === "value" &&
      slot.freeTextHint !== undefined &&
      options.length === 0 &&
      query.trim() !== ""
        ? query.trim()
        : null;
    const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (freeText !== null) {
          commit(slot.id, freeText);
          return;
        }
        const pick = options[highlight];
        if (pick && !pick.disabled) commit(slot.id, pick.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpenSlot(null);
      }
    };
    return (
      <div
        className="rater-composer__picker"
        role="listbox"
        data-testid={`${testId}-picker-${slot.id}`}
        onKeyDown={onKey}
      >
        <SearchField
          size="sm"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setHighlight(0);
          }}
          placeholder={slot.placeholder}
          aria-label={slot.placeholder}
          autoFocus
        />
        <div className="rater-composer__options">
          {freeText !== null ? (
            <button
              type="button"
              role="option"
              aria-selected
              className="rater-composer__opt rater-composer__opt--freetext is-highlighted"
              onClick={() => commit(slot.id, freeText)}
              data-testid={`${testId}-freetext-${slot.id}`}
            >
              <span className="rater-composer__opt-body">
                <span className="rater-composer__opt-label">
                  Use “{freeText}”
                </span>
                <span className="rater-composer__opt-hint">
                  {slot.freeTextHint}
                </span>
              </span>
            </button>
          ) : options.length === 0 ? (
            <div className="rater-composer__empty">No match.</div>
          ) : (
            options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={i === highlight}
                disabled={o.disabled}
                className={`rater-composer__opt${
                  i === highlight ? " is-highlighted" : ""
                }`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(slot.id, o.value)}
                data-testid={`${testId}-opt-${slot.id}-${o.value}`}
              >
                {o.render ?? (
                  <span className="rater-composer__opt-body">
                    <span className="rater-composer__opt-label">
                      {o.label}
                    </span>
                    {o.hint ? (
                      <span className="rater-composer__opt-hint">
                        {o.hint}
                      </span>
                    ) : null}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderSlot = (slot: ComposerSlot): JSX.Element => {
    // VALUE slot — an inline input, dtype-coerced upstream on commit.
    // Given options (a dimension's authored levels — Brief 89.3), it
    // falls through to the picker path instead: same seat, same rows,
    // plus the captioned "Use …" escape when nothing matches.
    if (slot.kind === "value" && (slot.options?.length ?? 0) === 0) {
      return (
        <span
          key={slot.id}
          className={`rater-composer__slot rater-composer__slot--value${
            slot.value === "" ? " is-empty" : ""
          }`}
        >
          <input
            className="rater-composer__input"
            defaultValue={slot.value}
            placeholder={slot.placeholder}
            inputMode={slot.dtype === "number" ? "decimal" : "text"}
            disabled={readOnly || slot.disabled}
            data-slot-id={slot.id}
            data-testid={`${testId}-slot-${slot.id}`}
            onBlur={(e) => {
              if (e.target.value !== slot.value) {
                onSlotCommit(slot.id, e.target.value);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSlotCommit(slot.id, e.currentTarget.value);
                advance(slot.id);
              }
            }}
          />
        </span>
      );
    }
    // PICKER slot — a button opening the search popover.
    const committed = slot.options?.find((o) => o.value === slot.value);
    return (
      <span key={slot.id} className="rater-composer__slotwrap">
        <button
          type="button"
          className={`rater-composer__slot${
            slot.value === "" ? " is-empty" : ""
          }${openSlot === slot.id ? " is-open" : ""}`}
          disabled={readOnly || slot.disabled}
          data-slot-id={slot.id}
          data-testid={`${testId}-slot-${slot.id}`}
          onClick={() => {
            setOpenSlot((cur) => (cur === slot.id ? null : slot.id));
            setQuery("");
            setHighlight(0);
          }}
        >
          {slot.value === ""
            ? slot.placeholder
            : (slot.display ?? committed?.label ?? slot.value)}
        </button>
        {openSlot === slot.id ? renderPicker(slot) : null}
      </span>
    );
  };

  return (
    <div className="rater-composer" ref={rootRef} data-testid={testId}>
      {template.map((token, i) =>
        token.startsWith("$") ? (
          (() => {
            const slot = slotById.get(token.slice(1));
            return slot ? (
              renderSlot(slot)
            ) : (
              <span key={`missing-${i}`} />
            );
          })()
        ) : (
          <span key={`w-${i}`} className="rater-composer__word">
            {token}
          </span>
        ),
      )}
    </div>
  );
}
