/**
 * <FactorTooltip> — Brief 45 PR 45.2.
 *
 * The rich tooltip surfaced on hover over a chart datum (bar /
 * marker / histogram bin / outlier row). Replaces the value-only
 * label Brief 34 BarChart rendered above each bar.
 *
 * Per Brief 45 §−1 Q9 lock, the tooltip shows:
 *
 *   • Level label (e.g. "Class 5345 — Day Care Centers")
 *   • Factor value (e.g. "1.247")
 *   • Deviation from baseline ("+24.7% above identity")
 *   • Percentile rank within the table ("92nd percentile")
 *   • Chain references — when the level appears in any rating
 *     chain. Truncates at 4 with "+N more" overflow.
 *
 * Positioning is controlled by the parent: the chart owns the
 * hover hit-tracking and passes an anchor rect or x/y. The
 * tooltip renders into a portal so the SVG `overflow: visible`
 * isn't required + scroll-overflow ancestors can't clip it.
 *
 * Pure presentation. Use `computeFactorTooltipData()` upstream
 * (in `factorTooltipData.ts`) to produce the payload from raw
 * datum + values + chain resolver.
 */

import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import type { FactorTooltipData } from "../FactorTableViz/factorTooltipData";
import { formatFactorValue } from "../FactorTableViz/factorStats";
import "./FactorTooltip.css";

/** Anchor describes where the tooltip points. Caller picks the shape. */
export type FactorTooltipAnchor =
  | { readonly kind: "rect"; readonly rect: DOMRect | { x: number; y: number; width: number; height: number } }
  | { readonly kind: "point"; readonly x: number; readonly y: number };

export interface FactorTooltipProps {
  /** When false the tooltip renders nothing. */
  readonly open: boolean;
  /** Where in the viewport to position relative to. */
  readonly anchor: FactorTooltipAnchor | null;
  /** Computed payload. See `computeFactorTooltipData()`. */
  readonly data: FactorTooltipData | null;
  /** Preferred placement. The tooltip flips on viewport-edge collision. */
  readonly placement?: "top" | "bottom" | "left" | "right";
  /**
   * Optional explicit baseline label rendered next to the value.
   * Hidden by default — most consumers don't need it because the
   * deviationLabel already says "above identity" / "below identity."
   */
  readonly baselineLabel?: string;
  readonly testId?: string;
}

interface Position {
  readonly top: number;
  readonly left: number;
  readonly placement: "top" | "bottom" | "left" | "right";
}

/** Gap between the tooltip and its anchor (px). */
const GAP_PX = 10;

function anchorRect(
  anchor: FactorTooltipAnchor,
): { x: number; y: number; width: number; height: number } {
  if (anchor.kind === "point") {
    return { x: anchor.x, y: anchor.y, width: 0, height: 0 };
  }
  const r = anchor.rect;
  return {
    x: "x" in r ? r.x : (r as DOMRect).left,
    y: "y" in r ? r.y : (r as DOMRect).top,
    width: r.width,
    height: r.height,
  };
}

function computePosition(
  anchor: FactorTooltipAnchor,
  tooltipRect: DOMRect,
  preferred: "top" | "bottom" | "left" | "right",
): Position {
  const a = anchorRect(anchor);
  // Try preferred placement; flip on viewport collision.
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  type Attempt = { placement: Position["placement"]; top: number; left: number };
  const attempts: Attempt[] = [];
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;

  const order: Position["placement"][] = (() => {
    const others = (["top", "bottom", "left", "right"] as const).filter(
      (p) => p !== preferred,
    );
    return [preferred, ...others];
  })();

  for (const placement of order) {
    let top = 0;
    let left = 0;
    switch (placement) {
      case "top":
        top = a.y - tooltipRect.height - GAP_PX;
        left = cx - tooltipRect.width / 2;
        break;
      case "bottom":
        top = a.y + a.height + GAP_PX;
        left = cx - tooltipRect.width / 2;
        break;
      case "left":
        top = cy - tooltipRect.height / 2;
        left = a.x - tooltipRect.width - GAP_PX;
        break;
      case "right":
        top = cy - tooltipRect.height / 2;
        left = a.x + a.width + GAP_PX;
        break;
    }
    attempts.push({ placement, top, left });
    // Check fit.
    if (
      top >= 0 &&
      left >= 0 &&
      top + tooltipRect.height <= viewportH &&
      left + tooltipRect.width <= viewportW
    ) {
      return {
        top: top + window.scrollY,
        left: left + window.scrollX,
        placement,
      };
    }
  }

  // No fit found — use the preferred one but clamp into the viewport.
  const first = attempts[0]!;
  const top = Math.max(
    8,
    Math.min(first.top, viewportH - tooltipRect.height - 8),
  );
  const left = Math.max(
    8,
    Math.min(first.left, viewportW - tooltipRect.width - 8),
  );
  return {
    top: top + window.scrollY,
    left: left + window.scrollX,
    placement: first.placement,
  };
}

