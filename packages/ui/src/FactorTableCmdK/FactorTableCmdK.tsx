/**
 * <FactorTableCmdK> — Brief 33 PR 33.7.
 *
 * The ⌘K command palette for jumping to a specific cell in the
 * active factor table. Per Brief 33 §−1 + mockup Frame 13:
 *
 *   • Open on ⌘K (parent owns the keybinding + toggles `open`)
 *   • Type a row + col fragment ("class c103 modern") → see
 *     matching cells with their current value
 *   • Enter → jump (fires `onJumpToCell(rowId, colId)`)
 *   • ↑ ↓ navigate; Escape closes
 *
 * Matching: case-insensitive token search. Each query term must
 * match at least one of the row's id/label/sublabel OR the col's
 * id/label/sublabel. Empty query → top N cells by row order.
 *
 * Pure presentation. Parent owns:
 *   • Row + col axes (the FactorTableGrid2D shape from PR 33.3)
 *   • Current cell values (for the inline value preview)
 *   • The open/close state
 *   • The jump-to-cell handler
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  cellKey,
  type FactorTableGrid2DAxis,
  type FactorTableGrid2DAxisValue,
} from "../FactorTableGrid2D";
import "./FactorTableCmdK.css";

/** Max number of cell-matches rendered in the "Jump to cell" list. */
const MAX_CELL_MATCHES = 12;

export interface FactorTableCmdKProps {
  readonly open: boolean;
  /** Row axis (required). */
  readonly rowAxis: FactorTableGrid2DAxis;
  /** Column axis. Omit for 1-D tables. */
  readonly colAxis?: FactorTableGrid2DAxis;
  /**
   * Current cell values. Cells absent from the map render as
   * "·" in the value column.
   */
  readonly cells: ReadonlyMap<string, number>;
  /**
   * Fires when the user picks a cell. `colId` is `null` for 1-D
   * tables. The parent typically:
   *   1. Closes the palette (sets `open` to false)
   *   2. Scrolls the grid to the matching cell
   *   3. Optionally enters edit mode on it
   */
  readonly onJumpToCell: (rowId: string, colId: string | null) => void;
  /** Fires when the user clicks Escape or the backdrop. */
  readonly onClose: () => void;
  readonly testId?: string;
}

/** Normalize a string for case-insensitive token match. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Build the searchable haystack for a (rowId, colId) pair —
 * concatenation of all label forms. Used by the token-match.
 */
function cellHaystack(
  row: FactorTableGrid2DAxisValue,
  col: FactorTableGrid2DAxisValue | null,
  rowDimSlug: string,
  colDimSlug: string | null,
): string {
  const parts: string[] = [
    row.id,
    row.label,
    row.sublabel ?? "",
    rowDimSlug,
  ];
  if (col) {
    parts.push(col.id, col.label, col.sublabel ?? "");
    if (colDimSlug !== null) parts.push(colDimSlug);
  }
  return norm(parts.join(" "));
}

/**
 * Token-match: every term in the query must appear (substring) in
 * the haystack. Empty query matches all rows.
 */
function matches(haystack: string, query: string): boolean {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => haystack.includes(t));
}

interface CellMatch {
  readonly key: string;
  readonly rowId: string;
  readonly colId: string | null;
  readonly rowLabel: string;
  readonly colLabel: string | null;
  readonly value: number | undefined;
}

