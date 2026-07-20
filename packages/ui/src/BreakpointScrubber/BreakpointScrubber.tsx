/**
 * <BreakpointScrubber> — hand-rolled SVG slider with N draggable handles.
 *
 * Brief 26 §−1 Q10 / §16 PR 4 — the primary authoring path for
 * banded dimensions. Drives `<DimensionBandedDrawer>` (PR 5) +
 * the inline banded editor (Brief 27 PR 3).
 *
 * The scrubber renders a horizontal axis spanning [min, max] with
 * N breakpoint handles + N-1 band regions between adjacent handles.
 * Each handle can be dragged with the pointer or repositioned with
 * the keyboard. Move events fire `onChange(next)` with the updated
 * sorted breakpoints array.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ 0 ────●──── 5 ────●──── 15 ──●──── 30 ────●──── 50 ──●── 100 │
 *   │           L1            L2            L3        L4          │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Pure presentation: no plan-mutation, no internal state for the
 * breakpoint vector (parent owns it). Internal pointer/drag state
 * is local to make pointer-capture-on-handle work cleanly.
 *
 * Hand-rolled SVG with design tokens (matches `<CurvePlot>` from
 * ADR-0019). No chart library; pointer events drive the drag.
 *
 * a11y:
 *   • Each handle is `role="slider"` with `aria-valuemin/max/now`.
 *   • Tab traverses handles in axis order.
 *   • ArrowLeft/Right nudges by `step` (default = (max-min)/100).
 *   • Shift+Arrow = 10× nudge. Home/End = clamp to min/max within
 *     neighbor bounds.
 *
 * **Brief 27 PR 2 — scale-adaptive modes:**
 *
 * The scrubber auto-detects band density and renders differently
 * so handles + labels never overlap. Per Brief 27 §−1 Q3, the
 * threshold is **11 bands** (i.e., 12 breakpoints):
 *
 *   • `full`     — ≤ 10 bands. Current rendering. Handles + per-
 *                  band labels below the axis. Endpoint labels
 *                  above the axis.
 *   • `compact`  — 11+ bands. Handles only — no per-band text
 *                  labels (they'd overlap). The SVG is shorter
 *                  (the label row drops out). Hover or focus a
 *                  handle to see its value as a tooltip. The band
 *                  table next to the scrubber becomes the primary
 *                  source of truth at this density.
 *
 * Callers can override with `mode="full"` / `mode="compact"` —
 * default is `mode="auto"`.
 */

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import "./BreakpointScrubber.css";

/**
 * Density mode of the scrubber. Drives the rendered layout.
 *
 * - `"full"`    — handles + per-band labels below the axis.
 *                 Default for ≤ 10 bands.
 * - `"compact"` — handles only (labels suppressed). Hover/focus a
 *                 handle to see its value as a tooltip. Default
 *                 for 11+ bands.
 * - `"auto"`    — pick automatically based on band count. The
 *                 default; callers rarely need to override.
 *
 * Brief 27 §−1 Q3 lock: threshold is 11 bands.
 */
export type BreakpointScrubberMode = "auto" | "full" | "compact";

/**
 * Band count at which `mode="auto"` flips from `full` to `compact`.
 * `bands = breakpoints.length - 1`, so this corresponds to 12+
 * breakpoints. Per Brief 27 §−1 Q3 lock.
 */
export const COMPACT_MODE_THRESHOLD = 11;

