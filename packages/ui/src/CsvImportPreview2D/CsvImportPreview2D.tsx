/**
 * <CsvImportPreview2D> — Brief 33 PR 33.5.
 *
 * The pre-import inspection drawer for 2-D factor table CSV. Per
 * Brief 33 §−1 + mockup Frame 8:
 *
 *   • Stats up top: cells changed / unchanged / unmatched rows /
 *     missing dim levels.
 *   • Per-row preview: CSV key → matched level → cell diff list.
 *   • Unmatched rows surface inline re-key pickers (the user
 *     manually maps a typo'd CSV key to the right level).
 *   • Missing dim levels are listed separately so the user sees
 *     what won't be touched.
 *   • Nothing commits until "Apply N changes".
 *
 * Why label-match, not positional: a dim adds/removes a level
 * between exports → positional matching silently writes to the
 * wrong row. With label matching, the user sees exactly what
 * mapped and what didn't.
 *
 * Pure presentation. Parent owns:
 *   • The parsed CSV + dim axes + current cells
 *   • The open/close state
 *   • The onApply handler (receives the resolved cell-changes map)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
} from "react";
import { TriangleAlert, X } from "lucide-react";
import { Button, Drawer } from "@openrater/design-system";
import type { DimensionRow } from "../DimensionsTable";
import {
  matchCsv2D,
  type CsvImport2D,
  type ImportPreview2D,
} from "./matchCsv";
import "./CsvImportPreview2D.css";

export interface CsvImportPreview2DProps {
  readonly open: boolean;
  /**
   * Parsed CSV. Pass null/undefined when the drawer opens but the
   * user hasn't picked a file yet — the drawer will render an
   * empty-state with a file picker.
   */
  readonly csv: CsvImport2D | null;
  /**
   * Row axis dim. Used for label matching + the re-key picker.
   */
  readonly rowAxis: DimensionRow;
  /**
   * Column axis dim. Omit for a 1-D table import.
   */
  readonly colAxis?: DimensionRow;
  /**
   * Current cells in the factor table — used to compute the
   * old → new diffs. Empty map for a freshly-materialized grid.
   */
  readonly currentCells: ReadonlyMap<string, number>;
  /**
   * Fires when the user clicks "Apply changes". The Map contains
   * cellKey → new value for every cell that should change. The
   * parent merges this into the current cells state.
   */
  readonly onApply: (changes: ReadonlyMap<string, number>) => void;
  /**
   * Fires when the user clicks Cancel (or the drawer's X). The
   * parent should set its open state to false.
   */
  readonly onCancel: () => void;
  /**
   * Optional file picker handler. When set, the empty state renders
   * a "Choose file" affordance that fires this. The parent is
   * responsible for parsing + passing the parsed `csv` back in.
   */
  readonly onPickFile?: (file: File) => void;
  /**
   * Brief 67 walkthrough fix — a parse failure from the picked file.
   * Renders as an alert above the picker (errors used to be swallowed:
   * a malformed file looked like an empty drawer).
   */
  readonly error?: string;
  readonly testId?: string;
}

