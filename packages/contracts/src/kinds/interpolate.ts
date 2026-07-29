/**
 * `interpolate` kind — linear interpolation between breakpoints.
 *
 * A relativity the filing INTERPOLATES (ISO BOP Rule 23.A.2.d — a
 * building-limit factor read off a curve between breakpoints) can't be
 * expressed by a banded factor table, which STEPS at the band's lower
 * bound. `derive.band` discards the continuous value, so nothing
 * downstream has both the actual `x` and the two bracketing factors —
 * exactly what interpolation needs (audit A-2026-07-12 P5-01, the F14
 * gap; ADR-0063).
 *
 * This is the ~60-line interpolation MATH only. It restores what Brief
 * 34 PR 34.7 removed alongside the (rightly-cut) 2.5k-line Curve
 * authoring surface — none of that surface returns; the projector wires
 * this from a factor table flagged `interpolation: "linear"`, reusing
 * the table's breakpoints as `points`.
 *
 * Given ascending `points` [(x₀,y₀)…(xₙ,yₙ)] and an input `x`:
 *   - x on a breakpoint → that point's y, byte-exact (so a plan sitting
 *     on breakpoints — every non-F14 vector — is unchanged);
 *   - x between xᵢ and xᵢ₊₁ → yᵢ + (x−xᵢ)/(xᵢ₊₁−xᵢ)·(yᵢ₊₁−yᵢ);
 *   - x outside [x₀, xₙ] → the nearest endpoint y when `clamp` (default),
 *     else linear extrapolation off the end segment;
 *   - non-finite x (or no points) → NaN, which the output backstop
 *     WITHHOLDS (ADR-0056; never improvise a premium, audit P1-01).
 *
 * Pure: same (x, points) → same y forever (reproducibility §6).
 */

import type { BlockKind, PortSpec } from "../block-types";
import { toFiniteNumber } from "./coerce-numeric";

export interface InterpolatePoint {
  readonly x: number;
  readonly y: number;
}

export interface InterpolateParams {
  /** Breakpoints, MUST be sorted ascending by x. Projected from the
   *  factor table's (breakpoint → factor) pairs at compile time. */
  readonly points: readonly InterpolatePoint[];
  /** Only `"linear"` today. Reserved so a filing needing spline/log
   *  interpolation adds a mode here rather than a new kind. */
  readonly mode?: "linear";
  /** x outside [x₀, xₙ] → nearest endpoint y (true, default) vs. linear
   *  extrapolation off the end segment (false). A factor table almost
   *  always wants the clamp. */
  readonly clamp?: boolean;
  /** Audit-facing name for the interpolated axis (e.g. the dim slug). */
  readonly axisLabel?: string;
}

export type InterpolateInputs = { x: number };
export type InterpolateOutputs = { y: number };

/**
 * The shared linear-interpolation core. Exported for `lookup.multi`'s
 * `interpolateOn` (ADR-0063 amendment — 2-D-axis interpolation reuses
 * THIS math so a 1-D `interpolate` node and an interpolated table axis
 * can never drift).
 */
export function interpolateLinear(
  x: number,
  points: readonly InterpolatePoint[],
  clamp: boolean,
): number {
  if (points.length === 0) return NaN;
  if (points.length === 1) return toFiniteNumber(points[0]!.y);

  // Below the first breakpoint.
  const first = points[0]!;
  const x0 = toFiniteNumber(first.x);
  if (x <= x0) {
    if (clamp || points.length < 2) return toFiniteNumber(first.y);
    const second = points[1]!;
    return _segment(x, x0, toFiniteNumber(first.y), toFiniteNumber(second.x), toFiniteNumber(second.y));
  }

  // Above the last breakpoint.
  const last = points[points.length - 1]!;
  const xn = toFiniteNumber(last.x);
  if (x >= xn) {
    if (clamp) return toFiniteNumber(last.y);
    const prev = points[points.length - 2]!;
    return _segment(x, toFiniteNumber(prev.x), toFiniteNumber(prev.y), xn, toFiniteNumber(last.y));
  }

  // Find the bracketing segment [xᵢ, xᵢ₊₁].
  for (let i = 0; i < points.length - 1; i++) {
    const xi = toFiniteNumber(points[i]!.x);
    const xj = toFiniteNumber(points[i + 1]!.x);
    if (x >= xi && x <= xj) {
      return _segment(x, xi, toFiniteNumber(points[i]!.y), xj, toFiniteNumber(points[i + 1]!.y));
    }
  }
  return NaN; // unreachable for ascending points, but never improvise.
}

