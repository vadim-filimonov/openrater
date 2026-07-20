/**
 * <FactorTableNode> — Brief 33 PR 33.2 + PR 33.3 + PR 33.4.
 *
 * The active-draft surface inside <ParametrizeCanvas>. Renders the
 * axis-drop frame (pre-Generate) plus an editable title row, status
 * pill, and a Generate primary action.
 *
 * State machine (per §−1 Q3 — one slot enables Generate):
 *
 *   empty         (no axes)             → Generate disabled
 *   row only      (rowDim set)          → Generate primed (1-D)
 *   col only      (colDim set)          → Generate primed (1-D, but col-axis)
 *   both          (rowDim + colDim set) → Generate primed (2-D)
 *
 * PR 33.3 — once cells are materialized (parent passes `cells`),
 * the axis-drop frame is replaced by an embedded
 * <FactorTableGrid2D>. The head bar gains an "Edit axes" button
 * that clears cells and returns to the axis-drop mode.
 *
 * Native HTML5 drag-drop matches the codebase precedent
 * (`LevelRowsTable.tsx` + `DimensionCompositeEditor.tsx`). The dim
 * chip in <ParametrizeCanvas>'s left rail puts the dim slug in
 * `dataTransfer.setData(DIM_DRAG_MIME, slug)`; the axis slots accept
 * the drop, validate the slug against the `dimensions` prop, and
 * fire `onAxesChange` with the next state.
 *
 * Pure presentation. Parent owns:
 *   • Axes state (controlled prop)
 *   • Title state (controlled prop)
 *   • Cells state (controlled prop — PR 33.3)
 *   • The dim list (so we can resolve a dropped slug → display name)
 *   • The Generate handler
 */

import { useMemo, type JSX } from "react";
import {
  ArrowUpFromLine,
  BarChart3,
  GitCompareArrows,
  Download,
} from "lucide-react";
import type { DimensionRow } from "../DimensionsTable";
import { levelsForKeying } from "../keying";
import {
  FactorTableGrid2D,
  type FactorTableGrid2DAxis,
  type FactorTableGrid2DAxisValue,
} from "../FactorTableGrid2D";
import { FactorTablePowerTools } from "../FactorTablePowerTools";
import { Button } from "@openrater/design-system";
import "./FactorTableNode.css";

/** The status pill speaks copy, not the machine enum. */
const STATUS_LABEL: Record<FactorTableNodeStatus, string> = {
  empty: "Empty",
  draft: "Draft",
  saved: "Saved",
};

/** MIME used by dim-chip drag sources and the axis-slot drop targets. */

/** Which axis the drop targets. */

/** Controlled axes state. Each slot is either a dim slug or null. */
export interface FactorTableNodeAxes {
  readonly rowDimSlug: string | null;
  readonly colDimSlug: string | null;
}

/**
 * Status pill states. Drives both the visible label and the CSS
 * variant (color + dot). Mirrors the legacy 24.D ft-node-status
 * vocabulary so consumers can pass the same enum.
 */
export type FactorTableNodeStatus = "empty" | "draft" | "saved";

