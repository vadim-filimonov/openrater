/**
 * <LevelMappingRow> — kind-aware per-level row (Brief 26 §16 PR 6).
 *
 * One row per dimension level. The row renders different
 * affordances based on the level's `kind`:
 *
 *   • categorical → id + label + <ChipInput> alias list
 *                   ("Restaurant", "Restaurant - dine-in" → 71641)
 *   • banded      → id + label + lo/hi numeric inputs
 *   • geographic  → id + label + territory_ref (read-only chip)
 *
 * Pure controlled component:
 *   • Parent owns the level state (passes `level` prop).
 *   • `onChange(next)` fires with the updated level on every edit.
 *   • `onDelete` is optional; when supplied a trash icon renders
 *     at the right edge.
 *
 * The level's id is read-only (Brief 26 §5: "stable slug; editing
 * the label or range NEVER changes the id"). Label edits are
 * always allowed.
 */

import { useCallback, type JSX, type ChangeEvent } from "react";
import { Trash2 } from "lucide-react";
import { ChipInput } from "../ChipInput";
import "./LevelMappingRow.css";

/**
 * Lenient level shape. Mirrors the `DimensionLevel` discriminated
 * union from @openrater/contracts (26.P0), but lenient on optional
 * fields so consumers can pass partially-populated drafts.
 */
export interface LevelMappingRowLevel {
  readonly kind: "categorical" | "banded" | "geographic";
  readonly id: string;
  readonly label: string;
  readonly aliases?: readonly string[];
  readonly lo?: number;
  readonly hi?: number;
  readonly territory_ref?: string;
}

export interface LevelMappingRowProps {
  readonly level: LevelMappingRowLevel;
  readonly onChange: (next: LevelMappingRowLevel) => void;
  readonly onDelete?: () => void;
  readonly readOnly?: boolean;
  /** Optional placeholder for the alias chip-input (categorical only). */
  readonly aliasPlaceholder?: string;
  readonly testId?: string;
}

export function LevelMappingRow(props: LevelMappingRowProps): JSX.Element {
  const {
    level,
    onChange,
    onDelete,
    readOnly = false,
    aliasPlaceholder = "Type an alias…",
    testId = "rater-level-mapping-row",
  } = props;

  const setField = useCallback(
    <K extends keyof LevelMappingRowLevel>(
      key: K,
      value: LevelMappingRowLevel[K],
    ): void => {
      onChange({ ...level, [key]: value });
    },
    [level, onChange],
  );

  const handleLabelChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      setField("label", event.target.value);
    },
    [setField],
  );

  const handleAliasChange = useCallback(
    (next: readonly string[]): void => {
      onChange({ ...level, aliases: next });
    },
    [level, onChange],
  );

  const handleLoChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const raw = event.target.value;
      if (raw === "" || raw === "-") {
        setField("lo", Number.NaN);
        return;
      }
      if (raw === "-inf" || raw === "-Infinity") {
        setField("lo", Number.NEGATIVE_INFINITY);
        return;
      }
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) setField("lo", parsed);
    },
    [setField],
  );

  const handleHiChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const raw = event.target.value;
      if (raw === "" || raw === "+") {
        setField("hi", Number.NaN);
        return;
      }
      if (raw === "inf" || raw === "+inf" || raw === "Infinity") {
        setField("hi", Number.POSITIVE_INFINITY);
        return;
      }
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) setField("hi", parsed);
    },
    [setField],
  );

  return (
    <div
      className={`rater-level-mapping-row rater-level-mapping-row--${level.kind}`}
      data-testid={testId}
    >
      <div className="rater-level-mapping-row__head">
        <code className="rater-level-mapping-row__id" title={level.id}>
          {level.id}
        </code>
        <input
          type="text"
          className="rater-level-mapping-row__label-input"
          value={level.label}
          onChange={handleLabelChange}
          disabled={readOnly}
          placeholder="Label"
          aria-label={`Label for ${level.id}`}
          data-testid={`${testId}-label`}
        />
        {onDelete ? (
          <button
            type="button"
            className="rater-level-mapping-row__delete"
            onClick={onDelete}
            disabled={readOnly}
            aria-label={`Delete level ${level.label || level.id}`}
            data-testid={`${testId}-delete`}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        ) : null}
      </div>

      {level.kind === "categorical" ? (
        <div className="rater-level-mapping-row__body">
          <span className="rater-level-mapping-row__sub-label">Aliases</span>
          <ChipInput
            values={level.aliases ?? []}
            onChange={handleAliasChange}
            placeholder={aliasPlaceholder}
            ariaLabel={`Aliases for ${level.label || level.id}`}
            disabled={readOnly}
            testId={`${testId}-aliases`}
          />
          <p className="rater-level-mapping-row__hint">
            Input strings that resolve to this level. Case-insensitive +
            trimmed exact match. The level id ({level.id}) is implicitly
            an alias.
          </p>
        </div>
      ) : null}

      {level.kind === "banded" ? (
        <div className="rater-level-mapping-row__body rater-level-mapping-row__body--banded">
          <span className="rater-level-mapping-row__sub-label">Range</span>
          <div className="rater-level-mapping-row__range">
            <input
              type="text"
              inputMode="decimal"
              className="rater-level-mapping-row__range-input"
              value={
                level.lo === Number.NEGATIVE_INFINITY
                  ? "-inf"
                  : Number.isFinite(level.lo)
                    ? String(level.lo)
                    : ""
              }
              onChange={handleLoChange}
              disabled={readOnly}
              aria-label={`Lower bound for ${level.label || level.id}`}
              data-testid={`${testId}-lo`}
            />
            <span
              className="rater-level-mapping-row__range-sep"
              aria-hidden
            >
              ≤ x &lt;
            </span>
            <input
              type="text"
              inputMode="decimal"
              className="rater-level-mapping-row__range-input"
              value={
                level.hi === Number.POSITIVE_INFINITY
                  ? "inf"
                  : Number.isFinite(level.hi)
                    ? String(level.hi)
                    : ""
              }
              onChange={handleHiChange}
              disabled={readOnly}
              aria-label={`Upper bound for ${level.label || level.id}`}
              data-testid={`${testId}-hi`}
            />
          </div>
          <p className="rater-level-mapping-row__hint">
            Half-open interval [lo, hi). Use “-inf” / “inf” for open ends.
          </p>
        </div>
      ) : null}

      {level.kind === "geographic" ? (
        <div className="rater-level-mapping-row__body">
          <span className="rater-level-mapping-row__sub-label">Territory</span>
          <code
            className="rater-level-mapping-row__territory-ref"
            data-testid={`${testId}-territory-ref`}
          >
            {level.territory_ref ?? "(no ref)"}
          </code>
          <p className="rater-level-mapping-row__hint">
            Geographic mapping lives in the Territories editor.
          </p>
        </div>
      ) : null}
    </div>
  );
}
