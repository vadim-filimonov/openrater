/**
 * <ClassPicker> — domain-shaped picker for ISO class codes.
 *
 * Per Brief 8 (V.22.A1 Phase 1): the chain-factor-level affordance
 * for picking a class code from the live class library. Wraps
 * `<EntityRefPicker>` so the look + behavior match every other
 * insurance-domain picker (dimension, curve, factor-table) the
 * actuary uses elsewhere.
 *
 * The wrapping exists so:
 *   1. The entity-label is hard-coded to "class" — callers don't
 *      have to remember the convention.
 *   2. The option projection (ClassRecord → EntityRefOption) is
 *      centralized: `display_name` becomes the label;
 *      `"{class_code} · {family}"` becomes the subLabel (mono).
 *   3. The empty-action handoff defaults to "Browse all classes"
 *      pointing at the Classification section route — Phase 1 of
 *      Brief 8's empty-state pattern.
 *
 * Forward-looking note: as Brief 8 Phase 2 lands (full ClassPlan
 * entity with custom-class creation), ClassPicker grows a
 * "Create new class…" empty-state CTA. The wrapping makes that
 * one-place-to-change.
 */

import {
  EntityRefPicker,
  type EntityRefOption,
  type EntityRefPickerEmptyAction,
} from "../EntityRefPicker";

/**
 * Minimal class shape ClassPicker needs to project options. Subset
 * of `ClassRecord` from @openrater/contracts so callers can pass
 * fixture data, partial fetches, or filtered subsets without
 * importing the contracts package.
 */
export interface ClassPickerOption {
  readonly class_code: string;
  readonly display_name: string;
  readonly family: string;
}

export interface ClassPickerProps {
  /** The class library to pick from. Order is preserved. */
  readonly classes: readonly ClassPickerOption[];
  /** Currently selected class_code. Empty string = unselected. */
  readonly value: string;
  /** Fires when the actuary picks a class. */
  readonly onChange: (classCode: string) => void;
  /** Empty-state handoff. Typically navigates to the Classification
   *  section route. When omitted, no CTA is shown. */
  readonly emptyAction?: EntityRefPickerEmptyAction;
  /** Override the placeholder text (default: "Pick a class…"). */
  readonly placeholder?: string;
  /** Override the aria-label (default: "Class"). */
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly inputId?: string;
}

/**
 * Convert a `ClassPickerOption` into the EntityRefPicker's shape:
 *   label    = display_name
 *   subLabel = "{class_code} · {family}"
 *
 * The subLabel pattern matches the Brief 8 example
 * ("c101 · Recreation") and renders in mono font per
 * EntityRefPicker's defaults.
 */
function toEntityRefOption(c: ClassPickerOption): EntityRefOption {
  return {
    value: c.class_code,
    label: c.display_name,
    subLabel: `${c.class_code} · ${c.family}`,
  };
}

export function ClassPicker(props: ClassPickerProps): JSX.Element {
  const {
    classes,
    value,
    onChange,
    emptyAction,
    placeholder,
    ariaLabel,
    disabled,
    inputId,
  } = props;

  return (
    <EntityRefPicker
      entityLabel="class"
      entityLabelPlural="classes"
      options={classes.map(toEntityRefOption)}
      value={value}
      onChange={onChange}
      {...(emptyAction !== undefined ? { emptyAction } : {})}
      {...(placeholder !== undefined ? { placeholder } : {})}
      {...(ariaLabel !== undefined ? { ariaLabel } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(inputId !== undefined ? { inputId } : {})}
    />
  );
}

// Re-export the empty-action shape so callers don't have to dual-
// import EntityRefPicker just to build the empty CTA.
export type { EntityRefPickerEmptyAction } from "../EntityRefPicker";
