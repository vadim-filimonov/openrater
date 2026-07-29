/**
 * <FactorTableGrid2D> — Brief 33 PR 33.3 + PR 33.4.
 *
 * The materialized 2-D grid that replaces the axis-drop frame inside
 * <FactorTableNode> once the user clicks Generate. Also handles the
 * 1-D case (single axis) — render passes `colAxis: undefined`.
 *
 * Visual contract (matches the polished mockup at
 * `/mockup/33-parametrize-as-canvas.html`, Frame 5 + Frame 7):
 *
 *   ┌────────────┬───────────────────────────────┐
 *   │ corner     │ col_h | col_h | col_h | col_h │   ← sticky col header
 *   ├────────────┼───────┼───────┼───────┼───────┤
 *   │ row_h      │ cell  | cell  | cell  | cell  │
 *   │ row_h      │ cell  | cell  | cell  | cell  │   ← sticky row header
 *   │ row_h      │ cell  | cell  | cell  | cell  │     (left edge)
 *   └────────────┴───────┴───────┴───────┴───────┘
 *
 * State-per-cell (via CSS class):
 *   • is-default       — value === 1 (faint azure tint)
 *   • is-pending       — value differs from server (orange + ★)
 *   • is-focused       — currently being edited
 *   • is-selected      — part of the active selection (PR 33.4)
 *   • is-cross-focused — currently focused via cross-highlight from
 *     the chart side of the split view (Brief 34 PR 34.5)
 *
 * PR 33.4 — Selection model (controlled, parent owns).
 *
 *   • Click cell (no modifier)  → single-cell selection on that cell
 *   • Click cell with Shift     → extend rect selection from anchor
 *   • Click cell with ⌘/Ctrl    → toggle cell in selection
 *                                 (discontiguous)
 *   • Double-click cell         → enter edit mode (existing flow)
 *   • Enter on selected cell    → enter edit mode
 *   • Click row header          → select all cells in that row
 *   • Click col header          → select all cells in that col
 *   • Click corner              → select all cells
 *   • Escape                    → clear selection
 *
 * Pure presentation. Parent owns:
 *   • Axes (row + optional col)
 *   • Cell values (Map<key, number>)
 *   • Edit handler
 *   • Selection (controlled prop) + selection-change handler
 *
 * Column virtualization: we render every column above the visible
 * viewport via the same scroll-window trick FactorTableGrid uses for
 * rows. Threshold: `COL_VIRTUALIZE_THRESHOLD = 50`. Below that we
 * render every column (no perf gain to chase).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import "./FactorTableGrid2D.css";

/** Threshold above which we virtualize columns. */
export const COL_VIRTUALIZE_THRESHOLD = 50;

/** A single axis value — typically derived from a DimensionRow level. */
export interface FactorTableGrid2DAxisValue {
  /** Stable id used as the cell key component. e.g., "frame", "band_0_5". */
  readonly id: string;
  /** Display label. e.g., "Frame", "New". */
  readonly label: string;
  /** Mono sub-label rendered under/beside the main label. Falls back to `id`. */
  readonly sublabel?: string;
}

/** Axis descriptor — paired with the axis dim's slug. */
export interface FactorTableGrid2DAxis {
  /** Dim slug — the machine identity (cell keys, testids). */
  readonly dimSlug: string;
  /** Brief 67 §3.5 — the dim's DISPLAY name; the corner cell prefers
   *  it over the slug so the grid reads in the actuary's vocabulary. */
  readonly dimLabel?: string;
  /** Ordered list of values. */
  readonly values: readonly FactorTableGrid2DAxisValue[];
}

/**
 * Build the cell-key for a coordinate pair. 1-D tables use only the
 * row id; 2-D use "row::col". Exported so callers can write cells
 * into the Map with the same convention.
 */
export function cellKey(rowId: string, colId: string | null): string {
  return colId === null ? rowId : `${rowId}::${colId}`;
}

