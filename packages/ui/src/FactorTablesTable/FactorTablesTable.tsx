/**
 * <FactorTablesTable> — the Factor Tables CATALOG (Brief 67 §3.1).
 *
 * Factor tables are the rate-factor lookup tables a chain factor's
 * `lookup.direct` kind points at (e.g., "class_factor",
 * "construction_factor"). One row per registered table.
 *
 * Brief 67 inverts the section: this catalog IS the section's
 * no-param view (the old canvas/saved mode-swap died); opening a row
 * is the act that enters the full-width editor. Columns answer the
 * reader's questions in order: what is it (name), what keys it
 * (axes, in the actuary's display names — not slugs), how big is it
 * (factors), and what depends on it (used by — the same scan that
 * feeds the armed delete prompt).
 *
 * Same density DNA as <DimensionsTable> / the P3-swept tables —
 * 40px rows, eyebrow header, hairline borders.
 */

import { Pencil, Table2, Trash2 } from "lucide-react";
import { EmptyState, IconButton } from "@openrater/design-system";
import "./FactorTablesTable.css";

/**
 * One registered factor table as the catalog renders it.
 * Superset of `FactorTableRefOption` — adds optional
 * `description` + key/axes metadata for table-cell rendering.
 */
export interface FactorTableRow {
  readonly id: string;
  readonly display_name: string;
  readonly slug: string;
  /** Optional one-line description rendered under the name. */
  readonly description?: string;
  /** Optional key dimension this table is indexed by (e.g.,
   *  "class_code", "construction_class"). 1-D tables only. */
  readonly key_dimension?: string;
  /**
   * 26.P1 — Optional multi-dimension key list for 2-D / N-D
   * tables. Existing 1-D tables continue to use `key_dimension`;
   * multi-D tables set `key_dimensions: ["building_age", "class_code"]`.
   */
  readonly key_dimensions?: readonly string[];
  /**
   * Brief 67 — the axes pre-resolved to DISPLAY NAMES by the caller
   * ("Construction class × Coverage"). When present, this renders in
   * the Axes column instead of the raw key-dim slugs — the catalog
   * reads with the actuary's vocabulary.
   */
  readonly axes_label?: string;
  /** Brief 67 — authored cell count ("how big is this table"). */
  readonly cell_count?: number;
  /**
   * Brief 67 — Algorithm lookups that read this table ("Construction
   * factor · Building chain"). The catalog shows the count; the full
   * list rides the cell tooltip. Same scan feeds the delete prompt.
   */
  readonly used_by?: readonly string[];

  // ── 26.P1 — PDF ingestion reservation (Brief 26 §16 PR 10) ─────
  // Reserved for a future PDF circular ingestion pipeline. No UI
  // today; the schema reservation lets the future path write into
  // the row shape without a contract change.

  /** Lifecycle status when extracted from a PDF. Default = committed. */
  readonly draft_status?: "extracted" | "reviewed" | "committed";

  /** Source PDF URL the table was extracted from. */
  readonly source_pdf_url?: string;

  /** Page within the source PDF (1-indexed). */
  readonly source_page?: number;

  /**
   * ADR-0063 — linear interpolation flag. When present, the named banded
   * key `axis` interpolates linearly between adjacent level `lo` bounds at
   * runtime instead of stepping. Absent = step (the default for every
   * table). The projector (`stagesToRuntimePlan`) reads this to emit
   * `lookup.multi.interpolateOn`.
   */
  readonly interpolation?: { readonly mode: "linear"; readonly axis: string };
}

export interface FactorTablesTableProps {
  readonly tables: readonly FactorTableRow[];
  /**
   * Brief 67 — fires when the user opens a row (click anywhere on
   * the row; the name is the accessible button). The route navigates
   * to the editor act (?table=<id>).
   */
  readonly onOpen?: (id: string) => void;
  readonly onEdit?: (id: string) => void;
  readonly onDelete?: (id: string) => void;
  readonly renderActions?: (table: FactorTableRow) => React.ReactNode;
  /**
   * Optional CTA rendered inside the zero-tables empty state
   * (e.g., the catalog's "New table" button).
   */
  readonly emptyAction?: React.ReactNode;
  readonly testId?: string;
}

/** Resolve the Axes cell text: display-name label > raw key dims. */
function axesText(table: FactorTableRow): string | null {
  if (table.axes_label !== undefined && table.axes_label !== "") {
    return table.axes_label;
  }
  if (table.key_dimensions !== undefined && table.key_dimensions.length > 0) {
    return table.key_dimensions.join(" × ");
  }
  if (table.key_dimension !== undefined && table.key_dimension !== "") {
    return table.key_dimension;
  }
  return null;
}

