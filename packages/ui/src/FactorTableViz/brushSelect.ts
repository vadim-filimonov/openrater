/**
 * brushSelect — Brief 34 PR 34.5.
 *
 * Pure helpers that resolve a brush rectangle (in chart viewBox
 * coords) into the set of cell keys it selects, per Brief 34 §5.3:
 *
 *   "Drag rectangle on the chart → cells in the selection select in
 *    the grid."
 *
 * The functions here are intentionally chart-shape agnostic. Each
 * chart primitive does its own pointer capture + viewBox-coord
 * computation, then hands a `BrushRect` + axis data to one of these
 * functions to derive the cellKey set. The orchestrator
 * (<FactorTableViz>) routes that set through `onBrushSelect` to the
 * parent, which writes it into the grid's `selectedCells`.
 *
 * v1 covers 1-D charts (bar/line — keys are row ids) + 2-D
 * banded × categorical (line-multiples — brush is x-extent only,
 * emits cellKey for every (rowId in extent) × (every colId)).
 * HeatmapGrid brush is deferred (the grid already supports shift-
 * click rectangle selection from Brief 33 PR 33.4).
 */

import { cellKey } from "../FactorTableGrid2D";

/** A brush rectangle in chart viewBox coords (after pointer→SVG conversion). */
export interface BrushRect {
  /** Min x (inclusive). */
  readonly x1: number;
  /** Max x (inclusive). */
  readonly x2: number;
  /** Min y (inclusive). Optional — used only for 2-D brush. */
  readonly y1?: number;
  /** Max y (inclusive). Optional — used only for 2-D brush. */
  readonly y2?: number;
}

/** Datum X position in viewBox coords (matches chartAxis output shape). */
export interface XPosition {
  readonly center: number;
  readonly slot: number;
}

/**
 * Compute the set of datum keys whose X-center falls within the
 * brush rectangle's [x1, x2] range. Used by 1-D charts (bar/line)
 * where the brush selects datums by X extent only.
 *
 * Bounds are inclusive at both ends. Order of x1/x2 doesn't matter.
 */
export function keysInXExtent(args: {
  readonly dataKeys: readonly string[];
  readonly xPositions: readonly XPosition[];
  readonly brush: BrushRect;
}): Set<string> {
  const { dataKeys, xPositions, brush } = args;
  const xMin = Math.min(brush.x1, brush.x2);
  const xMax = Math.max(brush.x1, brush.x2);
  const out = new Set<string>();
  for (let i = 0; i < dataKeys.length; i++) {
    const pos = xPositions[i];
    const key = dataKeys[i];
    if (pos === undefined || key === undefined) continue;
    if (pos.center >= xMin && pos.center <= xMax) {
      out.add(key);
    }
  }
  return out;
}

/**
 * Compute cellKey set for a 2-D banded × categorical chart (line-
 * multiples). The brush selects datums by row-axis X extent;
 * every (rowId in extent) × (every colId) pair joins the selection.
 */
export function cellKeysInXExtent2D(args: {
  readonly rowIds: readonly string[];
  readonly colIds: readonly string[];
  readonly xPositions: readonly XPosition[];
  readonly brush: BrushRect;
}): Set<string> {
  const { rowIds, colIds, xPositions, brush } = args;
  const xMin = Math.min(brush.x1, brush.x2);
  const xMax = Math.max(brush.x1, brush.x2);
  const out = new Set<string>();
  for (let i = 0; i < rowIds.length; i++) {
    const pos = xPositions[i];
    const rowId = rowIds[i];
    if (pos === undefined || rowId === undefined) continue;
    if (pos.center < xMin || pos.center > xMax) continue;
    for (const colId of colIds) {
      out.add(cellKey(rowId, colId));
    }
  }
  return out;
}

/**
 * Convert a clientX/clientY pair into the SVG element's viewBox
 * coordinate system. Use this before passing the brush rect to
 * the helpers above.
 *
 * Returns null if the SVG has no current bounding rect (defensive —
 * detached elements).
 */
export function clientToSvgCoords(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { readonly x: number; readonly y: number } | null {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const viewBox = svg.viewBox.baseVal;
  // viewBox may be empty (rare). Fall back to the BBox.
  const vbW = viewBox.width || rect.width;
  const vbH = viewBox.height || rect.height;
  const x = ((clientX - rect.left) / rect.width) * vbW;
  const y = ((clientY - rect.top) / rect.height) * vbH;
  return { x, y };
}

/**
 * Normalize a brush in-progress: returns a stable rect with x1<=x2
 * and y1<=y2 so consumers don't have to worry about drag direction.
 */
export function normalizeBrush(rect: BrushRect): Required<BrushRect> {
  return {
    x1: Math.min(rect.x1, rect.x2),
    x2: Math.max(rect.x1, rect.x2),
    y1: Math.min(rect.y1 ?? 0, rect.y2 ?? 0),
    y2: Math.max(rect.y1 ?? 0, rect.y2 ?? 0),
  };
}

/**
 * Minimum brush width (in viewBox units) before we treat a drag as
 * a brush rather than a click. Anything smaller is a click — fire
 * `onPointClick` instead.
 */
export const BRUSH_MIN_WIDTH = 6;

/**
 * Detect whether a brush is large enough to count as a brush gesture
 * (vs an accidental click-drag).
 */
export function isBrushSignificant(rect: BrushRect): boolean {
  return Math.abs(rect.x2 - rect.x1) >= BRUSH_MIN_WIDTH;
}

/**
 * Find the datum key nearest to a given X coord, within a half-slot
 * snap radius. Returns null if no datum is within range — used by
 * 1-D chart click-to-focus dispatch when the brush gesture
 * disambiguates as a click. Caller passes datum keys in the same
 * order as `xPositions`.
 */
export function nearestKeyAtX(args: {
  readonly dataKeys: readonly string[];
  readonly xPositions: readonly XPosition[];
  readonly x: number;
}): string | null {
  const { dataKeys, xPositions, x } = args;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < dataKeys.length; i++) {
    const pos = xPositions[i];
    if (pos === undefined) continue;
    const dist = Math.abs(pos.center - x);
    // Within half-slot snaps; beyond that the click is between slots.
    if (dist <= pos.slot / 2 && dist < bestDist) {
      bestIdx = i;
      bestDist = dist;
    }
  }
  if (bestIdx < 0) return null;
  return dataKeys[bestIdx] ?? null;
}
