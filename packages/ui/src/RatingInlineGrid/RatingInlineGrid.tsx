/**
 * <RatingInlineGrid> — Brief 82 R2 (D-B): the table editor that lives
 * INSIDE the expanded step row. 1-D tables render a level · value
 * column; 2-D tables render the full row-dim × col-dim matrix — at
 * content width (~820px) both are honest, unlike the dead 316px
 * inspector ("the compact pane can't hold a matrix honestly").
 *
 * Law 3 — every edit dispatches through `onCellChange`; the consumer
 * (the Rating mount) shapes it into the SAME factor-table write-through
 * the takeover uses. Tall grids cap and scroll; "Full screen" (in the
 * row editor's header) opens the takeover for the real estate.
 *
 * O-2 — axis names and level labels are the plan's dimension data.
 */

import type { JSX } from "react";
import "./RatingInlineGrid.css";

export interface RatingGridLevel {
  readonly id: string;
  readonly label: string;
}

export interface RatingInlineGridProps {
  /** Row axis (always present — a keyed table has ≥1 dimension). */
  readonly rowDimName: string;
  readonly rowLevels: readonly RatingGridLevel[];
  /** Column axis — omitted for 1-D tables (a single Value column). */
  readonly colDimName?: string | undefined;
  readonly colLevels?: readonly RatingGridLevel[] | undefined;
  /** cellKey(rowId, colId|null) → value (the authored sidecar). */
  readonly cells: ReadonlyMap<string, number>;
  /** The cellKey grammar (shared with the takeover + projector). */
  readonly cellKeyOf: (rowId: string, colId: string | null) => string;
  readonly onCellChange?:
    | ((rowId: string, colId: string | null, value: number) => void)
    | undefined;
  readonly testId?: string;
}

export function RatingInlineGrid(props: RatingInlineGridProps): JSX.Element {
  const {
    rowDimName,
    rowLevels,
    colDimName,
    colLevels,
    cells,
    cellKeyOf,
    onCellChange,
    testId = "rater-rating-inline-grid",
  } = props;
  const twoD = colLevels !== undefined && colLevels.length > 0;
  const readOnly = onCellChange === undefined;

  const commitCell = (
    rowId: string,
    colId: string | null,
    raw: string,
  ): void => {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) return;
    onCellChange?.(rowId, colId, n);
  };

  return (
    <div className="rater-rigrid" data-testid={testId}>
      <div className="rater-rigrid__scroll">
        <table className="rater-rigrid__table">
          <thead>
            <tr>
              <th className="rater-rigrid__corner">{rowDimName}</th>
              {twoD ? (
                colLevels.map((c) => (
                  <th key={c.id} className="rater-rigrid__colhead">
                    {c.label}
                  </th>
                ))
              ) : (
                <th className="rater-rigrid__colhead">Value</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rowLevels.map((r) => (
              <tr key={r.id}>
                <td className="rater-rigrid__rowhead">{r.label}</td>
                {(twoD ? colLevels : [null]).map((c) => {
                  const colId = c === null ? null : c.id;
                  const value = cells.get(cellKeyOf(r.id, colId));
                  return (
                    <td key={colId ?? "__value"} className="rater-rigrid__cell">
                      <input
                        className="rater-rigrid__input"
                        defaultValue={value !== undefined ? String(value) : ""}
                        inputMode="decimal"
                        disabled={readOnly}
                        aria-label={`${r.label}${
                          c !== null ? ` × ${c.label}` : ""
                        } value`}
                        onBlur={(e) => commitCell(r.id, colId, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            commitCell(
                              r.id,
                              colId,
                              (e.target as HTMLInputElement).value,
                            );
                          }
                        }}
                        data-testid={`${testId}-cell-${r.id}${
                          colId !== null ? `-${colId}` : ""
                        }`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rater-rigrid__foot">
        {rowLevels.length}
        {twoD ? ` × ${colLevels.length}` : ""} ·{" "}
        {twoD ? `${rowDimName} × ${colDimName}` : rowDimName}
        {readOnly ? " · read-only" : " · edits save as you type"}
      </p>
    </div>
  );
}