export function FactorTablesTable(
  props: FactorTablesTableProps,
): JSX.Element {
  const {
    tables,
    onOpen,
    onEdit,
    onDelete,
    renderActions,
    emptyAction,
    testId = "rater-factor-tables-table",
  } = props;

  if (tables.length === 0) {
    return (
      <EmptyState
        icon={<Table2 size={24} />}
        title="No factor tables yet"
        description="Build the first one from the plan's dimensions — or import a CSV and the axes are inferred."
        testId={testId}
      >
        {emptyAction}
      </EmptyState>
    );
  }

  return (
    <table
      className="rater-factor-tables-table"
      data-testid={testId}
      role="table"
      aria-label="Factor tables"
    >
      <thead>
        <tr>
          <th scope="col" className="rater-factor-tables-table__th">
            Name
          </th>
          <th scope="col" className="rater-factor-tables-table__th">
            Keyed by
          </th>
          <th
            scope="col"
            className="rater-factor-tables-table__th rater-factor-tables-table__th--num"
          >
            Factors
          </th>
          <th scope="col" className="rater-factor-tables-table__th">
            Used by
          </th>
          <th
            scope="col"
            className="rater-factor-tables-table__th rater-factor-tables-table__th--actions"
            aria-label="Actions"
          />
        </tr>
      </thead>
      <tbody>
        {tables.map((table) => {
          const axes = axesText(table);
          const usedBy = table.used_by ?? [];
          return (
            <tr
              key={table.id}
              className={`rater-factor-tables-table__row${
                onOpen ? " rater-factor-tables-table__row--openable" : ""
              }`}
              {...(onOpen ? { onClick: () => onOpen(table.id) } : {})}
              data-testid={`${testId}-row-${table.id}`}
            >
              <td className="rater-factor-tables-table__cell rater-factor-tables-table__cell--name">
                {onOpen ? (
                  // The name is the row's ACCESSIBLE open affordance —
                  // the row onClick is the pointer convenience; keyboard
                  // users tab to this button. (Registered in the
                  // v2-buttons guard: a row opener, not a standard
                  // button.)
                  <button
                    type="button"
                    className="rater-factor-tables-table__name-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(table.id);
                    }}
                    data-testid={`${testId}-open-${table.id}`}
                  >
                    {table.display_name}
                  </button>
                ) : (
                  <div className="rater-factor-tables-table__name">
                    {table.display_name}
                  </div>
                )}
                <div className="rater-factor-tables-table__secondary">
                  {table.description !== undefined &&
                  table.description !== "" ? (
                    table.description
                  ) : (
                    <span className="rater-factor-tables-table__slug">
                      {table.slug}
                    </span>
                  )}
                </div>
              </td>
              <td className="rater-factor-tables-table__cell">
                {axes !== null ? (
                  axes
                ) : (
                  <span className="rater-factor-tables-table__muted">—</span>
                )}
              </td>
              <td className="rater-factor-tables-table__cell rater-factor-tables-table__cell--num">
                {typeof table.cell_count === "number" &&
                table.cell_count > 0 ? (
                  table.cell_count.toLocaleString()
                ) : (
                  <span className="rater-factor-tables-table__muted">—</span>
                )}
              </td>
              <td
                className="rater-factor-tables-table__cell"
                {...(usedBy.length > 0 ? { title: usedBy.join("\n") } : {})}
              >
                {usedBy.length === 0 ? (
                  <span className="rater-factor-tables-table__muted">—</span>
                ) : usedBy.length === 1 ? (
                  usedBy[0]
                ) : (
                  `${usedBy.length} lookups`
                )}
              </td>
              <td className="rater-factor-tables-table__cell rater-factor-tables-table__cell--actions">
                {renderActions ? (
                  renderActions(table)
                ) : (
                  <div className="rater-factor-tables-table__action-group">
                    {onEdit && (
                      <IconButton
                        variant="ghost"
                        size="xs"
                        aria-label={`Edit ${table.display_name}`}
                        icon={<Pencil size={13} aria-hidden />}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(table.id);
                        }}
                      />
                    )}
                    {onDelete && (
                      <IconButton
                        variant="danger-text"
                        size="xs"
                        aria-label={`Delete ${table.display_name}`}
                        icon={<Trash2 size={13} aria-hidden />}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(table.id);
                        }}
                        data-testid={`${testId}-delete-${table.id}`}
                      />
                    )}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
