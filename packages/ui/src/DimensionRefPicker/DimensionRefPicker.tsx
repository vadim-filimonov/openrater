/**
 * <DimensionRefPicker> — domain-shaped picker for plan-registered
 * dimensions.
 *
 * Per Brief 8 / V.22.A3: dimensions (construction class, protection
 * class, sprinklered, etc.) are pickable in the same combobox pattern
 * as class codes. This primitive is the dimensions-side companion to
 * `<ClassPicker>` (M4.3.1).
 *
 * Why a separate wrapper instead of using EntityRefPicker directly:
 *   1. Hard-codes `entityLabel="dimension"` so callers don't have to
 *      remember the convention.
 *   2. Centralizes the option projection: dimension `id` →
 *      `value`, `display_name` → `label`, `slug` →
 *      `subLabel` in mono.
 *   3. Provides a single integration point when dimensions later
 *      gain a "create new dimension..." inline affordance.
 *
 * Consumed by `<FactorEditor>` when the actuary picks the
 * `lookup.direct` factor kind (M4.3.5+) — the key-input slot needs
 * a registered dimension.
 */

import {
  EntityRefPicker,
  type EntityRefOption,
  type EntityRefPickerEmptyAction,
} from "../EntityRefPicker";

/**
 * Minimal dimension shape the picker needs. Subset of whatever the
 * full Dimension shape ends up being in @openrater/contracts (slice 4
 * adds `dimensions` to the API Lab; for now consumers pass shape-
 * compatible fixtures).
 */
export interface DimensionRefOption {
  /** Stable identifier — appears in stage config_json. */
  readonly id: string;
  /** Actuary-language label (e.g., "Construction Class"). */
  readonly display_name: string;
  /** Slug form rendered in mono as subLabel (e.g.,
   *  "construction_class"). Matches the runtime input-path naming. */
  readonly slug: string;
}

export interface DimensionRefPickerProps {
  /** Available dimensions registered for this plan. */
  readonly dimensions: readonly DimensionRefOption[];
  /** Currently-selected dimension id. Empty string = unselected. */
  readonly value: string;
  /** Fires when the actuary picks a dimension. */
  readonly onChange: (dimensionId: string) => void;
  /** Empty-state handoff. Typical: jump to the Dimensions section. */
  readonly emptyAction?: EntityRefPickerEmptyAction;
  /** Override the placeholder (default: "Pick a dimension…"). */
  readonly placeholder?: string;
  /** Override the aria-label (default: "Dimension"). */
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly inputId?: string;
}

/** Project a DimensionRefOption into the EntityRefPicker shape. */
function toEntityRefOption(d: DimensionRefOption): EntityRefOption {
  return {
    value: d.id,
    label: d.display_name,
    subLabel: d.slug,
  };
}

export function DimensionRefPicker(props: DimensionRefPickerProps): JSX.Element {
  const {
    dimensions,
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
      entityLabel="dimension"
      entityLabelPlural="dimensions"
      options={dimensions.map(toEntityRefOption)}
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

export type { EntityRefPickerEmptyAction } from "../EntityRefPicker";