export function CsvImportPreview2D(
  props: CsvImportPreview2DProps,
): JSX.Element {
  const {
    open,
    csv,
    rowAxis,
    colAxis,
    currentCells,
    onApply,
    onCancel,
    onPickFile,
    error,
    testId = "rater-csv-import-2d",
  } = props;

  // PR 33.5 — User-supplied re-key overrides. Stored locally; reset
  // when the drawer closes or the csv prop changes.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );

  // Reset overrides when csv changes identity (new file picked).
  // Effect rather than ref-during-render so React doesn't complain.
  useEffect(() => {
    setOverrides(new Map());
  }, [csv]);

  // Re-run the match each time csv / axes / current / overrides change.
  const preview = useMemo<ImportPreview2D | null>(() => {
    if (!csv) return null;
    return matchCsv2D(csv, rowAxis, colAxis, currentCells, {
      overrides,
    });
  }, [csv, rowAxis, colAxis, currentCells, overrides]);

  const setOverride = useCallback(
    (csvKey: string, rowId: string | null) => {
      setOverrides((prev) => {
        const next = new Map(prev);
        if (rowId === null) {
          next.delete(csvKey);
        } else {
          next.set(csvKey, rowId);
        }
        return next;
      });
    },
    [],
  );

  const handleClose = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const handleApply = useCallback(() => {
    if (!preview) return;
    onApply(preview.resolvedChanges);
  }, [preview, onApply]);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file && onPickFile) onPickFile(file);
      // Allow re-selecting the same file later.
      event.target.value = "";
    },
    [onPickFile],
  );

  // ── Render ─────────────────────────────────────────────────────

  const fileNameLabel = csv?.fileName ?? "No file selected";

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Import CSV"
      subtitle={fileNameLabel}
      widthPx={760}
    >
      <Drawer.Body>
        <div className="rater-csv-import-2d" data-testid={testId}>
          {!preview ? (
            <>
              {error !== undefined && error !== "" ? (
                <p
                  className="rater-csv-import-2d__error"
                  role="alert"
                  data-testid={`${testId}-error`}
                >
                  {error}
                </p>
              ) : null}
              <EmptyPicker
                testId={testId}
                {...(onPickFile !== undefined
                  ? { onFileChange: handleFileChange }
                  : {})}
              />
            </>
          ) : (
            <>
              <StatsRow preview={preview} testId={testId} />
              <PreviewTable
                preview={preview}
                rowAxis={rowAxis}
                onOverride={setOverride}
                testId={testId}
              />
              {preview.missingDimLevels.length > 0 && (
                <MissingList preview={preview} testId={testId} />
              )}
            </>
          )}
        </div>
      </Drawer.Body>
      <Drawer.Footer>
        <Button variant="ghost" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleApply}
          disabled={!preview || preview.cellsWillChange === 0}
          data-testid={`${testId}-apply`}
        >
          {preview && preview.cellsWillChange > 0
            ? `Apply ${preview.cellsWillChange} change${
                preview.cellsWillChange === 1 ? "" : "s"
              }`
            : "Apply changes"}
        </Button>
      </Drawer.Footer>
    </Drawer>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Sub-components
   ────────────────────────────────────────────────────────────────── */

