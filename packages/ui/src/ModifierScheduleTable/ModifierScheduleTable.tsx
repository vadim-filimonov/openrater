/**
 * <ModifierScheduleTable> — one IRPM-style schedule definition.
 *
 * Brief 15 (Modifiers section). Renders the SCHEDULE the actuary
 * authors at plan-author time — the per-category range structure
 * + total cap. Per-risk values (what an underwriter authors for a
 * specific submission) are NOT shown here — those live in the
 * runtime/runner UI.
 *
 * One ModifierScheduleTable = one `Schedule` (one modifier.schedule
 * stage's config). The section pane renders N tables when the plan
 * has multiple modifier schedules (e.g., per-coverage or per-LOB).
 *
 * Read-only for M4.7. The onEdit / onDelete callbacks per category
 * are scaffolded for future CRUD wire.
 *
 * Layout (cold-test motivated):
 *   ┌──────────────────────────────────────────────┐
 *   │ Property schedule mod         ±25% total     │  ← header
 *   │ ────────────────────────────────────────────  │
 *   │ Management experience    ±5%    citation     │
 *   │ Employees                ±5%                  │
 *   │ Premises                 ±5%                  │
 *   │ Equipment                ±5%                  │
 *   │ Cooperation programs     ±5%                  │
 *   │ ────────────────────────────────────────────  │
 *   │ Citation: Meridian BOP §4.2                        │
 *   └──────────────────────────────────────────────┘
 */

import { Pencil, Trash2 } from "lucide-react";
import "./ModifierScheduleTable.css";

/**
 * One category row in the schedule. Matches @openrater/contracts'
 * `ScheduleCategory` (subset — the table doesn't care about
 * tier_filter at render-time today; the UI for that lands when
 * Brief 10 Eligibility tiers wire in).
 */
export interface ModifierScheduleCategoryRow {
  readonly category_id: string;
  readonly name: string;
  /** ±N% range. Rendered as "±5%". */
  readonly range_pct: number;
  /** True when reasoning is required for non-zero values. */
  readonly reasoning_required: boolean;
  /** Optional per-category citation/note. */
  readonly note?: string;
}

export interface ModifierScheduleTableProps {
  /** Display name of the schedule (e.g., "Property schedule mod"). */
  readonly displayName: string;
  /** Filed total cap (e.g., 25 → "±25%"). */
  readonly totalCapPct: number;
  /** Ordered categories. */
  readonly categories: readonly ModifierScheduleCategoryRow[];
  /** Optional citation to the filed schedule (e.g., "Meridian BOP §4.2"). */
  readonly citation?: string;
  /** Optional scope label rendered in the header (e.g., "per coverage"). */
  readonly scopeLabel?: string;
  /** Optional click handler per category — opens the edit drawer. */
  readonly onEditCategory?: (categoryId: string) => void;
  /** Optional delete handler per category. */
  readonly onDeleteCategory?: (categoryId: string) => void;
  /** Optional "Add category" click handler. */
  readonly onAddCategory?: () => void;
  readonly testId?: string;
}

export function ModifierScheduleTable(
  props: ModifierScheduleTableProps,
): JSX.Element {
  const {
    displayName,
    totalCapPct,
    categories,
    citation,
    scopeLabel,
    onEditCategory,
    onDeleteCategory,
    onAddCategory,
    testId = "rater-modifier-schedule-table",
  } = props;

  return (
    <article
      className="rater-modifier-schedule-table"
      data-testid={testId}
      aria-label={`Modifier schedule: ${displayName}`}
    >
      <header className="rater-modifier-schedule-table__header">
        <div className="rater-modifier-schedule-table__title-block">
          <h3 className="rater-modifier-schedule-table__title">
            {displayName}
          </h3>
          {scopeLabel !== undefined && scopeLabel !== "" && (
            <span className="rater-modifier-schedule-table__scope">
              {scopeLabel}
            </span>
          )}
        </div>
        <span
          className="rater-modifier-schedule-table__cap"
          aria-label={`Total cap: ±${totalCapPct}%`}
        >
          ±{totalCapPct}% cap
        </span>
      </header>

      {categories.length === 0 ? (
        <div className="rater-modifier-schedule-table__empty" role="status">
          No categories yet. Add one to start building the schedule.
        </div>
      ) : (
        <ul className="rater-modifier-schedule-table__categories" role="list">
          {categories.map((cat) => (
            <li
              key={cat.category_id}
              className="rater-modifier-schedule-table__category"
            >
              <div className="rater-modifier-schedule-table__category-main">
                <span className="rater-modifier-schedule-table__category-name">
                  {cat.name}
                </span>
                {cat.note !== undefined && cat.note !== "" && (
                  <span className="rater-modifier-schedule-table__category-note">
                    {cat.note}
                  </span>
                )}
              </div>
              <span className="rater-modifier-schedule-table__category-range">
                ±{cat.range_pct}%
              </span>
              {cat.reasoning_required && (
                <span
                  className="rater-modifier-schedule-table__category-reasoning"
                  aria-label="Reasoning required"
                  title="Reasoning required for non-zero values"
                >
                  reason req.
                </span>
              )}
              <div className="rater-modifier-schedule-table__category-actions">
                {onEditCategory && (
                  <button
                    type="button"
                    className="rater-modifier-schedule-table__action"
                    onClick={() => onEditCategory(cat.category_id)}
                    aria-label={`Edit ${cat.name}`}
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                )}
                {onDeleteCategory && (
                  <button
                    type="button"
                    className="rater-modifier-schedule-table__action rater-modifier-schedule-table__action--danger"
                    onClick={() => onDeleteCategory(cat.category_id)}
                    aria-label={`Delete ${cat.name}`}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(citation !== undefined && citation !== "") || onAddCategory ? (
        <footer className="rater-modifier-schedule-table__footer">
          {citation !== undefined && citation !== "" ? (
            <span className="rater-modifier-schedule-table__citation">
              Citation: {citation}
            </span>
          ) : (
            <span />
          )}
          {onAddCategory && (
            <button
              type="button"
              className="rater-modifier-schedule-table__add"
              onClick={onAddCategory}
            >
              + Add category
            </button>
          )}
        </footer>
      ) : null}
    </article>
  );
}
