/**
 * <FactorTablePowerTools> — Brief 33 PR 33.4.
 *
 * The bulk-edit toolbar that sits above the materialized factor
 * table grid. Operates on the current cell selection (controlled by
 * the parent — typically <ParametrizeCanvas> via
 * <FactorTableNode>).
 *
 * Operations (per Brief 33 §−1 Q6 — vocabulary from the mockup at
 * `/mockup/33-parametrize-as-canvas.html` Frame 7):
 *
 *   • Set to…     → set every selected cell to a constant value
 *   • +%          → multiply every selected cell by (1 + n/100)
 *   • Clear       → clear selection (cells untouched)
 *
 * Each numeric op is gated behind an inline popover ("Apply what?")
 * so the user types a value and confirms before the cells move.
 *
 * The toolbar gates itself on selection size: when zero cells are
 * selected, the operation buttons are visually disabled + the
 * selection chip reads "no selection". Selection persists across
 * filter changes (mockup vocab).
 *
 * Pure presentation. Parent owns:
 *   • Selection size (count + clear-handler)
 *   • Set-value and apply-percent application handlers
 */

import {
  useCallback,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import "./FactorTablePowerTools.css";

/** Currently-open popover, if any. */
type OpenPopover = "set" | "pct" | null;

export interface FactorTablePowerToolsProps {
  /**
   * Number of cells in the active selection. Drives the chip label
   * + enables/disables the operation buttons.
   */
  readonly selectedCount: number;
  /**
   * Optional descriptor of *what* is selected — e.g. "column 'owner'"
   * or "row 'frame'" or "8 cells". Rendered after the count.
   */
  readonly selectionLabel?: string;
  /**
   * Fires when the user submits the "Set to…" popover with a value.
   * The parent applies the value to every selected cell.
   */
  readonly onSetValue: (value: number) => void;
  /**
   * Fires when the user submits the "+%" popover. The number is the
   * raw percent (e.g. `5` for +5%, `-10` for -10%). The parent
   * multiplies every selected cell by `1 + percent/100`.
   */
  readonly onApplyPercent: (percent: number) => void;
  /**
   * Fires when the user clicks "Clear". Selection drops but cells
   * are untouched.
   */
  readonly onClearSelection: () => void;
  readonly testId?: string;
}

/**
 * Strip + parse a numeric string. Accepts optional leading +/- and
 * decimal point. Returns `null` for empty, non-numeric, or NaN
 * inputs so callers can suppress invalid submits.
 */
function parseNumeric(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function FactorTablePowerTools(
  props: FactorTablePowerToolsProps,
): JSX.Element {
  const {
    selectedCount,
    selectionLabel,
    onSetValue,
    onApplyPercent,
    onClearSelection,
    testId = "rater-ft-power-tools",
  } = props;

  const hasSelection = selectedCount > 0;
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
  const [setValueDraft, setSetValueDraft] = useState<string>("");
  const [pctDraft, setPctDraft] = useState<string>("");

  // Open a popover, closing any other open one.
  const togglePopover = useCallback((next: OpenPopover) => {
    setOpenPopover((cur) => (cur === next ? null : next));
  }, []);

  const submitSetValue = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const parsed = parseNumeric(setValueDraft);
      if (parsed === null) return;
      onSetValue(parsed);
      setSetValueDraft("");
      setOpenPopover(null);
    },
    [setValueDraft, onSetValue],
  );

  const submitApplyPercent = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const parsed = parseNumeric(pctDraft);
      if (parsed === null) return;
      onApplyPercent(parsed);
      setPctDraft("");
      setOpenPopover(null);
    },
    [pctDraft, onApplyPercent],
  );

  const closeOnEscape = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenPopover(null);
      }
    },
    [],
  );

  // Build the chip label. Three-tier hierarchy:
  //   • selection empty → "no selection"
  //   • selectionLabel provided → "N cells · {label}"
  //   • else → "N cell" or "N cells"
  const chipLabel = !hasSelection
    ? "No cells selected"
    : selectionLabel
      ? `${selectedCount} cell${selectedCount === 1 ? "" : "s"} · ${selectionLabel}`
      : `${selectedCount} cell${selectedCount === 1 ? "" : "s"} selected`;

  return (
    <div
      className="rater-ft-pt"
      data-testid={testId}
      data-has-selection={hasSelection ? "true" : "false"}
      role="toolbar"
      aria-label="Factor table power tools"
    >
      {/* Selection chip — left side */}
      <div className="rater-ft-pt-group">
        <span
          className={`rater-ft-pt-chip${
            hasSelection ? " is-active" : " is-muted"
          }`}
          data-testid={`${testId}-chip`}
        >
          {chipLabel}
        </span>
      </div>

      {/* Operation buttons — middle */}
      <div className="rater-ft-pt-group">
        {/* Set to… */}
        <div className="rater-ft-pt-pop-wrap">
          <button
            type="button"
            className={`rater-ft-pt-btn${
              openPopover === "set" ? " is-active" : ""
            }`}
            onClick={() => togglePopover("set")}
            disabled={!hasSelection}
            data-testid={`${testId}-set-btn`}
            aria-expanded={openPopover === "set"}
            aria-haspopup="dialog"
          >
            Set to…
          </button>
          {openPopover === "set" && (
            <form
              className="rater-ft-pt-pop"
              onSubmit={submitSetValue}
              data-testid={`${testId}-set-pop`}
            >
              <label className="rater-ft-pt-pop-label">
                Apply value to {selectedCount}{" "}
                cell{selectedCount === 1 ? "" : "s"}
              </label>
              <div className="rater-ft-pt-pop-row">
                <input
                  className="rater-ft-pt-pop-input"
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={setValueDraft}
                  onChange={(e) => setSetValueDraft(e.target.value)}
                  onKeyDown={closeOnEscape}
                  placeholder="e.g. 1.10"
                  data-testid={`${testId}-set-input`}
                  aria-label="Value"
                />
                <button
                  type="submit"
                  className="rater-ft-pt-btn-primary"
                  disabled={parseNumeric(setValueDraft) === null}
                  data-testid={`${testId}-set-submit`}
                >
                  Apply
                </button>
              </div>
            </form>
          )}
        </div>

        {/* +% */}
        <div className="rater-ft-pt-pop-wrap">
          <button
            type="button"
            className={`rater-ft-pt-btn${
              openPopover === "pct" ? " is-active" : ""
            }`}
            onClick={() => togglePopover("pct")}
            disabled={!hasSelection}
            data-testid={`${testId}-pct-btn`}
            aria-expanded={openPopover === "pct"}
            aria-haspopup="dialog"
          >
            Adjust %
          </button>
          {openPopover === "pct" && (
            <form
              className="rater-ft-pt-pop"
              onSubmit={submitApplyPercent}
              data-testid={`${testId}-pct-pop`}
            >
              <label className="rater-ft-pt-pop-label">
                Raise or lower {selectedCount} factor
                {selectedCount === 1 ? "" : "s"} by a percent
              </label>
              <div className="rater-ft-pt-pop-row">
                <input
                  className="rater-ft-pt-pop-input"
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={pctDraft}
                  onChange={(e) => setPctDraft(e.target.value)}
                  onKeyDown={closeOnEscape}
                  placeholder="+5 or -10"
                  data-testid={`${testId}-pct-input`}
                  aria-label="Percent"
                />
                <span className="rater-ft-pt-pop-unit">%</span>
                <button
                  type="submit"
                  className="rater-ft-pt-btn-primary"
                  disabled={parseNumeric(pctDraft) === null}
                  data-testid={`${testId}-pct-submit`}
                >
                  Apply
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Clear */}
        <button
          type="button"
          className="rater-ft-pt-btn"
          onClick={onClearSelection}
          disabled={!hasSelection}
          data-testid={`${testId}-clear-btn`}
        >
          Deselect
        </button>
      </div>
    </div>
  );
}