export interface FactorTableNodeProps {
  /**
   * The dim list available in the plan. The node uses this to
   * resolve a dropped slug → DimensionRow (for axis-chip display
   * name + level count) and to validate that a drop is for a real
   * dim. Must match the rail's source-of-truth.
   */
  readonly dimensions: readonly DimensionRow[];
  /** Controlled axes state. Empty by default (`{ rowDimSlug: null, colDimSlug: null }`). */
  readonly axes: FactorTableNodeAxes;
  /** Title displayed (and editable) in the node head. */
  readonly title: string;
  readonly onTitleChange: (next: string) => void;
  /** Brief 67 §3.4 — read-only plans: the title locks, the grid stops
   *  accepting edits, and the action buttons hide. */
  readonly readOnly?: boolean;
  /**
   * Status pill state. Defaults to "draft" when at least one axis
   * is filled, "empty" otherwise. Consumers may override.
   */
  readonly status?: FactorTableNodeStatus;
  /**
   * The table's cells. Brief 70: a table always has cells from birth
   * (create-on-pick); the only cell-less render is the empty-levels
   * edge (a dim whose levels were deleted later).
   *
   * Cell keys follow `cellKey(rowId, colId)` — `${rowId}` for 1-D
   * and `${rowId}::${colId}` for 2-D.
   */
  readonly cells?: ReadonlyMap<string, number>;
  /**
   * Fires when the user commits a cell edit inside the embedded
   * grid. `colId` is `null` for 1-D tables.
   */
  readonly onCellEdit?: (
    rowId: string,
    colId: string | null,
    value: number,
  ) => void;
  /**
   * PR 33.4 — Selection set on the embedded grid (cellKey strings).
   * Drives the embedded <FactorTablePowerTools> chip + enables the
   * bulk operations. Controlled — parent owns selection.
   *
   * When omitted, the toolbar is not rendered and the grid falls
   * back to PR 33.3's click-to-edit behavior.
   */
  readonly selectedCells?: ReadonlySet<string>;
  /**
   * PR 33.4 — Fires when the user changes selection via clicks on
   * cells, row/col headers, the corner, or Escape.
   */
  readonly onSelectionChange?: (next: Set<string>) => void;
  /**
   * PR 33.4 — Fires when the user submits the toolbar's "Set to…"
   * popover. The parent applies the value to every cell in the
   * current selection.
   */
  readonly onSetSelectionValue?: (value: number) => void;
  /**
   * PR 33.4 — Fires when the user submits the toolbar's "+%"
   * popover. The number is the raw percent (e.g. `5` for +5%);
   * the parent multiplies every selected cell by 1 + N/100.
   */
  readonly onApplySelectionPercent?: (percent: number) => void;
  /**
   * PR 33.5 — Fires when the user clicks "Import CSV" in the FT
   * node head bar. The parent opens its CsvImportPreview2D drawer.
   * Only rendered when this prop is provided AND cells are
   * materialized (axis-drop mode has no grid to import into).
   */
  readonly onImportCsv?: () => void;
  /** Brief 67 walkthrough fix — Export CSV. A READ op: renders on
   *  read-only plans too (filings round-trip through Excel). */
  readonly onExportCsv?: () => void;
  /**
   * Brief 34 PR 34.4 + Brief 67 §3.2 — the chart pane CO-RENDERED
   * beside the grid. Built by the parent (typically <FactorTableViz>);
   * omit when no cells are materialized.
   */
  readonly chartPane?: React.ReactNode;

  /**
   * Brief 34 PR 34.5 — Cross-highlight focus key (cellKey format).
   * The node forwards this to the embedded grid; the consumer is
   * responsible for passing the SAME value to the chartPane (via
   * <FactorTableViz>) so both panes mirror.
   */
  readonly focusedKey?: string;
  /**
   * Brief 34 PR 34.5 — Fires when the grid's hovered cell changes.
   * Parent routes this back into `focusedKey` (typically after a
   * 100ms debounce — handled by the orchestrator) so the chartPane
   * and the grid stay in sync.
   */
  readonly onFocusChange?: (key: string | null) => void;
  /**
   * Brief 34 PR 34.6 — When provided, the head bar renders a
   * "Compare to filed" toggle button. The current state is
   * controlled — `compareMode={true}` flips the button to
   * `is-active` and the parent is responsible for actually
   * threading `filedCells` into the chartPane + grid.
   */
  readonly compareMode?: boolean;
  /**
   * Brief 34 PR 34.6 — Fires when the user clicks the
   * "Compare to filed" toggle. Receives the NEXT compare-mode
   * state. Only rendered when this prop is provided.
   */
  readonly onCompareModeToggle?: (next: boolean) => void;
  /**
   * Brief 34 PR 34.6 — Optional label shown next to the compare
   * toggle to identify which filing is being compared (e.g.,
   * "Filed v1"). When omitted, the toggle reads just
   * "Compare to filed".
   */
  readonly filedLabel?: string;
  /** Brief 67 §3.2 — whether the co-rendered chart pane is open.
   *  Defaults to true (the chart earns its place; collapsing is the
   *  exception, not a mode). */
  readonly chartOpen?: boolean;
  /**
   * Brief 67 §3.2 — Fires when the user toggles the chart pane.
   * Co-render replaced the Table/Chart XOR: the grid is ALWAYS
   * visible (it's the work); the chart rides alongside and the
   * cross-highlight finally has both halves on screen at once.
   * Only rendered when both a `chartPane` AND this handler exist.
   */
  readonly onChartOpenChange?: (open: boolean) => void;
  readonly testId?: string;
}