export interface BreakpointScrubberProps {
  /** Lower bound of the axis (the first breakpoint cannot drop below this). */
  readonly min: number;
  /** Upper bound of the axis (the last breakpoint cannot exceed this). */
  readonly max: number;
  /**
   * The breakpoint vector. MUST be sorted ascending + lie within
   * `[min, max]`. The parent guarantees this; the scrubber clamps
   * during drag to keep adjacent handles from passing each other.
   */
  readonly breakpoints: readonly number[];
  /**
   * Fires when the user commits a drag (pointerup) or arrow-keys
   * a handle. Receives the new sorted breakpoint vector.
   *
   * Per ADR-0019 + our `<CurvePlot>` precedent: commits on
   * pointerup, NOT on every pointermove. The internal preview
   * during drag keeps the UI smooth without flooding the parent.
   */
  readonly onChange: (next: readonly number[]) => void;
  /**
   * Optional per-band labels. Length MUST equal
   * `breakpoints.length - 1` when provided; otherwise labels are
   * derived as `{lo}–{hi}` from the breakpoint values.
   *
   * In `compact` mode these are NOT rendered below the axis (they
   * would overlap). They DO still drive the hover/focus tooltip
   * shown above each handle, so passing them stays meaningful.
   */
  readonly labels?: readonly string[];
  /**
   * Brief 30 PR 30.3 — Indices (0-based, into the band range — i.e.,
   * 0 ≤ i < breakpoints.length - 1) that should render with the
   * "gap" visual instead of the alternating azure stripes. Used
   * when the scrubber's level table has a coverage gap or overlap
   * between consecutive bands — the gap region renders with a
   * dashed/striped fill so the user sees exactly where the chain
   * breaks.
   *
   * When omitted, no bands are gap-tinted. The consumer typically
   * computes this from `bandedGapsAndOverlaps()` in @openrater/contracts.
   */
  readonly gapBandIndices?: readonly number[];
  /**
   * Density mode. Defaults to `"auto"` — switches to `"compact"`
   * at 11+ bands per Brief 27 §−1 Q3.
   */
  readonly mode?: BreakpointScrubberMode;
  /** Pixel width of the SVG. Default: 600. */
  readonly width?: number;
  /**
   * Pixel height of the SVG. When omitted, the scrubber picks a
   * height that fits the resolved mode (80 px for `full`, 50 px
   * for `compact` — there's no label row in compact). Pass a
   * number to override.
   */
  readonly height?: number;
  /**
   * Optional snap step. When set, drag positions snap to the
   * nearest multiple of `step` (relative to `min`). Arrow keys
   * also nudge by `step` (Shift = 10×).
   */
  readonly step?: number;
  /** ARIA label applied to the SVG element. */
  readonly ariaLabel?: string;
  /** Test-id for the SVG root. */
  readonly testId?: string;
}

interface DragState {
  readonly index: number;
  /** The starting breakpoint value before drag began. */
  readonly startValue: number;
  /** The pointer's starting clientX. */
  readonly startClientX: number;
  /** The current pointer id (for pointer capture). */
  readonly pointerId: number;
}

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT_FULL = 80;
const DEFAULT_HEIGHT_COMPACT = 50;
/** Pixel padding on each side of the SVG so handles aren't clipped. */
const HORIZONTAL_PAD = 16;
/** Y coordinate of the axis baseline in `full` mode (room above + below). */
const AXIS_Y_FULL = 36;
/**
 * Y coordinate of the axis baseline in `compact` mode. The label row
 * below the axis is suppressed, so the baseline sits lower in the
 * shorter SVG to keep endpoint labels readable above it.
 */
const AXIS_Y_COMPACT = 28;
const HANDLE_RADIUS = 8;
/** Y coordinate of the per-band label text (full mode only). */
const LABEL_Y_FULL = 64;
/**
 * Pixel offset of the tooltip's text baseline above the handle. The
 * tooltip displays while dragging in either mode, and while hovering
 * or focusing a handle in `compact` mode (so the user can read the
 * band's range without per-band labels).
 */
const TOOLTIP_OFFSET = 16;

/** Min pixel-distance between neighboring handles (prevents overlap). */
const MIN_HANDLE_GAP_PX = 4;

/**
 * Resolve `mode="auto"` to either `"full"` or `"compact"` based on
 * the band count. Exported for callers that need to mirror the
 * scrubber's decision (e.g., to decide whether to render an
 * adjacent band table at full or scrolling density).
 */
