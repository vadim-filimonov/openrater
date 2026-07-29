/**
 * <EntityRefPicker> — insurance-domain reference picker.
 *
 * Brief 7 (reference-pickers-everywhere). The actuary-facing wrapper
 * around @openrater/design-system's <Combobox>. Adds:
 *
 *   - `entityLabel` driving placeholder + aria-label
 *     ("class", "dimension", "factor table", "curve") → "Pick a class…"
 *     + "Class" aria-label.
 *   - Stale-ref detection: when `value` is set but doesn't match any
 *     option, the input renders with ⚠ warning + descriptive tooltip
 *     ("This reference doesn't match any registered {entity}…").
 *   - Empty-state handoff: when no options match the query, optionally
 *     render a "→ Go to {Section}" CTA that closes the picker and
 *     triggers section navigation (the actuary's intent: "let me see
 *     the full library").
 *   - Sub-label formatting: each option's `subLabel` (e.g.,
 *     "73912 · Recreation") renders in monospace below the label.
 *
 *   <EntityRefPicker
 *     entityLabel="class"
 *     options={classOptions}
 *     value={classCode}
 *     onChange={setClassCode}
 *     emptyAction={{
 *       label: "Browse all classes",
 *       onClick: () => navigateTo("classification"),
 *     }}
 *   />
 *
 * Used by:
 *   - <ClassPicker>          (Brief 16 — wraps EntityRefPicker for
 *                             class codes; the cold-test pivot point)
 *   - <DimensionRefPicker>   (chain factor → dimension)
 *   - <FactorTableRefPicker> (chain factor → factor table)
 *   - <CurveRefPicker>       (chain factor → curve)
 *   - <InputSourceRefPicker> (input source binding)
 *   - <CoverageChainRefPicker> (nested chain)
 *
 * BEM class names:
 *   .rater-entity-ref-picker                  (root)
 *   .rater-entity-ref-picker--stale           (modifier when stale-ref)
 *   .rater-entity-ref-picker__stale-warning   (the ⚠ icon)
 *   .rater-entity-ref-picker__empty-action    (the empty-state CTA)
 *
 * Composes:
 *   - @openrater/design-system <Combobox>
 *   - @openrater/design-system <Tooltip>
 *   - @openrater/design-system <Button>
 */

import { useCallback, useMemo, type ReactNode } from "react";
import {
  Combobox,
  Button,
  Tooltip,
  type ComboboxOption,
  type ComboboxRenderOptionState,
} from "@openrater/design-system";
import { AlertTriangle, ArrowRight } from "lucide-react";
import "./EntityRefPicker.css";

/**
 * One option in the picker. Mirrors ComboboxOption but renames
 * `hint` → `subLabel` to match the insurance-domain convention
 * (e.g., "73912 · Recreation" as the sub-label under "Bowling Centers").
 */
export interface EntityRefOption {
  readonly value: string;
  readonly label: string;
  /** Optional secondary text — typically the entity code + family
   *  (e.g., "73912 · Recreation"). Rendered in monospace. */
  readonly subLabel?: string;
  readonly disabled?: boolean;
}

/**
 * The "→ Go to {Section}" empty-state handoff. When no options match,
 * the picker renders this CTA so the actuary can break out into a
 * richer browsing UI elsewhere.
 */
export interface EntityRefPickerEmptyAction {
  /** Actuary-language CTA text (e.g., "Browse all classes"). */
  readonly label: string;
  /** Fires when the CTA is clicked. The picker closes itself before
   *  invoking this — implementer typically navigates to the relevant
   *  section. */
  readonly onClick: () => void;
}

export interface EntityRefPickerProps {
  /** The entity name in actuary-language. Drives placeholder + aria-label
   *  + stale-ref warning text. Examples: "class", "dimension",
   *  "factor table", "curve". Lowercase by convention; the picker
   *  title-cases it for placeholder display. */
  readonly entityLabel: string;
  /** The options available. Order is preserved. */
  readonly options: readonly EntityRefOption[];
  /** Currently selected value. Empty string = unselected. */
  readonly value: string;
  /** Fires when the user picks an option OR clears (via empty-action). */
  readonly onChange: (next: string) => void;
  /** Empty-state handoff CTA. When omitted, the listbox just shows
   *  "No {entity}s match." with no action button. */
  readonly emptyAction?: EntityRefPickerEmptyAction;
  /** Placeholder override. When omitted, defaults to "Pick a {entity}…". */
  readonly placeholder?: string;
  /** Aria-label override. When omitted, defaults to the entity name
   *  with first letter capitalized ("Class", "Dimension"). */
  readonly ariaLabel?: string;
  /** Plural form of entityLabel for the empty state ("No {plural}
   *  match."). When omitted, falls back to a small built-in
   *  pluralizer that handles the common cases:
   *  class → classes, dimension → dimensions, curve → curves,
   *  factor table → factor tables, box → boxes. */
  readonly entityLabelPlural?: string;
  readonly disabled?: boolean;
  /** Optional id (for label.htmlFor pairing). */
  readonly inputId?: string;
}