/**
 * Build a FactorTableGrid2DAxis from a DimensionRow. Each level
 * becomes an axis value with id + label + mono sublabel.
 *
 * Categorical levels use their `id`; banded levels use their `id`
 * but show the label + a mono "lo–hi" sublabel for the range.
 *
 * Keys off `levelsForKeying(dim)` — NOT `dim.levels` — so a
 * territory-grouped geographic dim renders its 5 territory rows
 * (T1…T5), matching the cells Map + the runtime's `derive.territory`
 * lookup. (Cold-test N13: using `dim.levels` here rendered the 51 raw
 * state rows, leaving the territory factors uneditable.)
 */
function dimToAxis(dim: DimensionRow): FactorTableGrid2DAxis {
  const values: FactorTableGrid2DAxisValue[] = levelsForKeying(dim).map(
    (level) => {
      const id = level.id ?? "";
      const label = ("label" in level && level.label) || id;
      const sublabel =
        level.kind === "banded" &&
        "lo" in level &&
        "hi" in level &&
        level.lo !== undefined &&
        level.hi !== undefined
          ? `${level.lo}–${level.hi}`
          : id;
      return { id, label, sublabel };
    },
  );
  return {
    dimSlug: dim.slug,
    ...(dim.display_name ? { dimLabel: dim.display_name } : {}),
    values,
  };
}

/**
 * Helper — find a dim by slug. O(n), fine for plan-scale lists.
 */
function findDim(
  dims: readonly DimensionRow[],
  slug: string | null,
): DimensionRow | null {
  if (slug === null) return null;
  return dims.find((d) => d.slug === slug) ?? null;
}

/** Auto-format the cell-count meta string (e.g., "3 × 2 = 6 cells"). */
function computeMeta(
  rowDim: DimensionRow | null,
  colDim: DimensionRow | null,
): string {
  // Keying count (territory-grouped geo dims report their tier count,
  // matching the grid + cells) — cold-test N13.
  const rowCount = rowDim ? levelsForKeying(rowDim).length : 0;
  const colCount = colDim ? levelsForKeying(colDim).length : 0;
  if (rowDim && colDim) {
    return `${rowCount} × ${colCount} = ${(rowCount * colCount).toLocaleString()} cells`;
  }
  if (rowDim) {
    return `${rowCount} ${rowCount === 1 ? "row" : "rows"} · one axis`;
  }
  if (colDim) {
    return `${colCount} ${colCount === 1 ? "column" : "columns"} · one axis`;
  }
  return "—";
}