export function FactorTooltip(props: FactorTooltipProps): JSX.Element | null {
  const {
    open,
    anchor,
    data,
    placement = "top",
    baselineLabel,
    testId = "rater-factor-tooltip",
  } = props;

  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !tooltipRef.current) {
      setPosition(null);
      return;
    }
    const rect = tooltipRef.current.getBoundingClientRect();
    setPosition(computePosition(anchor, rect, placement));
  }, [open, anchor, placement]);

  // Reposition on scroll/resize while open.
  useEffect(() => {
    if (!open || !anchor) return;
    const handler = (): void => {
      if (!tooltipRef.current) return;
      const rect = tooltipRef.current.getBoundingClientRect();
      setPosition(computePosition(anchor, rect, placement));
    };
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, anchor, placement]);

  if (!open || !data) return null;
  if (typeof document === "undefined") return null;

  // Direction tint class (drives `deviationLabel` color)
  const direction = data.direction;

  // Determine displayed chain refs + overflow tail
  const overflowCount =
    data.chainRefsTotal > data.chainRefs.length
      ? data.chainRefsTotal - data.chainRefs.length
      : 0;

  const overlay = (
    <div
      ref={tooltipRef}
      className={`rater-factor-tooltip is-direction-${direction}`}
      role="tooltip"
      data-testid={testId}
      data-placement={position?.placement ?? placement}
      style={
        position
          ? { top: `${position.top}px`, left: `${position.left}px` }
          : // Render off-screen on first paint until useLayoutEffect
            // resolves the real position (one frame later).
            { top: "-9999px", left: "-9999px" }
      }
    >
      {/* Title */}
      <div className="rater-factor-tooltip__title" data-testid={`${testId}-title`}>
        {data.label}
      </div>

      {/* Value + deviation row */}
      <div className="rater-factor-tooltip__val-row">
        <span
          className="rater-factor-tooltip__val"
          data-testid={`${testId}-value`}
        >
          {formatFactorValue(data.value)}
        </span>
        <span
          className={`rater-factor-tooltip__dev is-${direction}`}
          data-testid={`${testId}-deviation`}
        >
          {data.deviationLabel}
        </span>
      </div>

      {/* Optional baseline label */}
      {baselineLabel ? (
        <div className="rater-factor-tooltip__baseline-label">{baselineLabel}</div>
      ) : null}

      {/* Percentile */}
      <div
        className="rater-factor-tooltip__pct"
        data-testid={`${testId}-percentile`}
      >
        <strong>{data.percentileLabel}</strong>
        {data.percentile > 0 && data.percentile < 100 ? (
          <span className="rater-factor-tooltip__pct-detail">
            {" "}
            within the table
          </span>
        ) : null}
      </div>

      {/* Chain references */}
      {data.chainRefs.length > 0 ? (
        <div
          className="rater-factor-tooltip__chains"
          data-testid={`${testId}-chains`}
        >
          <span className="rater-factor-tooltip__chains-label">
            Referenced in
          </span>
          <ul className="rater-factor-tooltip__chains-list">
            {data.chainRefs.map((ref) => (
              <li key={ref} className="rater-factor-tooltip__chain-pill">
                <code>{ref}</code>
              </li>
            ))}
            {overflowCount > 0 ? (
              <li className="rater-factor-tooltip__chain-overflow">
                +{overflowCount} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );

  return createPortal(overlay, document.body);
}