export function FactorTableCmdK(
  props: FactorTableCmdKProps,
): JSX.Element | null {
  const {
    open,
    rowAxis,
    colAxis,
    cells,
    onJumpToCell,
    onClose,
    testId = "rater-ft-cmdk",
  } = props;

  const [query, setQuery] = useState<string>("");
  const [focusIdx, setFocusIdx] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const is2D = colAxis !== undefined;

  // Reset on open / close (re-focus input; clear stale query).
  useEffect(() => {
    if (open) {
      setQuery("");
      setFocusIdx(0);
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open]);

  // Compute the matched cells. For 1-D we cross with a single
  // synthetic col; for 2-D every (row × col) pair is a candidate.
  const allMatches = useMemo<CellMatch[]>(() => {
    const out: CellMatch[] = [];
    const cols: ReadonlyArray<FactorTableGrid2DAxisValue | null> = is2D
      ? colAxis!.values
      : [null];
    const colDimSlug = is2D ? colAxis!.dimSlug : null;
    for (const row of rowAxis.values) {
      for (const col of cols) {
        const colId = col === null ? null : col.id;
        const hay = cellHaystack(row, col, rowAxis.dimSlug, colDimSlug);
        if (!matches(hay, query)) continue;
        out.push({
          key: cellKey(row.id, colId),
          rowId: row.id,
          colId,
          rowLabel: row.label,
          colLabel: col === null ? null : col.label,
          value: cells.get(cellKey(row.id, colId)),
        });
      }
    }
    return out.slice(0, MAX_CELL_MATCHES);
  }, [rowAxis, colAxis, cells, query, is2D]);

  // Clamp the focus index whenever the match list shrinks.
  useEffect(() => {
    if (focusIdx >= allMatches.length) {
      setFocusIdx(Math.max(0, allMatches.length - 1));
    }
  }, [allMatches.length, focusIdx]);

  const handleSubmit = useCallback(() => {
    const match = allMatches[focusIdx];
    if (!match) return;
    onJumpToCell(match.rowId, match.colId);
    onClose();
  }, [allMatches, focusIdx, onJumpToCell, onClose]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusIdx((i) => Math.min(allMatches.length - 1, i + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        handleSubmit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    },
    [allMatches.length, handleSubmit, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="rater-ft-cmdk-overlay"
      data-testid={`${testId}-overlay`}
      onClick={(e) => {
        // Click on the backdrop (not bubbled from the palette) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="rater-ft-cmdk"
        data-testid={testId}
        role="dialog"
        aria-label="Jump to cell"
      >
        <input
          ref={inputRef}
          type="text"
          className="rater-ft-cmdk-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusIdx(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            is2D
              ? `Type a row + col fragment · e.g., "${rowAxis.values[0]?.label ?? "row"} ${colAxis!.values[0]?.label ?? "col"}"`
              : `Type a ${rowAxis.dimSlug} fragment…`
          }
          aria-label="Jump-to-cell query"
          data-testid={`${testId}-input`}
        />

        <div className="rater-ft-cmdk-section">
          <div className="rater-ft-cmdk-section-label">
            Jump to cell · {allMatches.length} match
            {allMatches.length === 1 ? "" : "es"}
          </div>
          {allMatches.length === 0 ? (
            <div
              className="rater-ft-cmdk-empty"
              data-testid={`${testId}-empty`}
            >
              No cells match.
            </div>
          ) : (
            <ul className="rater-ft-cmdk-list">
              {allMatches.map((m, idx) => (
                <li
                  key={m.key}
                  className={`rater-ft-cmdk-row${
                    idx === focusIdx ? " is-focused" : ""
                  }`}
                  data-testid={`${testId}-row-${m.rowId}${
                    m.colId === null ? "" : `-${m.colId}`
                  }`}
                  onClick={() => {
                    onJumpToCell(m.rowId, m.colId);
                    onClose();
                  }}
                  onMouseEnter={() => setFocusIdx(idx)}
                >
                  <span className="rater-ft-cmdk-row-icon" aria-hidden>
                    ⌖
                  </span>
                  <span className="rater-ft-cmdk-row-label">
                    {rowAxis.dimSlug}:{m.rowLabel}
                    {m.colId !== null && (
                      <>
                        {" · "}
                        {colAxis!.dimSlug}:{m.colLabel}
                      </>
                    )}
                    {m.value !== undefined && (
                      <>
                        {" · "}
                        <strong>{m.value}</strong>
                      </>
                    )}
                  </span>
                  <span className="rater-ft-cmdk-row-coord">
                    {m.rowId}
                    {m.colId !== null && `·${m.colId}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="rater-ft-cmdk-foot"
          data-testid={`${testId}-foot`}
        >
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>⏎</kbd> jump
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
