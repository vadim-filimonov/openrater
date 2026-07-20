/**
 * <OutlierDrawer> — Brief 45 PR 45.4.
 *
 * Full ranked outlier list for the dense-mode chart. Opens from
 * the `<FactorDistribution>` "Show all N outliers →" link. Lists
 * every populated level sorted by `|value - median|` desc.
 *
 * Brief 45 §1.7 mentions virtualization for n > 5k. v1 ships
 * non-virtualized; if cold-tests reveal scroll jank on 5k+ rows
 * a follow-up wires react-window. The list is keyboard-navigable
 * (Tab + Enter on each row).
 *
 * Renders as an overlay panel positioned by the parent — this
 * primitive owns the inner list + close-on-Escape behavior; the
 * backdrop + panel chrome come from CSS. Self-portal'd so it can
 * appear above the chart pane without being clipped.
 */

import { useCallback, useEffect, type JSX } from "react";
import { createPortal } from "react-dom";
import { factorGradient } from "../FactorTableViz/colorRamp";
import { formatFactorValue } from "../FactorTableViz/factorStats";
import type { OutlierEntry } from "../FactorTableViz/factorDistribution";
import "./OutlierDrawer.css";

export interface OutlierDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly entries: readonly OutlierEntry[];
  readonly baseline?: number;
  readonly median?: number | null;
  /** Optional table label for the drawer title. */
  readonly tableLabel?: string;
  /** Fires when the user clicks an outlier row. */
  readonly onOutlierClick?: (key: string) => void;
  /**
   * Brief 64 — formats a value for display. Defaults to the factor format
   * (`formatFactorValue`); Analytics passes a currency formatter so the
   * same drawer reads premium dollars.
   */
  readonly valueFormatter?: (value: number | null) => string;
  readonly testId?: string;
}

export function OutlierDrawer(props: OutlierDrawerProps): JSX.Element | null {
  const {
    open,
    onClose,
    entries,
    baseline = 1.0,
    median = null,
    tableLabel,
    onOutlierClick,
    valueFormatter = formatFactorValue,
    testId = "rater-outlier-drawer",
  } = props;

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleRowClick = useCallback(
    (key: string) => {
      onOutlierClick?.(key);
    },
    [onOutlierClick],
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const title = tableLabel
    ? `All ${entries.length} levels in ${tableLabel}`
    : `All ${entries.length} levels`;

  const overlay = (
    <div
      className="rater-outlier-drawer-backdrop"
      data-testid={`${testId}-backdrop`}
      onClick={onClose}
    >
      <div
        className="rater-outlier-drawer"
        data-testid={testId}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rater-outlier-drawer__head">
          <div className="rater-outlier-drawer__title">
            {title}
            {median !== null && (
              <span className="rater-outlier-drawer__sub">
                · sorted by |value − median| · median{" "}
                {valueFormatter(median)}
              </span>
            )}
          </div>
          <button
            type="button"
            className="rater-outlier-drawer__close"
            onClick={onClose}
            aria-label="Close"
            data-testid={`${testId}-close`}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </header>

        <ul
          className="rater-outlier-drawer__list"
          data-testid={`${testId}-list`}
        >
          {entries.map((entry, i) => {
            const dev =
              baseline !== 0 ? entry.value / baseline - 1 : 0;
            const sign = dev >= 0 ? "+" : "";
            const pct = Math.round(dev * 100);
            const direction = dev >= 0 ? "up" : "down";
            return (
              <li
                key={entry.key}
                className="rater-outlier-drawer__row-wrap"
              >
                <button
                  type="button"
                  className={`rater-outlier-drawer__row is-${direction}`}
                  onClick={() => handleRowClick(entry.key)}
                  data-testid={`${testId}-row-${entry.key}`}
                >
                  <span
                    className="rater-outlier-drawer__rank"
                    style={{ color: factorGradient(entry.value, baseline) }}
                  >
                    {i + 1}
                  </span>
                  <span className="rater-outlier-drawer__label">
                    <span className="rater-outlier-drawer__label-primary">
                      {entry.label}
                    </span>
                    {entry.sublabel && (
                      <span className="rater-outlier-drawer__label-sub">
                        {entry.sublabel}
                      </span>
                    )}
                  </span>
                  <span className="rater-outlier-drawer__val">
                    {valueFormatter(entry.value)}
                  </span>
                  <span
                    className={`rater-outlier-drawer__dev is-${direction}`}
                  >
                    {sign}
                    {pct}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {entries.length === 0 && (
          <div className="rater-outlier-drawer__empty">
            No levels to rank.
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