function EmptyPicker(props: {
  readonly testId: string;
  readonly onFileChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  const { testId, onFileChange } = props;
  return (
    <div
      className="rater-csv-import-2d-empty"
      data-testid={`${testId}-empty`}
    >
      <p className="rater-csv-import-2d-empty-title">
        Pick a CSV to inspect before importing
      </p>
      <p className="rater-csv-import-2d-empty-sub">
        We match CSV rows by <strong>label</strong>, not position. You'll
        see exactly which cells will change before anything commits.
      </p>
      {onFileChange && (
        <label
          className="rater-csv-import-2d-empty-btn"
          data-testid={`${testId}-pick-file`}
        >
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            style={{ display: "none" }}
            data-testid={`${testId}-file-input`}
          />
          Choose CSV file
        </label>
      )}
    </div>
  );
}

function StatsRow(props: {
  readonly preview: ImportPreview2D;
  readonly testId: string;
}): JSX.Element {
  const { preview, testId } = props;
  const warnRows = preview.unmatchedRows.length;
  return (
    <div
      className="rater-csv-import-2d-stats"
      data-testid={`${testId}-stats`}
    >
      <div className="rater-csv-import-2d-stat">
        <span
          className="rater-csv-import-2d-stat-num"
          data-testid={`${testId}-stat-changes`}
        >
          {preview.cellsWillChange}
        </span>
        <span className="rater-csv-import-2d-stat-label">
          cells will change
        </span>
      </div>
      <div className="rater-csv-import-2d-stat">
        <span className="rater-csv-import-2d-stat-num is-muted">
          {preview.cellsUnchanged}
        </span>
        <span className="rater-csv-import-2d-stat-label">
          cells unchanged
        </span>
      </div>
      <div className="rater-csv-import-2d-stat">
        <span
          className={`rater-csv-import-2d-stat-num${warnRows > 0 ? " is-warning" : ""}`}
          data-testid={`${testId}-stat-unmatched`}
        >
          {warnRows}
        </span>
        <span className="rater-csv-import-2d-stat-label">
          CSV rows didn't match a level
        </span>
      </div>
      <div className="rater-csv-import-2d-stat">
        <span
          className={`rater-csv-import-2d-stat-num${preview.missingDimLevels.length > 0 ? " is-warning" : ""}`}
        >
          {preview.missingDimLevels.length}
        </span>
        <span className="rater-csv-import-2d-stat-label">
          level not in the CSV (keeps its current value)
        </span>
      </div>
    </div>
  );
}

function PreviewTable(props: {
  readonly preview: ImportPreview2D;
  readonly rowAxis: DimensionRow;
  readonly onOverride: (csvKey: string, rowId: string | null) => void;
  readonly testId: string;
}): JSX.Element {
  const { preview, rowAxis, onOverride, testId } = props;
  const levels = rowAxis.levels ?? [];
  return (
    <div
      className="rater-csv-import-2d-table"
      data-testid={`${testId}-table`}
    >
      <div className="rater-csv-import-2d-row is-header">
        <span>CSV row key</span>
        <span>matched level</span>
        <span>change preview</span>
        <span>cells</span>
      </div>

      {preview.matchedRows.map((row) => {
        const changedCount = row.cellDiffs.filter((d) => d.willChange).length;
        const diffPreview = row.cellDiffs
          .filter((d) => d.willChange)
          .slice(0, 4)
          .map((d) => {
            const old =
              d.oldValue === undefined ? "—" : d.oldValue.toString();
            const next =
              d.newValue === null ? "—" : d.newValue.toString();
            return `${d.colLabel}: ${old} → ${next}`;
          })
          .join(" · ");
        return (
          <div
            key={row.csvKey}
            className="rater-csv-import-2d-row"
            data-testid={`${testId}-row-${row.csvKey}`}
          >
            <span className="rater-csv-import-2d-row-key">{row.csvKey}</span>
            <span className="rater-csv-import-2d-row-match is-ok">
              → {rowAxis.slug}.{row.rowId}
            </span>
            <span className="rater-csv-import-2d-row-preview">
              {diffPreview || (
                <span className="is-muted">no changes</span>
              )}
            </span>
            <span className="rater-csv-import-2d-row-count">
              {changedCount} change{changedCount === 1 ? "" : "s"}
            </span>
          </div>
        );
      })}

      {preview.unmatchedRows.map((row) => (
        <div
          key={row.csvKey}
          className={`rater-csv-import-2d-row is-${row.quality}`}
          data-testid={`${testId}-row-${row.csvKey}`}
        >
          <span className="rater-csv-import-2d-row-key">{row.csvKey}</span>
          <span
            className={`rater-csv-import-2d-row-match is-${row.quality}`}
          >
            {row.quality === "warn" ? (
              <>
                <TriangleAlert size={11} aria-hidden /> no exact match
              </>
            ) : (
              <>
                <X size={11} aria-hidden /> unknown
              </>
            )}
            {" · "}
            <select
              className="rater-csv-import-2d-rekey"
              defaultValue=""
              onChange={(e) =>
                onOverride(row.csvKey, e.target.value || null)
              }
              aria-label={`Re-key ${row.csvKey} to a level`}
              data-testid={`${testId}-rekey-${row.csvKey}`}
            >
              <option value="">re-key as…</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </span>
          <span className="rater-csv-import-2d-row-preview is-muted">
            cells will be skipped unless re-keyed
          </span>
          <span className="rater-csv-import-2d-row-count is-muted">—</span>
        </div>
      ))}
    </div>
  );
}

function MissingList(props: {
  readonly preview: ImportPreview2D;
  readonly testId: string;
}): JSX.Element {
  const { preview, testId } = props;
  return (
    <div
      className="rater-csv-import-2d-missing"
      data-testid={`${testId}-missing-list`}
    >
      <span className="rater-csv-import-2d-missing-label">
        Dim levels not in CSV — keeping current values:
      </span>
      <span className="rater-csv-import-2d-missing-list">
        {preview.missingDimLevels.map((m) => (
          <span
            key={m.rowId}
            className="rater-csv-import-2d-missing-chip"
            data-testid={`${testId}-missing-${m.rowId}`}
          >
            {m.rowLabel}
          </span>
        ))}
      </span>
    </div>
  );
}