export function resolveScrubberMode(
  mode: BreakpointScrubberMode | undefined,
  breakpointCount: number,
): "full" | "compact" {
  if (mode === "full" || mode === "compact") return mode;
  const bandCount = Math.max(0, breakpointCount - 1);
  return bandCount >= COMPACT_MODE_THRESHOLD ? "compact" : "full";
}

export function BreakpointScrubber(
  props: BreakpointScrubberProps,
): JSX.Element {
  const {
    min,
    max,
    breakpoints,
    onChange,
    labels,
    mode,
    width = DEFAULT_WIDTH,
    step,
    gapBandIndices,
    ariaLabel = "Breakpoint axis",
    testId = "rater-breakpoint-scrubber",
  } = props;
  const gapIndexSet = useMemo(
    () => new Set(gapBandIndices ?? []),
    [gapBandIndices],
  );

  // Resolved density mode + matching layout constants. The auto
  // threshold lives in resolveScrubberMode; callers can override
  // with mode="full" / mode="compact" for testing/edge cases.
  const resolvedMode = resolveScrubberMode(mode, breakpoints.length);
  const isCompact = resolvedMode === "compact";
  const height =
    props.height ??
    (isCompact ? DEFAULT_HEIGHT_COMPACT : DEFAULT_HEIGHT_FULL);
  const axisY = isCompact ? AXIS_Y_COMPACT : AXIS_Y_FULL;

  // The dataspan must be positive for the scrubber to be meaningful.
  // If it's zero or negative the parent gave us junk; render the
  // axis but skip handle interactivity.
  const dataSpan = max - min;
  const axisLeftPx = HORIZONTAL_PAD;
  const axisRightPx = width - HORIZONTAL_PAD;
  const axisWidthPx = axisRightPx - axisLeftPx;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // While dragging, the previewed positions override the prop's
  // values so the UI moves smoothly. On pointerup we commit + clear.
  const [previewBreakpoints, setPreviewBreakpoints] =
    useState<readonly number[] | null>(null);
  // Compact-mode tooltip target. In compact we surface the band id +
  // value above a handle on hover/focus so the user has context
  // without a label row.  Hover wins over focus for visual stability.
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);
  const reactId = useId();

  const displayedBreakpoints = previewBreakpoints ?? breakpoints;

  const dataToPx = useCallback(
    (value: number): number => {
      if (dataSpan <= 0) return axisLeftPx;
      const t = (value - min) / dataSpan;
      return axisLeftPx + t * axisWidthPx;
    },
    [min, dataSpan, axisLeftPx, axisWidthPx],
  );

  const pxToData = useCallback(
    (px: number): number => {
      if (dataSpan <= 0) return min;
      const t = (px - axisLeftPx) / axisWidthPx;
      return min + t * dataSpan;
    },
    [min, dataSpan, axisLeftPx, axisWidthPx],
  );

  const snapToStep = useCallback(
    (value: number): number => {
      if (step === undefined || step <= 0) return value;
      const steps = Math.round((value - min) / step);
      return min + steps * step;
    },
    [step, min],
  );

  /**
   * Clamp a proposed breakpoint value so it stays within the
   * axis range AND maintains strict ordering against its
   * neighbors (with a pixel-equivalent epsilon so adjacent
   * handles never visually overlap).
   */
  const clampValue = useCallback(
    (index: number, proposed: number, source: readonly number[]): number => {
      const epsilonData =
        axisWidthPx > 0 ? (MIN_HANDLE_GAP_PX / axisWidthPx) * dataSpan : 0;
      const lowerBound =
        index === 0 ? min : source[index - 1]! + epsilonData;
      const upperBound =
        index === source.length - 1
          ? max
          : source[index + 1]! - epsilonData;
      let clamped = Math.max(lowerBound, Math.min(upperBound, proposed));
      // Then snap to step (and re-clamp if the snap pushed past a
      // neighbor — happens at extremes when step is coarse).
      clamped = snapToStep(clamped);
      clamped = Math.max(lowerBound, Math.min(upperBound, clamped));
      return clamped;
    },
    [min, max, axisWidthPx, dataSpan, snapToStep],
  );

  // ── Pointer drag ───────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (index: number, event: ReactPointerEvent<SVGCircleElement>): void => {
      if (dataSpan <= 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        index,
        startValue: breakpoints[index]!,
        startClientX: event.clientX,
        pointerId: event.pointerId,
      });
      setPreviewBreakpoints([...breakpoints]);
    },
    [breakpoints, dataSpan],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      if (!drag) return;
      if (event.pointerId !== drag.pointerId) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // Convert clientX → svg-local px via the viewBox-aware ratio.
      const localPx =
        ((event.clientX - rect.left) / rect.width) * width;
      const proposed = pxToData(localPx);
      const source = previewBreakpoints ?? breakpoints;
      const next = source.map((v, i) =>
        i === drag.index ? clampValue(i, proposed, source) : v,
      );
      setPreviewBreakpoints(next);
    },
    [drag, previewBreakpoints, breakpoints, width, pxToData, clampValue],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      if (!drag) return;
      if (event.pointerId !== drag.pointerId) return;
      const committed = previewBreakpoints ?? breakpoints;
      onChange(committed);
      setDrag(null);
      setPreviewBreakpoints(null);
    },
    [drag, previewBreakpoints, breakpoints, onChange],
  );

  // ── Keyboard ───────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (
      index: number,
      event: ReactKeyboardEvent<SVGCircleElement>,
    ): void => {
      if (dataSpan <= 0) return;
      const nudge =
        step !== undefined && step > 0 ? step : dataSpan / 100;
      const big = event.shiftKey ? 10 : 1;
      let delta = 0;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        delta = -nudge * big;
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        delta = nudge * big;
      } else if (event.key === "Home") {
        const next = breakpoints.map((v, i) =>
          i === index ? clampValue(i, min, breakpoints) : v,
        );
        event.preventDefault();
        onChange(next);
        return;
      } else if (event.key === "End") {
        const next = breakpoints.map((v, i) =>
          i === index ? clampValue(i, max, breakpoints) : v,
        );
        event.preventDefault();
        onChange(next);
        return;
      } else {
        return;
      }
      event.preventDefault();
      const proposed = breakpoints[index]! + delta;
      const next = breakpoints.map((v, i) =>
        i === index ? clampValue(i, proposed, breakpoints) : v,
      );
      onChange(next);
    },
    [breakpoints, dataSpan, step, min, max, clampValue, onChange],
  );

  // ── Per-band label resolution ──────────────────────────────────

  const bandLabels = useMemo<readonly string[]>(() => {
    const computed: string[] = [];
    for (let i = 0; i < displayedBreakpoints.length - 1; i++) {
      const lo = displayedBreakpoints[i]!;
      const hi = displayedBreakpoints[i + 1]!;
      const custom = labels?.[i];
      if (custom && custom.trim() !== "") {
        computed.push(custom);
      } else {
        computed.push(`${formatNumber(lo)}–${formatNumber(hi)}`);
      }
    }
    return computed;
  }, [displayedBreakpoints, labels]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <svg
      ref={svgRef}
      className={`rater-breakpoint-scrubber rater-breakpoint-scrubber--${resolvedMode}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      data-testid={testId}
      data-mode={resolvedMode}
      aria-label={ariaLabel}
      role="group"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Axis baseline */}
      <line
        className="rater-breakpoint-scrubber__axis"
        x1={axisLeftPx}
        x2={axisRightPx}
        y1={axisY}
        y2={axisY}
      />

      {/* Band regions (between consecutive breakpoints). In compact
          mode we render the fill rectangles (alternating colors —
          they're the visual replacement for per-band labels) but
          skip the <text> nodes that would overlap. */}
      {displayedBreakpoints.length >= 2 &&
        displayedBreakpoints.slice(0, -1).map((lo, i) => {
          const hi = displayedBreakpoints[i + 1]!;
          const leftPx = dataToPx(lo);
          const rightPx = dataToPx(hi);
          const midPx = (leftPx + rightPx) / 2;
          const isEvenBand = i % 2 === 0;
          const isGap = gapIndexSet.has(i);
          return (
            <g
              key={`band-${i}`}
              className={`rater-breakpoint-scrubber__band rater-breakpoint-scrubber__band--${
                isEvenBand ? "even" : "odd"
              }${isGap ? " rater-breakpoint-scrubber__band--gap" : ""}`}
              data-band-gap={isGap || undefined}
            >
              <rect
                className="rater-breakpoint-scrubber__band-fill"
                x={leftPx}
                y={axisY - 12}
                width={Math.max(0, rightPx - leftPx)}
                height={24}
              />
              {isCompact ? null : (
                <text
                  className="rater-breakpoint-scrubber__band-label"
                  x={midPx}
                  y={LABEL_Y_FULL}
                  textAnchor="middle"
                >
                  {isGap ? "⚠ gap" : bandLabels[i]}
                </text>
              )}
            </g>
          );
        })}

      {/* Min / Max endpoint labels */}
      <text
        className="rater-breakpoint-scrubber__endpoint"
        x={axisLeftPx}
        y={axisY - 18}
        textAnchor="start"
      >
        {formatNumber(min)}
      </text>
      <text
        className="rater-breakpoint-scrubber__endpoint"
        x={axisRightPx}
        y={axisY - 18}
        textAnchor="end"
      >
        {formatNumber(max)}
      </text>

      {/* Handles + value tooltips. In compact mode the tooltip
          surfaces on hover/focus too (in addition to drag), so the
          user can read each band's range without a label row. */}
      {displayedBreakpoints.map((value, index) => {
        const cx = dataToPx(value);
        const isDragging = drag?.index === index;
        const isHoveredOrFocused = tooltipIndex === index;
        const showTooltip =
          isDragging || (isCompact && isHoveredOrFocused);
        const handleId = `${reactId}-handle-${index}`;
        return (
          <g key={`handle-${index}`} className="rater-breakpoint-scrubber__handle-group">
            <circle
              id={handleId}
              data-testid={`${testId}-handle-${index}`}
              className={`rater-breakpoint-scrubber__handle${
                isDragging ? " rater-breakpoint-scrubber__handle--dragging" : ""
              }`}
              cx={cx}
              cy={axisY}
              r={HANDLE_RADIUS}
              role="slider"
              tabIndex={0}
              aria-label={`Breakpoint ${index + 1}`}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={value}
              aria-valuetext={formatNumber(value)}
              onPointerDown={(event) => handlePointerDown(index, event)}
              onPointerEnter={() => {
                if (isCompact) setTooltipIndex(index);
              }}
              onPointerLeave={() => {
                if (isCompact && !drag) setTooltipIndex(null);
              }}
              onFocus={() => {
                if (isCompact) setTooltipIndex(index);
              }}
              onBlur={() => {
                if (isCompact) setTooltipIndex(null);
              }}
              onKeyDown={(event) => handleKeyDown(index, event)}
            />
            {showTooltip ? (
              <text
                className="rater-breakpoint-scrubber__handle-tooltip"
                x={cx}
                y={axisY - TOOLTIP_OFFSET}
                textAnchor="middle"
              >
                {formatNumber(value)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Formats a number for display next to a handle / band label.
 * Trims trailing zeros for integers; otherwise keeps up to 3
 * decimal places (matches CurvePlot's tick formatter style).
 *
 * Handles ±Infinity sentinels so callers can pass `-Infinity` /
 * `+Infinity` for open-ended bands.
 */
export function formatNumber(value: number): string {
  if (value === Number.NEGATIVE_INFINITY) return "−∞";
  if (value === Number.POSITIVE_INFINITY) return "+∞";
  if (Number.isInteger(value)) return String(value);
  // 3-decimal cap; trim trailing zeros.
  const fixed = value.toFixed(3);
  return fixed.replace(/\.?0+$/, "");
}
