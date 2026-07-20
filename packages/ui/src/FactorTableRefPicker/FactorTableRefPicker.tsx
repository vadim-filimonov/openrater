/**
 * <FactorTableRefPicker> — domain-shaped picker for factor tables.
 *
 * Same wrapping pattern as ClassPicker / DimensionRefPicker — thin
 * specialization of EntityRefPicker. Used by FactorEditor when the
 * actuary picks `lookup.direct` (the factor needs both a key
 * dimension AND a factor table to read from).
 *
 * Option projection:
 *   label    = display_name (e.g., "BOP Class Factors")
 *   subLabel = slug, mono (e.g., "sample_bop_class_factors_2026")
 *   value    = id
 */

import {
  EntityRefPicker,
  type EntityRefOption,
  type EntityRefPickerEmptyAction,
} from "../EntityRefPicker";

export interface FactorTableRefOption {
  readonly id: string;
  readonly display_name: string;
  readonly slug: string;
}

export interface FactorTableRefPickerProps {
  readonly tables: readonly FactorTableRefOption[];
  readonly value: string;
  readonly onChange: (tableId: string) => void;
  readonly emptyAction?: EntityRefPickerEmptyAction;
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly inputId?: string;
}

function toEntityRefOption(t: FactorTableRefOption): EntityRefOption {
  return {
    value: t.id,
    label: t.display_name,
    subLabel: t.slug,
  };
}

export function FactorTableRefPicker(
  props: FactorTableRefPickerProps,
): JSX.Element {
  const {
    tables,
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
      entityLabel="factor table"
      entityLabelPlural="factor tables"
      options={tables.map(toEntityRefOption)}
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