function _segment(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) {
    return NaN;
  }
  if (x1 === x0) return y0; // degenerate segment: no width, take the lower y.
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

export const InterpolateKind: BlockKind<
  InterpolateParams,
  InterpolateInputs,
  InterpolateOutputs
> = {
  id: "interpolate",
  category: "transform",
  label: "Interpolate",
  description: "Linear interpolation of a factor between breakpoints",
  inputs: [
    {
      name: "x",
      type: "float",
      description: "The continuous value to look up (e.g. building limit)",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "y",
      type: "factor",
      description: "The interpolated factor",
    } as PortSpec,
  ],
  defaultParams: { points: [], mode: "linear", clamp: true },
  defaultSize: "compact",
  execute: (inputs, params) => {
    const x = toFiniteNumber(inputs.x);
    if (Number.isNaN(x)) return { y: NaN };
    return { y: interpolateLinear(x, params.points ?? [], params.clamp ?? true) };
  },
  validate: (params) => {
    const points = params.points ?? [];
    const issues: { severity: "error" | "warning"; message: string }[] = [];
    for (let i = 1; i < points.length; i++) {
      if (toFiniteNumber(points[i]!.x) <= toFiniteNumber(points[i - 1]!.x)) {
        issues.push({
          severity: "error",
          message: `interpolate: points must be strictly x-ascending; point ${i} (x=${points[i]!.x}) is not greater than point ${i - 1} (x=${points[i - 1]!.x}).`,
        });
        break;
      }
    }
    return { valid: issues.length === 0, issues };
  },
  jacobian: (inputs, params) => {
    // ∂y/∂x = the slope of the active segment (0 in a clamped tail).
    const x = toFiniteNumber(inputs.x);
    const pts = params.points ?? [];
    let slope = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const xi = toFiniteNumber(pts[i]!.x);
      const xj = toFiniteNumber(pts[i + 1]!.x);
      if (x >= xi && x <= xj && xj !== xi) {
        slope = (toFiniteNumber(pts[i + 1]!.y) - toFiniteNumber(pts[i]!.y)) / (xj - xi);
        break;
      }
    }
    return { "y/x": { x: slope } };
  },
  explainStep: (inputs, params, outputs) => {
    const x = toFiniteNumber(inputs.x);
    const pts = params.points ?? [];
    const axis = params.axisLabel ? `${params.axisLabel}=` : "x=";
    // FCA #34 (findings 40/47) — an exactly-on-anchor lookup was
    // narrated as interpolation ("between (600000, …) and
    // (1000000, …)"), describing a boundary hit as inside a segment.
    // An anchor hit says what it is.
    for (const p of pts) {
      if (toFiniteNumber(p.x) === x) {
        return `${axis}${x} at the (${p.x}, ${p.y}) anchor → ${outputs.y}`;
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const xi = toFiniteNumber(pts[i]!.x);
      const xj = toFiniteNumber(pts[i + 1]!.x);
      if (x >= xi && x <= xj) {
        return `${axis}${x} between (${pts[i]!.x}, ${pts[i]!.y}) and (${pts[i + 1]!.x}, ${pts[i + 1]!.y}) → ${outputs.y}`;
      }
    }
    return `${axis}${x} → ${outputs.y} (clamped)`;
  },
};