export interface FactorTableGrid2DProps {
  /** Row axis. Required. */
  readonly rowAxis: FactorTableGrid2DAxis;
  /**
   * Column axis. Omit for a 1-D table — the grid renders a single
   * "Factor" column header in that case.
   */
  readonly colAxis?: FactorTableGrid2DAxis;
  /**
   * Cell values keyed by `cellKey(rowId, colId)`. Cells absent from
   * the map are rendered as empty (italic placeholder).
   */
  readonly cells: ReadonlyMap<string, number>;
  /**
   * Fires when the user commits a cell edit (blur or Enter). `colId`
   * is `null` for 1-D tables. The parent computes the next Map state.
   */
  readonly onCellEdit?: (rowId: string, colId: string | null, value: number) => void;
  /**
   * Optional cells-pending set: keys (cellKey format) whose values
   * differ from what's saved server-side. Receives the orange "*"
   * tint. Plumbing for Brief 18's Save flow — defaults to none.
   */
  readonly pendingKeys?: ReadonlySet<string>;
  /**
   * PR 33.4 — Controlled selection set: cellKey strings that are
   * currently selected. Cells in this set receive the `is-selected`
   * class (azure outline + soft fill). When omitted, the grid
   * behaves as if no cells are selected and the selection handlers
   * are no-ops.
   */
  readonly selectedCells?: ReadonlySet<string>;
  /**
   * PR 33.4 — Fires when the user changes selection via clicks,
   * row/col-header clicks, corner click, or Escape. The parent
   * is responsible for applying the next set (controlled).
   */
  readonly onSelectionChange?: (next: Set<string>) => void;
  /**
   * Brief 34 PR 34.5 — Cross-highlight focus key (cellKey format).
   * When provided, the matching cell + its row + col headers get
   * the `is-cross-focused` / `is-tinted` classes. Drives cross-
   * highlight FROM the chart side of the split view; the parent
   * routes hover state between chart and grid.
   */
  readonly focusedKey?: string;
  /**
   * Brief 34 PR 34.5 — Fires when the user hovers a cell. The
   * parent debounces (per Brief 34 §5.1's 100ms guidance) and
   * pushes the resulting focusedKey into the chart side of the
   * split view, so hover crosses the chart/grid boundary.
   *
   * The grid emits raw cell-hover events; debouncing belongs in
   * the orchestrator (<FactorTableViz>) so that local hover
   * affordances stay snappy and only the cross-pane signal is
   * delayed.
   */
  readonly onHoverChange?: (key: string | null) => void;
  /** Read-only mode disables edit. Defaults to false. */
  readonly readOnly?: boolean;
  readonly testId?: string;
}

interface EditingState {
  readonly rowId: string;
  readonly colId: string | null;
  readonly draft: string;
}

/**
 * Render a faint-azure tint when value is exactly 1.0 (the
 * multiplicative identity). Brief 33 §−1 calls this "default tint".
 */
function isDefaultValue(v: number | undefined): boolean {
  return v === 1;
}

/**
 * Parse a user-typed cell string. Accepts numeric input only; non-
 * numeric input returns `null` so the caller can refuse the commit.
 */