/**
 * Small built-in pluralizer for the empty-state copy. Handles the
 * canonical English patterns:
 *   - ending in s / x / z / ch / sh → +es
 *   - ending in consonant + y → strip y, add ies
 *   - everything else → +s
 * For irregular plurals, callers pass `entityLabelPlural` directly.
 */
function pluralize(singular: string): string {
  if (/(s|x|z|ch|sh)$/.test(singular)) return `${singular}es`;
  if (/[^aeiou]y$/.test(singular)) return `${singular.slice(0, -1)}ies`;
  return `${singular}s`;
}

/**
 * Stale-ref detection: the value is set but doesn't match any of the
 * options. Surfaces as ⚠ + descriptive tooltip. Common cause: the
 * referenced entity was renamed or deleted from the registry.
 */
function isStaleRef(
  value: string,
  options: readonly EntityRefOption[],
): boolean {
  if (value === "") return false;
  return !options.some((o) => o.value === value);
}

/** Capitalize the first letter of the entity name. */
function titleCase(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function EntityRefPicker({
  entityLabel,
  options,
  value,
  onChange,
  emptyAction,
  placeholder,
  ariaLabel,
  entityLabelPlural,
  disabled = false,
  inputId,
}: EntityRefPickerProps) {
  // Map EntityRefOption → ComboboxOption by aliasing subLabel as hint.
  const comboboxOptions = useMemo<readonly ComboboxOption[]>(
    () =>
      options.map((o) => ({
        value: o.value,
        label: o.label,
        ...(o.subLabel !== undefined ? { hint: o.subLabel } : {}),
        ...(o.disabled !== undefined ? { disabled: o.disabled } : {}),
      })),
    [options],
  );

  const stale = isStaleRef(value, options);
  const effectivePlaceholder =
    placeholder ?? `Pick a ${entityLabel}…`;
  const effectiveAriaLabel = ariaLabel ?? titleCase(entityLabel);

  // Custom emptyState that wires in the optional emptyAction CTA.
  const emptyState = useMemo<ReactNode>(() => {
    const plural = entityLabelPlural ?? pluralize(entityLabel);
    const noMatch = `No ${plural} match.`;
    if (!emptyAction) {
      return <span className="rater-entity-ref-picker__empty-text">{noMatch}</span>;
    }
    return (
      <div className="rater-entity-ref-picker__empty">
        <span className="rater-entity-ref-picker__empty-text">{noMatch}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconAfter={<ArrowRight size={14} />}
          onClick={emptyAction.onClick}
          className="rater-entity-ref-picker__empty-action"
        >
          {emptyAction.label}
        </Button>
      </div>
    );
  }, [emptyAction, entityLabel, entityLabelPlural]);

  // Custom renderOption that styles subLabel in monospace per Brief 7.
  // The default Combobox renderOption uses CSS variables we can match,
  // but rendering explicitly here keeps the contract clear (the
  // Combobox's default could change; this picker stays stable).
  const renderOption = useCallback(
    (opt: ComboboxOption, _state: ComboboxRenderOptionState) => (
      <>
        <span className="rater-entity-ref-picker__opt-label">{opt.label}</span>
        {opt.hint ? (
          <span className="rater-entity-ref-picker__opt-sublabel">
            {opt.hint}
          </span>
        ) : null}
      </>
    ),
    [],
  );

  const staleTooltip = `This reference doesn't match any registered ${entityLabel}. Pick from the list, or open the relevant section to browse.`;

  return (
    <div
      className={[
        "rater-entity-ref-picker",
        stale ? "rater-entity-ref-picker--stale" : null,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Combobox
        value={value}
        onValueChange={onChange}
        options={comboboxOptions}
        placeholder={effectivePlaceholder}
        emptyState={emptyState}
        renderOption={renderOption}
        ariaLabel={effectiveAriaLabel}
        hasError={stale}
        disabled={disabled}
        {...(inputId !== undefined ? { inputId } : {})}
      />
      {stale ? (
        <Tooltip content={staleTooltip} placement="top">
          <span
            className="rater-entity-ref-picker__stale-warning"
            aria-label={staleTooltip}
            role="img"
          >
            <AlertTriangle size={14} />
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
