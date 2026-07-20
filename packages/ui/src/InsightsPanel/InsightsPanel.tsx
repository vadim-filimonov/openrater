/**
 * <InsightsPanel> — Brief 34 PR 34.3.
 *
 * Renders a list of {@link Insight} items below the chart (per
 * mockup Frame 2/3 insights-list). Each insight gets an icon, a
 * message, and an optional click affordance that jumps to the
 * anchored cell (wired via `onJumpToCell` in PR 34.5).
 *
 * The panel is intentionally calm: max 6 visible insights, no
 * banners, no bright reds. Per Brief 34 P4 ("Loud about what
 * matters, quiet about what doesn't") — outliers + monotonicity
 * breaks get the warn variant; range / all-default / narrow-spread
 * get the info variant; diagonal-smooth gets good.
 *
 * Pure presentation. Parent owns:
 *   • The insights array (typically the result of `runInsights(...)`)
 *   • The optional jump-to-cell handler
 */

import { useState, type JSX } from "react";
import type { CellAnchor, Insight, InsightSeverity } from "./insights";
import "./InsightsPanel.css";

/** Max insights shown before a "show more" toggle appears. */
export const INSIGHTS_DEFAULT_LIMIT = 6;

export interface InsightsPanelProps {
  /** Insights to render. */
  readonly insights: readonly Insight[];
  /**
   * Called when the user clicks an insight that carries a
   * `CellAnchor`. The parent typically scrolls the grid to the
   * cell + selects it.
   */
  readonly onJumpToCell?: (anchor: CellAnchor) => void;
  /**
   * Max insights to render before collapsing into a "Show N more"
   * toggle. Defaults to {@link INSIGHTS_DEFAULT_LIMIT}.
   */
  readonly visibleLimit?: number;
  /**
   * Optional aria-label for the panel. Defaults to "Auto-insights".
   */
  readonly ariaLabel?: string;
  readonly testId?: string;
}

/** Map severity → icon character. */
const ICON_BY_SEVERITY: Readonly<Record<InsightSeverity, string>> = {
  info: "i",
  good: "✓",
  warn: "!",
};

/**
 * Render an insight message. Splits on `code:VALUE` markers
 * (terminated by space, `·`, paren, or end-of-string) and renders
 * the captured tokens inside <code>.
 *
 * Example: `"Range code:0.85–1.18 · spread code:0.33"` →
 *   "Range " <code>0.85–1.18</code> " · spread " <code>0.33</code>
 */
function renderMessage(message: string): JSX.Element {
  // Token grammar:
  //   bare text         OR  "code:TOKEN" where TOKEN runs until
  //                         whitespace, comma, parenthesis, or `·`.
  const re = /code:([^\s·,)]+)/g;
  const parts: Array<{ kind: "text" | "code"; text: string }> = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(message)) !== null) {
    if (match.index > last) {
      parts.push({
        kind: "text",
        text: message.slice(last, match.index),
      });
    }
    parts.push({ kind: "code", text: match[1]! });
    last = match.index + match[0].length;
  }
  if (last < message.length) {
    parts.push({ kind: "text", text: message.slice(last) });
  }
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "code" ? (
          <code
            key={i}
            className="rater-insights-panel-code"
          >
            {p.text}
          </code>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function InsightsPanel(props: InsightsPanelProps): JSX.Element {
  const {
    insights,
    onJumpToCell,
    visibleLimit = INSIGHTS_DEFAULT_LIMIT,
    ariaLabel = "Auto-insights",
    testId = "rater-insights-panel",
  } = props;
  const [expanded, setExpanded] = useState(false);

  // Empty state — render a calm placeholder, not a banner.
  if (insights.length === 0) {
    return (
      <section
        className="rater-insights-panel"
        data-testid={testId}
        data-insight-count="0"
        aria-label={ariaLabel}
      >
        <span className="rater-insights-panel-label">Auto-insights</span>
        <p
          className="rater-insights-panel-empty"
          data-testid={`${testId}-empty`}
        >
          No insights yet. Edit cells to see patterns surface.
        </p>
      </section>
    );
  }

  const showAll = expanded || insights.length <= visibleLimit;
  const visible = showAll ? insights : insights.slice(0, visibleLimit);
  const hiddenCount = insights.length - visible.length;

  return (
    <section
      className="rater-insights-panel"
      data-testid={testId}
      data-insight-count={insights.length}
      aria-label={ariaLabel}
    >
      <span className="rater-insights-panel-label">Auto-insights</span>
      <ul
        className="rater-insights-panel-list"
        data-testid={`${testId}-list`}
      >
        {visible.map((insight, i) => {
          const isClickable =
            insight.anchor !== undefined && onJumpToCell !== undefined;
          const handleClick = isClickable
            ? () => onJumpToCell!(insight.anchor!)
            : undefined;
          return (
            <li
              key={`${insight.kind}-${i}`}
              className={`rater-insights-panel-item is-${insight.severity}${
                isClickable ? " is-clickable" : ""
              }`}
              data-testid={`${testId}-item-${i}`}
              data-kind={insight.kind}
              data-severity={insight.severity}
              onClick={handleClick}
              role={isClickable ? "button" : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onKeyDown={
                isClickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleClick!();
                      }
                    }
                  : undefined
              }
            >
              <span
                className="rater-insights-panel-icon"
                aria-hidden
              >
                {ICON_BY_SEVERITY[insight.severity]}
              </span>
              <span className="rater-insights-panel-message">
                {renderMessage(insight.message)}
              </span>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="rater-insights-panel-more"
          onClick={() => setExpanded(true)}
          data-testid={`${testId}-more`}
        >
          Show {hiddenCount} more
        </button>
      )}
    </section>
  );
}