function parseCellInput(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Format a numeric cell for display at the grid's shared precision.
 *  FCA #35 (finding 14) — trailing zeros were trimmed per cell, so
 *  one column mixed "0.9" with "0.92" and a bare "1" sat among
 *  factors; filed tables print uniform precision (Exhibits already
 *  does). The grid's decimals = the widest fraction any cell carries
 *  (cap 3, the old max); an all-integer grid stays integer. */
function formatCell(value: number, gridDecimals: number): string {
  return value.toFixed(gridDecimals);
}

/** The widest decimal-fraction width across the grid's cells (≤3). */
function decimalsOf(cells: ReadonlyMap<string, number>): number {
  let widest = 0;
  for (const v of cells.values()) {
    if (!Number.isFinite(v)) continue;
    const s = String(v);
    const dot = s.indexOf(".");
    if (dot === -1) continue;
    widest = Math.max(widest, Math.min(s.length - dot - 1, 3));
    if (widest === 3) break;
  }
  return widest;
}

/** Frozen empty set — reused when no selection prop is provided. */
const EMPTY_SET: ReadonlySet<string> = new Set();

/** Build the cell-key set for an entire row (one entry per col). */
function selectAllInRow(
  rowId: string,
  colValues: readonly FactorTableGrid2DAxisValue[],
  is2D: boolean,
): Set<string> {
  const next = new Set<string>();
  if (!is2D) {
    next.add(cellKey(rowId, null));
    return next;
  }
  for (const c of colValues) next.add(cellKey(rowId, c.id));
  return next;
}

/** Build the cell-key set for an entire column (one entry per row). */
function selectAllInCol(
  colId: string,
  rowValues: readonly FactorTableGrid2DAxisValue[],
): Set<string> {
  const next = new Set<string>();
  for (const r of rowValues) next.add(cellKey(r.id, colId));
  return next;
}

/** Build the cell-key set for the entire grid. */
function selectAllCells(
  rowValues: readonly FactorTableGrid2DAxisValue[],
  colValues: readonly FactorTableGrid2DAxisValue[],
  is2D: boolean,
): Set<string> {
  const next = new Set<string>();
  if (!is2D) {
    for (const r of rowValues) next.add(cellKey(r.id, null));
    return next;
  }
  for (const r of rowValues) {
    for (const c of colValues) next.add(cellKey(r.id, c.id));
  }
  return next;
}

/**
 * Build the rectangular cell-key set bounded by two axis indices on
 * each axis. Both bounds are inclusive; order doesn't matter.
 */
function selectRect(
  rowValues: readonly FactorTableGrid2DAxisValue[],
  colValues: readonly FactorTableGrid2DAxisValue[],
  is2D: boolean,
  r1: number,
  r2: number,
  c1: number,
  c2: number,
): Set<string> {
  const rStart = Math.min(r1, r2);
  const rEnd = Math.max(r1, r2);
  const cStart = Math.min(c1, c2);
  const cEnd = Math.max(c1, c2);
  const next = new Set<string>();
  if (!is2D) {
    for (let i = rStart; i <= rEnd; i++) {
      const row = rowValues[i];
      if (row) next.add(cellKey(row.id, null));
    }
    return next;
  }
  for (let i = rStart; i <= rEnd; i++) {
    const row = rowValues[i];
    if (!row) continue;
    for (let j = cStart; j <= cEnd; j++) {
      const col = colValues[j];
      if (col) next.add(cellKey(row.id, col.id));
    }
  }
  return next;
}

export function FactorTableGrid2D(
  props: FactorTableGrid2DProps,
): JSX.Element {
  const {
    rowAxis,
    colAxis,
    cells,
    onCellEdit,
    pendingKeys,
    selectedCells,
    onSelectionChange,
    focusedKey,
    onHoverChange,
    readOnly = false,
    testId = "rater-ft-grid-2d",
  } = props;
  // Hoist controlled selection into the local closure with a sane
  // default. Empty set when no controlled prop. Falls back to a
  // no-op handler when the parent didn't subscribe.
  const sel: ReadonlySet<string> = selectedCells ?? EMPTY_SET;
  const fireSelectionChange = useCallback(
    (next: Set<string>) => onSelectionChange?.(next),
    [onSelectionChange],
  );

  // PR 33.4 — Anchor cell for shift-click rect-extension. Tracks the
  // last cell clicked WITHOUT shift; shift-click extends a rectangle
  // from that anchor. The grid forgets the anchor when selection
  // clears entirely.
  const [anchor, setAnchor] = useState<{
    readonly rowId: string;
    readonly colId: string | null;
  } | null>(null);

  const rowCount = rowAxis.values.length;
  const colCount = colAxis?.values.length ?? 1;
  const is2D = colAxis !== undefined;

  // ── Brief 34 PR 34.5 — Cross-highlight focus derivation ─────────
  // Decompose focusedKey into rowId + colId so row/col headers can
  // tint without the cells themselves having to do extra work.
  const focusedRowId = useMemo<string | null>(() => {
    if (!focusedKey) return null;
    return focusedKey.includes("::")
      ? focusedKey.split("::")[0]!
      : focusedKey;
  }, [focusedKey]);
  const focusedColId = useMemo<string | null>(() => {
    if (!focusedKey) return null;
    return focusedKey.includes("::")
      ? focusedKey.split("::")[1]!
      : null;
  }, [focusedKey]);

  const handleCellMouseEnter = useCallback(
    (rowId: string, colId: string | null) => {
      onHoverChange?.(cellKey(rowId, colId));
    },
    [onHoverChange],
  );
  const handleCellMouseLeave = useCallback(() => {
    onHoverChange?.(null);
  }, [onHoverChange]);

  // ── Column virtualization ────────────────────────────────────────
  // Mirror FactorTableGrid's row-virtualization: when we cross the
  // threshold we maintain a scroll-window of visible col indices and
  // pad the headers/body with spacer divs on either side. For the
  // first pass we render every col but lay the API hooks in so the
  // upgrade is a follow-up.
  const shouldVirtualizeCols = colCount > COL_VIRTUALIZE_THRESHOLD;
  const visibleColRange = useMemo(
    () => ({ start: 0, end: colCount }),
    [colCount],
  );

  // FCA #35 — one display precision for the whole grid (see
  // formatCell): the widest fraction any cell carries, capped at 3.
  const gridDecimals = useMemo(() => decimalsOf(cells), [cells]);

  // ── Edit state ───────────────────────────────────────────────────
  const [editing, setEditing] = useState<EditingState | null>(null);
  // Synchronous mirror — the keyboard layer focuses the grid container
  // right after commit/cancel, which fires the input's blur BEFORE the
  // state update lands. The blur handler consults this ref so a
  // canceled (or already-committed) edit can never re-commit stale.
  const editingRef = useRef<EditingState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the input + select its content when editing begins.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const beginEdit = useCallback(
    (
      rowId: string,
      colId: string | null,
      currentValue: number | undefined,
      draftSeed?: string,
    ) => {
      if (readOnly) return;
      const next: EditingState = {
        rowId,
        colId,
        // Seed from the RAW stored value — formatCell renders max 3dp
        // for the grid, but a 1.0125 must not become 1.013 just
        // because the cell was opened and committed.
        draft:
          draftSeed !== undefined
            ? draftSeed
            : currentValue !== undefined
              ? String(currentValue)
              : "",
      };
      editingRef.current = next;
      setEditing(next);
    },
    [readOnly],
  );

  const commitEdit = useCallback(
    (next: EditingState | null) => {
      const current = editingRef.current;
      editingRef.current = next;
      if (!current) {
        setEditing(next);
        return;
      }
      const parsed = parseCellInput(current.draft);
      if (parsed !== null) {
        onCellEdit?.(current.rowId, current.colId, parsed);
      }
      setEditing(next);
    },
    [onCellEdit],
  );

  const cancelEdit = useCallback(() => {
    editingRef.current = null;
    setEditing(null);
  }, []);

  // ── Brief 67 §3.2 — the keyboard layer (the spreadsheet contract) ──
  //
  // The grid container owns a roving active cell (the selection
  // anchor). Arrows move it, Shift+arrows extend the rect, Enter
  // opens the edit, typing a digit REPLACES (no double-click hunt),
  // and a committing Enter advances down — the muscle memory every
  // actuary brings from Excel. Implemented Excel-faithfully: click
  // selects; one keystroke begins the edit.
  const gridRef = useRef<HTMLDivElement | null>(null);

  /** Resolve the anchor to grid indices ({-1,-1} when unset). */
  const anchorIndices = useCallback((): { rIdx: number; cIdx: number } => {
    if (!anchor) return { rIdx: -1, cIdx: -1 };
    const rIdx = rowAxis.values.findIndex((r) => r.id === anchor.rowId);
    const cIdx =
      is2D && anchor.colId !== null
        ? colAxis!.values.findIndex((c) => c.id === anchor.colId)
        : 0;
    return { rIdx, cIdx: cIdx < 0 ? 0 : cIdx };
  }, [anchor, rowAxis, colAxis, is2D]);

  /** Move the active cell to (rIdx, cIdx), clamped; single-select it. */
  const moveActive = useCallback(
    (rIdx: number, cIdx: number) => {
      const r = Math.max(0, Math.min(rowCount - 1, rIdx));
      const c = Math.max(0, Math.min(colCount - 1, cIdx));
      const row = rowAxis.values[r];
      if (!row) return;
      const colId = is2D ? (colAxis!.values[c]?.id ?? null) : null;
      setAnchor({ rowId: row.id, colId });
      fireSelectionChange(new Set([cellKey(row.id, colId)]));
      // Scroll-follow: arrowing or Enter-advancing past the fold must
      // not walk the active cell off-screen (the 300-row table is the
      // bar). rAF: the ring class lands after this state flush.
      requestAnimationFrame(() => {
        gridRef.current
          ?.querySelector('[data-active="true"]')
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [rowCount, colCount, rowAxis, colAxis, is2D, fireSelectionChange],
  );

  /** Commit the in-flight edit, then advance the active cell. */
  const commitAndAdvance = useCallback(
    (dRow: number, dCol: number) => {
      if (!editing) return;
      const rIdx = rowAxis.values.findIndex((r) => r.id === editing.rowId);
      const cIdx =
        is2D && editing.colId !== null
          ? colAxis!.values.findIndex((c) => c.id === editing.colId)
          : 0;
      commitEdit(null);
      moveActive(rIdx + dRow, cIdx + dCol);
      // Return focus to the grid so the keyboard layer continues.
      gridRef.current?.focus();
    },
    [editing, rowAxis, colAxis, is2D, commitEdit, moveActive],
  );

  const handleCellKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        // Enter commits AND advances (down; Shift+Enter up).
        commitAndAdvance(event.shiftKey ? -1 : 1, 0);
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelEdit();
        gridRef.current?.focus();
      } else if (event.key === "Tab") {
        // Tab commits and advances right (Shift+Tab left) — the
        // edit stays inside the grid instead of tabbing out.
        event.preventDefault();
        commitAndAdvance(0, event.shiftKey ? -1 : 1);
      }
    },
    [commitAndAdvance, cancelEdit],
  );

  // ── PR 33.4 — Selection click handlers ───────────────────────────
  //
  // Click on a cell:
  //   bare        → single-cell selection (replace), set anchor
  //   shift       → rect selection from anchor (replace) — if no
  //                 anchor yet, anchor is the clicked cell
  //   meta/ctrl   → toggle cell in current selection (preserve)
  //
  // Click on a row header → select all cells in that row (replace)
  // Click on a col header → select all cells in that col (replace)
  // Click on the corner   → select every cell in the grid (replace)
  //
  // All handlers are no-ops when `onSelectionChange` isn't provided.

  const handleCellClick = useCallback(
    (
      event: ReactMouseEvent<HTMLDivElement>,
      row: FactorTableGrid2DAxisValue,
      colId: string | null,
      rIdx: number,
      cIdx: number,
    ) => {
      if (!onSelectionChange) return;
      const key = cellKey(row.id, colId);
      if (event.shiftKey) {
        // Rect-extend from anchor (or current cell if no anchor yet).
        const anchorRowIdx = anchor
          ? rowAxis.values.findIndex((r) => r.id === anchor.rowId)
          : rIdx;
        const anchorColIdx = anchor
          ? (() => {
              if (anchor.colId === null) return 0;
              return colAxis
                ? colAxis.values.findIndex((c) => c.id === anchor.colId)
                : 0;
            })()
          : cIdx;
        const colValues = colAxis?.values ?? [];
        const rect = selectRect(
          rowAxis.values,
          colValues,
          is2D,
          anchorRowIdx,
          rIdx,
          anchorColIdx,
          cIdx,
        );
        fireSelectionChange(rect);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        // Toggle this cell in the current selection.
        const next = new Set(sel);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        setAnchor({ rowId: row.id, colId });
        fireSelectionChange(next);
        return;
      }
      // Single-cell selection.
      setAnchor({ rowId: row.id, colId });
      fireSelectionChange(new Set([key]));
    },
    [
      onSelectionChange,
      fireSelectionChange,
      anchor,
      rowAxis,
      colAxis,
      is2D,
      sel,
    ],
  );

  const handleCellDoubleClick = useCallback(
    (row: FactorTableGrid2DAxisValue, colId: string | null) => {
      const key = cellKey(row.id, colId);
      const value = cells.get(key);
      beginEdit(row.id, colId, value);
    },
    [beginEdit, cells],
  );

  const handleRowHeaderClick = useCallback(
    (row: FactorTableGrid2DAxisValue) => {
      if (!onSelectionChange) return;
      const colValues = colAxis?.values ?? [];
      const next = selectAllInRow(row.id, colValues, is2D);
      setAnchor({ rowId: row.id, colId: is2D ? colValues[0]?.id ?? null : null });
      fireSelectionChange(next);
    },
    [onSelectionChange, fireSelectionChange, colAxis, is2D],
  );

  const handleColHeaderClick = useCallback(
    (col: FactorTableGrid2DAxisValue) => {
      if (!onSelectionChange) return;
      const next = selectAllInCol(col.id, rowAxis.values);
      setAnchor({ rowId: rowAxis.values[0]?.id ?? "", colId: col.id });
      fireSelectionChange(next);
    },
    [onSelectionChange, fireSelectionChange, rowAxis],
  );

  const handleCornerClick = useCallback(() => {
    if (!onSelectionChange) return;
    const colValues = colAxis?.values ?? [];
    const next = selectAllCells(rowAxis.values, colValues, is2D);
    setAnchor(null);
    fireSelectionChange(next);
  }, [onSelectionChange, fireSelectionChange, rowAxis, colAxis, is2D]);

  // Brief 67 walkthrough fix — PASTE from a spreadsheet. TSV (and
  // single-column) clipboard text lands row-major from the ACTIVE
  // cell; values outside the grid or non-numeric are skipped (the
  // same honesty rule as the CSV preview). The pasted rect becomes
  // the selection — visible confirmation of exactly what landed.
  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (readOnly || !onCellEdit || editing) return;
      if (!anchor) return;
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      const rows = text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => line.split("\t"));
      const { rIdx, cIdx } = anchorIndices();
      if (rIdx < 0) return;
      const landed = new Set<string>();
      rows.forEach((cols, dRow) => {
        cols.forEach((raw, dCol) => {
          const r = rIdx + dRow;
          const c = cIdx + dCol;
          if (r >= rowCount || c >= colCount) return;
          const value = parseCellInput(raw);
          if (value === null) return;
          const row = rowAxis.values[r];
          if (!row) return;
          const colId = is2D ? (colAxis!.values[c]?.id ?? null) : null;
          onCellEdit(row.id, colId, value);
          landed.add(cellKey(row.id, colId));
        });
      });
      if (landed.size > 0) fireSelectionChange(landed);
    },
    [
      readOnly,
      onCellEdit,
      editing,
      anchor,
      anchorIndices,
      rowCount,
      colCount,
      rowAxis,
      colAxis,
      is2D,
      fireSelectionChange,
    ],
  );

  // ⌘C — serialize the selection's bounding rect as TSV (the inverse
  // of paste; unselected cells inside the rect export empty).
  const handleCopySelection = useCallback(() => {
    if (sel.size === 0) return;
    const colValues = colAxis?.values ?? [];
    let loR = Infinity, hiR = -1, loC = Infinity, hiC = -1;
    for (const key of sel) {
      const [rowId, colId] = key.includes("::")
        ? (key.split("::") as [string, string])
        : [key, null];
      const r = rowAxis.values.findIndex((x) => x.id === rowId);
      const c = colId === null ? 0 : colValues.findIndex((x) => x.id === colId);
      if (r >= 0) { loR = Math.min(loR, r); hiR = Math.max(hiR, r); }
      if (c >= 0) { loC = Math.min(loC, c); hiC = Math.max(hiC, c); }
    }
    if (hiR < 0) return;
    const lines: string[] = [];
    for (let r = loR; r <= hiR; r++) {
      const cells_: string[] = [];
      for (let c = loC; c <= hiC; c++) {
        const row = rowAxis.values[r]!;
        const colId = is2D ? (colValues[c]?.id ?? null) : null;
        const v = cells.get(cellKey(row.id, colId));
        cells_.push(v === undefined ? "" : String(v));
      }
      lines.push(cells_.join("\t"));
    }
    void navigator.clipboard?.writeText(lines.join("\n"));
  }, [sel, rowAxis, colAxis, is2D, cells]);

  // The container keyboard layer. While a cell edit is open, its
  // input owns the keys (events bubble here — bail). Otherwise:
  // arrows rove, Shift+arrows extend, Enter edits, digits replace,
  // ⌘C copies the selection, Escape clears it.
  const handleGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (editing) return;
      if (event.key === "Escape" && sel.size > 0) {
        event.preventDefault();
        fireSelectionChange(new Set());
        setAnchor(null);
        return;
      }
      if (!onSelectionChange) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        handleCopySelection();
        return;
      }
      const ARROWS: Record<string, readonly [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const delta = ARROWS[event.key];
      if (delta) {
        event.preventDefault();
        const { rIdx, cIdx } = anchorIndices();
        if (rIdx < 0) {
          // Nothing active yet — land on the first cell.
          moveActive(0, 0);
          return;
        }
        if (event.shiftKey) {
          // Extend the rect from the anchor to the moved corner.
          // The anchor stays put; the selection rect grows/shrinks
          // toward the cursor — derived from the current rect edge
          // farthest from the anchor in the move direction.
          const colValues = colAxis?.values ?? [];
          // Find the current rect extent from the selection.
          let loR = rIdx, hiR = rIdx, loC = cIdx, hiC = cIdx;
          for (const key of sel) {
            const [rowId, colId] = key.includes("::")
              ? (key.split("::") as [string, string])
              : [key, null];
            const r = rowAxis.values.findIndex((x) => x.id === rowId);
            const c =
              colId === null
                ? 0
                : colValues.findIndex((x) => x.id === colId);
            if (r >= 0) {
              loR = Math.min(loR, r);
              hiR = Math.max(hiR, r);
            }
            if (c >= 0) {
              loC = Math.min(loC, c);
              hiC = Math.max(hiC, c);
            }
          }
          // Move the edge opposite the anchor.
          const [dR, dC] = delta;
          const curR = dR < 0 ? loR : dR > 0 ? hiR : null;
          const curC = dC < 0 ? loC : dC > 0 ? hiC : null;
          const nextR =
            curR === null
              ? rIdx
              : Math.max(0, Math.min(rowCount - 1, curR + dR));
          const nextC =
            curC === null
              ? cIdx
              : Math.max(0, Math.min(colCount - 1, curC + dC));
          const rect = selectRect(
            rowAxis.values,
            colValues,
            is2D,
            rIdx,
            nextR,
            cIdx,
            nextC,
          );
          fireSelectionChange(rect);
          return;
        }
        moveActive(rIdx + delta[0], cIdx + delta[1]);
        return;
      }
      if (event.key === "Enter" && anchor && !readOnly) {
        event.preventDefault();
        const key = cellKey(anchor.rowId, anchor.colId);
        beginEdit(anchor.rowId, anchor.colId, cells.get(key));
        return;
      }
      // Type-to-replace: a digit / sign / dot on the active cell
      // opens the edit ALREADY containing the keystroke.
      if (
        anchor &&
        !readOnly &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        /^[0-9.-]$/.test(event.key)
      ) {
        event.preventDefault();
        beginEdit(anchor.rowId, anchor.colId, undefined, event.key);
      }
    },
    [
      editing,
      sel,
      fireSelectionChange,
      onSelectionChange,
      anchorIndices,
      moveActive,
      anchor,
      readOnly,
      cells,
      beginEdit,
      rowAxis,
      colAxis,
      is2D,
      rowCount,
      colCount,
      handleCopySelection,
    ],
  );

  // ── Style overrides — col + row count drive CSS grid templates ───
  // We piggyback on CSS custom properties so the grid-template is
  // declared once in the stylesheet (no inline grid-template).
  const styleVars: Record<string, string> = {
    "--ft-grid-2d-col-count": String(colCount),
    "--ft-grid-2d-row-count": String(rowCount),
  };

  // Corner label — display names when provided (Brief 67 §3.5: the
  // grid reads in the actuary's vocabulary), slugs as fallback.
  const rowAxisName = rowAxis.dimLabel ?? rowAxis.dimSlug;
  const cornerLabel = is2D
    ? `${rowAxisName} · ${colAxis!.dimLabel ?? colAxis!.dimSlug}`
    : rowAxisName;

  return (
    <div
      ref={gridRef}
      className="rater-ft-grid-2d"
      style={styleVars as React.CSSProperties}
      data-testid={testId}
      data-row-count={rowCount}
      data-col-count={colCount}
      data-virtualize-cols={shouldVirtualizeCols ? "true" : "false"}
      data-selection-size={sel.size}
      role="grid"
      aria-label={`Factor table grid ${cornerLabel}`}
      tabIndex={onSelectionChange ? 0 : -1}
      onKeyDown={handleGridKeyDown}
      onPaste={handlePaste}
    >
      {/* Corner — click selects entire grid (when selection is wired). */}
      <div
        className="rater-ft-grid-2d-corner"
        title={cornerLabel}
        data-testid={`${testId}-corner`}
        onClick={onSelectionChange ? handleCornerClick : undefined}
        role={onSelectionChange ? "button" : undefined}
        aria-label={onSelectionChange ? "Select all cells" : undefined}
      >
        {cornerLabel}
      </div>

      {/* Column header row */}
      <div
        className="rater-ft-grid-2d-header-row"
        data-testid={`${testId}-header-row`}
        role="row"
      >
        {is2D ? (
          colAxis!.values
            .slice(visibleColRange.start, visibleColRange.end)
            .map((col) => {
              const isTinted = focusedColId === col.id;
              return (
                <div
                  key={col.id}
                  className={`rater-ft-grid-2d-col-h${
                    isTinted ? " is-tinted" : ""
                  }`}
                  role="columnheader"
                  data-testid={`${testId}-col-h-${col.id}`}
                  data-tinted={isTinted ? "true" : "false"}
                  onClick={
                    onSelectionChange
                      ? () => handleColHeaderClick(col)
                      : undefined
                  }
                  aria-label={
                    onSelectionChange ? `Select column ${col.label}` : undefined
                  }
                >
                  <span className="rater-ft-grid-2d-col-h-label">
                    {col.label}
                  </span>
                  <span className="rater-ft-grid-2d-col-h-sub">
                    {col.sublabel ?? col.id}
                  </span>
                </div>
              );
            })
        ) : (
          <div
            className="rater-ft-grid-2d-col-h"
            role="columnheader"
            data-testid={`${testId}-col-h-factor`}
          >
            <span className="rater-ft-grid-2d-col-h-label">Factor</span>
          </div>
        )}
      </div>

      {/* Row header column */}
      <div
        className="rater-ft-grid-2d-header-col"
        data-testid={`${testId}-header-col`}
      >
        {rowAxis.values.map((row) => {
          const isTinted = focusedRowId === row.id;
          return (
            <div
              key={row.id}
              className={`rater-ft-grid-2d-row-h${
                isTinted ? " is-tinted" : ""
              }`}
              role="rowheader"
              data-testid={`${testId}-row-h-${row.id}`}
              data-tinted={isTinted ? "true" : "false"}
              onClick={
                onSelectionChange ? () => handleRowHeaderClick(row) : undefined
              }
              aria-label={
                onSelectionChange ? `Select row ${row.label}` : undefined
              }
            >
              <span className="rater-ft-grid-2d-row-h-label">
                {row.label}
              </span>
              <span className="rater-ft-grid-2d-row-h-sub">
                {row.sublabel ?? row.id}
              </span>
            </div>
          );
        })}
      </div>

      {/* Body — cell grid */}
      <div
        className="rater-ft-grid-2d-body"
        data-testid={`${testId}-body`}
      >
        {rowAxis.values.map((row, rIdx) => {
          const colValues: readonly FactorTableGrid2DAxisValue[] = is2D
            ? colAxis!.values.slice(visibleColRange.start, visibleColRange.end)
            : [{ id: "__factor__", label: "Factor" }];
          return colValues.map((col, cIdx) => {
            const colId = is2D ? col.id : null;
            const key = cellKey(row.id, colId);
            const value = cells.get(key);
            const isEditingThisCell =
              editing !== null &&
              editing.rowId === row.id &&
              editing.colId === colId;
            const isDefault = isDefaultValue(value);
            const isPending = pendingKeys?.has(key) ?? false;
            const isSelected = sel.has(key);
            const isCrossFocused = focusedKey === key;
            const isEmpty = value === undefined;
            const isActive =
              anchor !== null &&
              anchor.rowId === row.id &&
              anchor.colId === colId;
            const classes = ["rater-ft-grid-2d-cell"];
            if (isEmpty) classes.push("is-empty");
            if (isDefault) classes.push("is-default");
            if (isPending) classes.push("is-pending");
            if (isSelected) classes.push("is-selected");
            if (isCrossFocused) classes.push("is-cross-focused");
            if (isEditingThisCell) classes.push("is-focused");
            if (isActive) classes.push("is-active");
            // PR 33.4: Click behavior switches based on selection wiring.
            //   • If onSelectionChange is provided, click selects (and
            //     double-click edits). This is the spreadsheet model
            //     that pairs with the power-tools toolbar.
            //   • If onSelectionChange is NOT provided, click goes
            //     straight to edit (PR 33.3's simpler model — preserves
            //     consumer flexibility).
            const selectionWired = onSelectionChange !== undefined;
            return (
              <div
                key={key}
                className={classes.join(" ")}
                role="gridcell"
                data-testid={`${testId}-cell-${row.id}${
                  colId === null ? "" : `-${colId}`
                }`}
                data-default={isDefault ? "true" : "false"}
                data-pending={isPending ? "true" : "false"}
                data-selected={isSelected ? "true" : "false"}
                data-cross-focused={isCrossFocused ? "true" : "false"}
                data-active={isActive ? "true" : "false"}
                onClick={
                  selectionWired
                    ? (e) => handleCellClick(e, row, colId, rIdx, cIdx)
                    : () => beginEdit(row.id, colId, value)
                }
                onDoubleClick={
                  selectionWired
                    ? () => handleCellDoubleClick(row, colId)
                    : undefined
                }
                {...(onHoverChange
                  ? {
                      onMouseEnter: () => handleCellMouseEnter(row.id, colId),
                      onMouseLeave: handleCellMouseLeave,
                    }
                  : {})}
              >
                {isEditingThisCell ? (
                  <input
                    ref={inputRef}
                    className="rater-ft-grid-2d-cell-input"
                    type="text"
                    inputMode="decimal"
                    value={editing!.draft}
                    onChange={(e) => {
                      const next = { ...editing!, draft: e.target.value };
                      editingRef.current = next;
                      setEditing(next);
                    }}
                    onBlur={() => {
                      if (editingRef.current) commitEdit(null);
                    }}
                    onKeyDown={handleCellKeyDown}
                    aria-label={`Edit cell ${row.id}${
                      colId === null ? "" : ` × ${colId}`
                    }`}
                    data-testid={`${testId}-cell-input`}
                  />
                ) : isEmpty ? (
                  // "·" = no value set; the engine rates it as the identity
                  // 1.00 (vs an explicitly authored "1"). Title disambiguates.
                  <span aria-hidden title="Not set — rates as 1.00">
                    ·
                  </span>
                ) : (
                  formatCell(value!, gridDecimals)
                )}
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}