export function FactorTableNode(props: FactorTableNodeProps): JSX.Element {
  const {
    dimensions,
    axes,
    title,
    onTitleChange,
    readOnly = false,
    status,
    cells,
    onCellEdit,
    selectedCells,
    onSelectionChange,
    onSetSelectionValue,
    onApplySelectionPercent,
    onImportCsv,
    onExportCsv,
    chartPane,
    // follow-up exclusive toggle gives each view the full body
    // width. Kept on the props type for API back-compat but
    // intentionally unread.
    focusedKey,
    onFocusChange,
    compareMode = false,
    onCompareModeToggle,
    filedLabel,
    chartOpen = true,
    onChartOpenChange,
    testId = "rater-ft-node",
  } = props;
  // PR 33.4 — Toolbar is wired only when the parent has subscribed
  // to selection changes AND provided application handlers. This
  // keeps the toolbar an opt-in for consumers that don't need bulk
  // edit; PR 33.3's click-to-edit path stays untouched in that case.
  const toolbarWired =
    cells !== undefined &&
    onSelectionChange !== undefined &&
    onSetSelectionValue !== undefined &&
    onApplySelectionPercent !== undefined;

  const rowDim = findDim(dimensions, axes.rowDimSlug);
  const colDim = findDim(dimensions, axes.colDimSlug);
  const hasRow = rowDim !== null;
  const hasCol = colDim !== null;
  const hasAnyAxis = hasRow || hasCol;
  const isMaterialized = cells !== undefined;
  const computedStatus: FactorTableNodeStatus =
    status ?? (isMaterialized ? "draft" : hasAnyAxis ? "draft" : "empty");

  // Pre-compute the axis descriptors for the embedded grid (only
  // useful when cells are materialized — wraps the dim levels in
  // FactorTableGrid2D's value shape).
  //
  // 1-D col-only fallback: if the user only filled the col slot (no
  // row dim), treat colDim AS the row axis at the grid level. This
  // matches `materializeCells()` in <ParametrizeCanvas> — both 1-D
  // variants pivot around a single dim slot at the grid level.
  const rowAxisGrid = useMemo<FactorTableGrid2DAxis | null>(() => {
    const axisDim = rowDim ?? colDim;
    return axisDim ? dimToAxis(axisDim) : null;
  }, [rowDim, colDim]);
  // 2-D only: when BOTH slots have a dim. The 1-D col-only case
  // collapses into the row axis above so colAxis stays null.
  const colAxisGrid = useMemo<FactorTableGrid2DAxis | null>(
    () => (rowDim && colDim ? dimToAxis(colDim) : null),
    [rowDim, colDim],
  );
  // True iff the resolved row axis has at least one level. Empty
  // axes (e.g., dim defined without `levels[]`) are caught here and
  // surfaced via an empty-state card instead of an invisible grid.
  const rowAxisHasLevels =
    rowAxisGrid !== null && rowAxisGrid.values.length > 0;


  // ── Render ─────────────────────────────────────────────────────

  return (
    <article
      className="rater-ft-node"
      data-testid={testId}
      data-status={computedStatus}
      data-materialized={isMaterialized ? "true" : "false"}
    >
      <header className="rater-ft-node-head">
        <input
          type="text"
          className="rater-ft-node-title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled factor table"
          aria-label="Factor table title"
          readOnly={readOnly}
          data-testid={`${testId}-title`}
        />
        <span className="rater-ft-node-meta" data-testid={`${testId}-meta`}>
          {computeMeta(rowDim, colDim)}
        </span>
        <span className="rater-ft-node-spacer" />
        {/* Brief 34 follow-up — the view toggle (Table ⇄ Chart) used
            to live here but moved down to the subhead row alongside
            the power-tools "X cells selected" pill. The head bar
            now carries only the title + meta + import/compare/edit
            controls + status pill. */}
        {isMaterialized && onImportCsv && !readOnly && (
          <Button
            variant="ghost"
            size="xs"
            icon={<ArrowUpFromLine size={12} aria-hidden />}
            onClick={onImportCsv}
            data-testid={`${testId}-import-csv`}
            // F11 — disambiguate from the catalog-level "Import CSV" (which
            // CREATES a table). This one re-keys the OPEN table's values.
            title="Replace this table's values from a CSV"
          >
            Replace values
          </Button>
        )}
        {isMaterialized && onExportCsv && (
          <Button
            variant="ghost"
            size="xs"
            icon={<Download size={12} aria-hidden />}
            onClick={onExportCsv}
            data-testid={`${testId}-export-csv`}
          >
            Export CSV
          </Button>
        )}
        {isMaterialized && onCompareModeToggle && (
          <Button
            variant="ghost"
            size="xs"
            icon={<GitCompareArrows size={12} aria-hidden />}
            onClick={() => onCompareModeToggle(!compareMode)}
            data-testid={`${testId}-compare-toggle`}
            data-active={compareMode ? "true" : "false"}
            aria-pressed={compareMode}
          >
            {compareMode
              ? `Comparing${filedLabel ? ` · ${filedLabel}` : ""}`
              : `Compare${filedLabel ? ` · ${filedLabel}` : " to filed"}`}
          </Button>
        )}
        <span
          className={`rater-ft-node-status rater-ft-node-status--${computedStatus}`}
          data-testid={`${testId}-status`}
        >
          {STATUS_LABEL[computedStatus]}
        </span>
      </header>

      {isMaterialized && rowAxisGrid && !rowAxisHasLevels ? (
        // Edge case — dim was dropped onto an axis but has no
        // levels[] defined yet. Render a friendly empty-state so
        // the user knows where to go (instead of a 0-row grid
        // that looks broken).
        <div
          className="rater-ft-node-empty-levels"
          data-testid={`${testId}-empty-levels`}
        >
          <strong className="rater-ft-node-empty-levels-title">
            {rowAxisGrid.dimSlug} has no levels yet
          </strong>
          <span className="rater-ft-node-empty-levels-sub">
            Open the Dimensions workspace to add levels — categorical
            classes (e.g., Frame / Joisted masonry / Fire-resistive)
            or banded ranges (e.g., 0–5 / 5–15 / 15–30 years). The
            table fills back in the moment its dimension has levels.
          </span>
        </div>
      ) : isMaterialized && rowAxisGrid ? (
        <>
          {/* Brief 34 follow-up — Subhead row.
                Left:  the power-tools "X cells selected" pill +
                       bulk-edit buttons (only in table view).
                Right: the Apple-style segmented Table ⇄ Chart toggle
                       (only when a chartPane was wired).
              Always rendered when materialized so the row's height
              stays stable as the user flips views (no layout
              jumping when the power tools disappear in chart mode). */}
          {(toolbarWired ||
            (chartPane !== undefined && onChartOpenChange)) && (
            <div
              className="rater-ft-node-subhead"
              data-testid={`${testId}-subhead`}
            >
              {toolbarWired && (
                <FactorTablePowerTools
                  selectedCount={selectedCells?.size ?? 0}
                  onSetValue={onSetSelectionValue}
                  onApplyPercent={onApplySelectionPercent}
                  onClearSelection={() => onSelectionChange(new Set())}
                  testId={`${testId}-power-tools`}
                />
              )}
              <span className="rater-ft-node-subhead-grow" />
              {chartPane !== undefined && onChartOpenChange && (
                <Button
                  variant="ghost"
                  size="xs"
                  icon={<BarChart3 size={13} aria-hidden />}
                  aria-pressed={chartOpen}
                  onClick={() => onChartOpenChange(!chartOpen)}
                  data-testid={`${testId}-chart-toggle`}
                >
                  {chartOpen ? "Hide chart" : "Show chart"}
                </Button>
              )}
            </div>
          )}
          {/* Brief 67 §3.2 — CO-RENDER. The grid is always on screen
              (it is the work); the chart rides beside it, so the
              hover cross-highlight finally connects two visible
              halves. The old Table/Chart XOR made the user choose
              between SEEING the shape and EDITING the numbers. */}
          <div
            id={`${testId}-body`}
            className="rater-ft-node-body"
            data-chart-open={
              chartPane !== undefined && chartOpen ? "true" : "false"
            }
            data-testid={`${testId}-body`}
          >
            <div
              className="rater-ft-node-grid-wrap"
              data-testid={`${testId}-grid-wrap`}
            >
              <FactorTableGrid2D
                rowAxis={rowAxisGrid}
                cells={cells}
                readOnly={readOnly}
                testId={`${testId}-grid`}
                {...(colAxisGrid !== null ? { colAxis: colAxisGrid } : {})}
                {...(onCellEdit !== undefined ? { onCellEdit } : {})}
                {...(selectedCells !== undefined ? { selectedCells } : {})}
                {...(onSelectionChange !== undefined
                  ? { onSelectionChange }
                  : {})}
                {...(focusedKey !== undefined ? { focusedKey } : {})}
                {...(onFocusChange !== undefined
                  ? { onHoverChange: onFocusChange }
                  : {})}
              />
            </div>
            {chartPane !== undefined && chartOpen ? (
              <aside
                className="rater-ft-node-chart-side"
                data-testid={`${testId}-chart-pane`}
                aria-label="Factor chart"
              >
                {chartPane}
              </aside>
            ) : null}
          </div>
          <p className="rater-ft-node-meaning" data-testid={`${testId}-meaning`}>
            Each factor multiplies the premium — 1.00 means no change.
          </p>
        </>
      ) : null}
    </article>
  );
}
