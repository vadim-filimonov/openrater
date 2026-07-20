/**
 * insights — Brief 34 PR 34.3 + PR 34.6.
 *
 * The "auto-insights" DSL. Pure, deterministic, hand-rolled. No
 * LLM. Each generator inspects a factor table's cells + axes and
 * emits zero or more {@link Insight} entries that describe what
 * the actuary should notice without having to read every cell.
 *
 * Why pure functions: composable, testable, auditable, cheap. We
 * can rerun the whole panel on every cell-edit without measuring.
 *
 * Per Brief 34 §6 + mockup Frame 2/3 insights-list:
 *
 *   • monotonicity-break — banded row dim + `monotonicityExpected`
 *   • outlier            — |z| > 2 within row/col distribution
 *   • range              — always emitted: "Range 0.85–1.18 · spread 0.33"
 *   • all-default        — row or col where every cell is at the baseline
 *   • diagonal-smooth    — 2-D banded × banded: cells along `row+col=k`
 *                          stay within a tight band
 *   • all-discount / -surcharge — every cell sits below (or above) baseline
 *   • narrow-spread      — max − min < 0.05 (likely un-differentiated)
 *
 * PR 34.6 additions:
 *   • compare-delta — fires when `filedCells` is provided. One
 *     insight per row whose mean delta vs filed exceeds 2% (Brief
 *     34 §3 J3: "Vintage row up 5%").
 *   • monotonicityExpected accepts an explicit direction
 *     (`'increasing' | 'decreasing'`) in addition to the legacy
 *     boolean. When the direction is explicit, the generator no
 *     longer infers it from the data — actuary's expectation wins.
 *
 * Brief 34 §9 lists 7 generators — `all-discount` and `all-surcharge`
 * share one generator that picks the kind based on direction. With
 * PR 34.6 the compare-delta generator brings the total to 8.
 */

import {
  cellKey,
  type FactorTableGrid2DAxis,
} from "../FactorTableGrid2D";

/** All distinct insight kinds. */
export type InsightKind =
  | "monotonicity-break"
  | "outlier"
  | "range"
  | "all-default"
  | "diagonal-smooth"
  | "all-discount"
  | "all-surcharge"
  | "narrow-spread"
  /** PR 34.6 — row-level delta vs filed snapshot. */
  | "compare-delta";

/**
 * Direction discriminator for monotonicity-expected dims (Brief 30
 * follow-up locked in Brief 34 §−1). When set on a banded dim, the
 * monotonicity-break generator no longer infers direction from the
 * data — the actuary's expectation wins.
 */
export type MonotonicityExpectation =
  | "increasing"
  | "decreasing"
  /** Legacy boolean form — `true` keeps the infer-from-data behavior. */
  | boolean
  | null;

/** UI severity tier. Drives the panel's color + icon. */
export type InsightSeverity = "info" | "good" | "warn";

/**
 * Anchor for an insight that points at a specific cell. The panel
 * uses this to render a click-to-jump affordance (wired in PR 34.5).
 */
export interface CellAnchor {
  readonly rowId: string;
  /** `null` for 1-D tables. */
  readonly colId: string | null;
}

export interface Insight {
  readonly kind: InsightKind;
  readonly severity: InsightSeverity;
  /** Pre-rendered human copy. May contain `code:VALUE` markers
   *  the panel renders as inline `<code>`. Example:
   *  `"Range code:0.85–1.18 · spread code:0.33"`. */
  readonly message: string;
  readonly anchor?: CellAnchor;
}

/**
 * Default baseline (multiplicative identity). Generators use this
 * unless the caller overrides.
 */
export const INSIGHTS_BASELINE = 1;

/** Tolerance for "is at baseline" comparisons (1% slack to avoid
 *  flicker on rounding). */
const BASELINE_TOL = 0.01;

/** Default per-row sample size threshold for outlier z-score. */
const OUTLIER_Z_THRESHOLD = 2;

/** Narrow-spread band: max − min smaller than this is "un-differentiated". */
const NARROW_SPREAD_THRESHOLD = 0.05;

/** Diagonal-smoothness band: stdev across each anti-diagonal must
 *  be below this fraction of baseline. */
const DIAGONAL_STDEV_THRESHOLD = 0.03;

/** PR 34.6 — default per-row mean-delta threshold for compare-delta
 *  insights (fraction of baseline; 2%). */
export const COMPARE_DELTA_THRESHOLD = 0.02;

// ──────────────────────────────────────────────────────────────────
// Public input shape
// ──────────────────────────────────────────────────────────────────

export interface InsightInput {
  /** Row axis. Required. */
  readonly rowAxis: FactorTableGrid2DAxis;
  /** Col axis. Omit for 1-D tables. */
  readonly colAxis?: FactorTableGrid2DAxis;
  /** Cell values keyed by `cellKey(rowId, colId)`. */
  readonly cells: ReadonlyMap<string, number>;
  /** Baseline. Defaults to 1.0. */
  readonly baseline?: number;
  /**
   * Whether each axis is "banded" (ordered). Drives monotonicity
   * + diagonal-smooth. When omitted, defaults to `{ row: false,
   * col: false }` (no order-sensitive insights).
   */
  readonly isBanded?: {
    readonly row?: boolean;
    readonly col?: boolean;
  };
  /**
   * Whether the dim explicitly opts into monotonicity checking.
   * Per Brief 34: "Monotonicity checking is opt-in per dim."
   *
   *   • `false` / `null` → suppress monotonicity-break insights
   *     even if the row axis is banded
   *   • `true`           → run with direction INFERRED from the
   *     first non-equal pair (legacy behavior)
   *   • `'increasing'` / `'decreasing'` → PR 34.6 — run with the
   *     direction explicitly locked. Steps that move the OTHER
   *     way are reported as breaks regardless of magnitude.
   */
  readonly monotonicityExpected?: MonotonicityExpectation;
  /**
   * PR 34.6 — Filed snapshot to compare against. When provided,
   * the compare-delta generator emits one insight per row whose
   * mean delta from filed exceeds `compareDeltaThreshold` (default
   * 0.02 = 2%). When omitted, no delta insights are emitted —
   * compare mode is off.
   */
  readonly filedCells?: ReadonlyMap<string, number>;
  /**
   * PR 34.6 — Override the per-row delta threshold for compare-
   * delta insights. Defaults to 0.02 (2%). Set higher to surface
   * only large deltas; lower to be more sensitive.
   */
  readonly compareDeltaThreshold?: number;
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/** Three-decimal trim, never scientific. */
function fmt(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(3).replace(/\.?0+$/, "") || "0";
}

/** Walk every cell that has a value. */
function* iterCells(
  input: InsightInput,
): Iterable<{ readonly rowId: string; readonly colId: string | null; readonly value: number }> {
  const { rowAxis, colAxis, cells } = input;
  const is2D = colAxis !== undefined;
  for (const row of rowAxis.values) {
    if (is2D) {
      for (const col of colAxis!.values) {
        const v = cells.get(cellKey(row.id, col.id));
        if (v !== undefined) yield { rowId: row.id, colId: col.id, value: v };
      }
    } else {
      const v = cells.get(cellKey(row.id, null));
      if (v !== undefined) yield { rowId: row.id, colId: null, value: v };
    }
  }
}

/** Pull all values out as an array. */
function allValues(input: InsightInput): number[] {
  const out: number[] = [];
  for (const c of iterCells(input)) out.push(c.value);
  return out;
}

/** Population stdev. */
function stdev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(sq / values.length);
}

// ──────────────────────────────────────────────────────────────────
// Generator 1 — range (always emitted)
// ──────────────────────────────────────────────────────────────────

/**
 * Always emits one insight describing the data range + spread.
 * The bedrock observation; everything else is conditional.
 */
export function generateRange(input: InsightInput): readonly Insight[] {
  const values = allValues(input);
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  return [
    {
      kind: "range",
      severity: "info",
      message: `Range code:${fmt(min)}–${fmt(max)} · spread code:${fmt(spread)}`,
    },
  ];
}

// ──────────────────────────────────────────────────────────────────
// Generator 2 — monotonicity-break (banded rows only)
// ──────────────────────────────────────────────────────────────────

/**
 * Resolve the caller's MonotonicityExpectation into an
 * (enabled, fixedDirection) pair the generator uses internally.
 *
 *   • null / false / undefined → disabled
 *   • true                     → enabled; direction inferred
 *   • 'increasing'             → enabled; direction = +1
 *   • 'decreasing'             → enabled; direction = -1
 */
function resolveMonotonicityIntent(
  expectation: MonotonicityExpectation | undefined,
): { readonly enabled: boolean; readonly fixedDirection: 1 | -1 | 0 } {
  if (expectation === true) return { enabled: true, fixedDirection: 0 };
  if (expectation === "increasing") return { enabled: true, fixedDirection: 1 };
  if (expectation === "decreasing") return { enabled: true, fixedDirection: -1 };
  return { enabled: false, fixedDirection: 0 };
}

/**
 * For each col, walk the (ordered) banded row axis and flag any
 * step where the value doesn't move in the expected direction.
 *
 * When the caller supplies an explicit direction
 * (`'increasing'` / `'decreasing'`), the generator uses it
 * directly. When the caller supplies `true`, the direction is
 * inferred from the first non-equal pair per col (legacy
 * behavior). Equal values are tolerated (no break).
 */
export function generateMonotonicityBreak(
  input: InsightInput,
): readonly Insight[] {
  const intent = resolveMonotonicityIntent(input.monotonicityExpected);
  if (!intent.enabled) return [];
  if (!input.isBanded?.row) return [];

  const { rowAxis, colAxis, cells } = input;
  const out: Insight[] = [];
  const is2D = colAxis !== undefined;
  const cols: readonly (string | null)[] = is2D
    ? colAxis!.values.map((c) => c.id)
    : [null];

  for (const colId of cols) {
    const seq: { readonly rowId: string; readonly rowLabel: string; readonly value: number }[] = [];
    for (const row of rowAxis.values) {
      const v = cells.get(cellKey(row.id, colId));
      if (v !== undefined) seq.push({ rowId: row.id, rowLabel: row.label, value: v });
    }
    if (seq.length < 2) continue;

    // Direction policy:
    //   • Fixed (PR 34.6) — caller pinned to +1 or -1; use as-is.
    //   • Inferred — walk for the first non-equal pair and lock there.
    let direction: 1 | -1 | 0 = intent.fixedDirection;
    if (direction === 0) {
      for (let i = 1; i < seq.length; i++) {
        const a = seq[i - 1]!.value;
        const b = seq[i]!.value;
        if (b > a) {
          direction = 1;
          break;
        }
        if (b < a) {
          direction = -1;
          break;
        }
      }
    }
    if (direction === 0) continue; // entirely flat — no break possible.

    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1]!;
      const cur = seq[i]!;
      const delta = cur.value - prev.value;
      if (direction === 1 && delta < 0) {
        const colSuffix = colId !== null ? ` (col code:${colId})` : "";
        out.push({
          kind: "monotonicity-break",
          severity: "warn",
          message: `Monotonicity break: code:${cur.rowLabel} (code:${fmt(cur.value)}) dips below code:${prev.rowLabel} (code:${fmt(prev.value)})${colSuffix}.`,
          anchor: { rowId: cur.rowId, colId },
        });
      } else if (direction === -1 && delta > 0) {
        const colSuffix = colId !== null ? ` (col code:${colId})` : "";
        out.push({
          kind: "monotonicity-break",
          severity: "warn",
          message: `Monotonicity break: code:${cur.rowLabel} (code:${fmt(cur.value)}) climbs above code:${prev.rowLabel} (code:${fmt(prev.value)})${colSuffix}.`,
          anchor: { rowId: cur.rowId, colId },
        });
      }
    }
  }

  return out;
}

// ──────────────────────────────────────────────────────────────────
// Generator 3 — outlier (|z| > 2 within the table)
// ──────────────────────────────────────────────────────────────────

/**
 * Flag cells whose z-score (relative to the full table's mean +
 * stdev) exceeds {@link OUTLIER_Z_THRESHOLD}. Skips tables that
 * have fewer than 5 cells (z-score is noisy on tiny samples).
 */
export function generateOutlier(input: InsightInput): readonly Insight[] {
  const values = allValues(input);
  if (values.length < 5) return [];
  const sd = stdev(values);
  if (sd === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const out: Insight[] = [];
  for (const c of iterCells(input)) {
    const z = Math.abs(c.value - mean) / sd;
    if (z > OUTLIER_Z_THRESHOLD) {
      const direction = c.value > mean ? "above" : "below";
      out.push({
        kind: "outlier",
        severity: "warn",
        message: `Outlier: cell code:${fmt(c.value)} sits ~code:${z.toFixed(1)}σ ${direction} the table mean.`,
        anchor: { rowId: c.rowId, colId: c.colId },
      });
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Generator 4 — all-default (row or col with no differentiation)
// ──────────────────────────────────────────────────────────────────

/**
 * Flag any row or col where every cell is at the baseline (within
 * tolerance). Surfaces as a calm "un-differentiated" cue.
 */
export function generateAllDefault(input: InsightInput): readonly Insight[] {
  const { rowAxis, colAxis, cells, baseline = INSIGHTS_BASELINE } = input;
  const is2D = colAxis !== undefined;
  const out: Insight[] = [];

  const isAtBaseline = (v: number): boolean =>
    Math.abs(v - baseline) < baseline * BASELINE_TOL;

  // Per-row check
  for (const row of rowAxis.values) {
    let any = false;
    let allDefault = true;
    if (is2D) {
      for (const col of colAxis!.values) {
        const v = cells.get(cellKey(row.id, col.id));
        if (v === undefined) continue;
        any = true;
        if (!isAtBaseline(v)) {
          allDefault = false;
          break;
        }
      }
    } else {
      const v = cells.get(cellKey(row.id, null));
      if (v !== undefined) {
        any = true;
        allDefault = isAtBaseline(v);
      }
    }
    if (any && allDefault) {
      out.push({
        kind: "all-default",
        severity: "info",
        message: `Row code:${row.label} is all at baseline (un-differentiated).`,
        anchor: { rowId: row.id, colId: null },
      });
    }
  }

  // Per-col check (2-D only)
  if (is2D) {
    for (const col of colAxis!.values) {
      let any = false;
      let allDefault = true;
      for (const row of rowAxis.values) {
        const v = cells.get(cellKey(row.id, col.id));
        if (v === undefined) continue;
        any = true;
        if (!isAtBaseline(v)) {
          allDefault = false;
          break;
        }
      }
      if (any && allDefault) {
        out.push({
          kind: "all-default",
          severity: "info",
          message: `Column code:${col.label} is all at baseline (un-differentiated).`,
          anchor: { rowId: rowAxis.values[0]?.id ?? "", colId: col.id },
        });
      }
    }
  }

  return out;
}

// ──────────────────────────────────────────────────────────────────
// Generator 5 — diagonal-smooth (2-D banded × banded only)
// ──────────────────────────────────────────────────────────────────

/**
 * Cells along each anti-diagonal (`rowIdx + colIdx = k`) should
 * sit within a tight band if the table has additive structure.
 * Emits a "good" insight when the average stdev across all
 * anti-diagonals stays below {@link DIAGONAL_STDEV_THRESHOLD}
 * times the baseline.
 */
export function generateDiagonalSmooth(
  input: InsightInput,
): readonly Insight[] {
  const { rowAxis, colAxis, cells, baseline = INSIGHTS_BASELINE } = input;
  if (!colAxis) return [];
  if (!input.isBanded?.row || !input.isBanded?.col) return [];
  if (rowAxis.values.length < 2 || colAxis.values.length < 2) return [];

  const diagonals = new Map<number, number[]>();
  rowAxis.values.forEach((row, rIdx) => {
    colAxis.values.forEach((col, cIdx) => {
      const v = cells.get(cellKey(row.id, col.id));
      if (v === undefined) return;
      const k = rIdx + cIdx;
      const arr = diagonals.get(k) ?? [];
      arr.push(v);
      diagonals.set(k, arr);
    });
  });

  // Need at least 3 anti-diagonals with > 1 cell each to even
  // consider the table additive.
  const usable = Array.from(diagonals.values()).filter(
    (arr) => arr.length >= 2,
  );
  if (usable.length < 3) return [];

  const avgStdev =
    usable.reduce((acc, arr) => acc + stdev(arr), 0) / usable.length;
  if (avgStdev < baseline * DIAGONAL_STDEV_THRESHOLD) {
    return [
      {
        kind: "diagonal-smooth",
        severity: "good",
        message: `Diagonals are smooth (avg stdev code:${fmt(avgStdev)}) — table reads as additive.`,
      },
    ];
  }
  return [];
}

// ──────────────────────────────────────────────────────────────────
// Generator 6 — all-discount / all-surcharge
// ──────────────────────────────────────────────────────────────────

/**
 * If every cell sits strictly below the baseline, emit
 * `all-discount`. If strictly above, emit `all-surcharge`.
 * Otherwise no insight.
 */
export function generateAllOnSide(input: InsightInput): readonly Insight[] {
  const values = allValues(input);
  if (values.length === 0) return [];
  const baseline = input.baseline ?? INSIGHTS_BASELINE;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max <= baseline * (1 - BASELINE_TOL)) {
    return [
      {
        kind: "all-discount",
        severity: "info",
        message: `Every cell is a discount (≤ baseline) · spread code:${fmt(max - min)}.`,
      },
    ];
  }
  if (min >= baseline * (1 + BASELINE_TOL)) {
    return [
      {
        kind: "all-surcharge",
        severity: "info",
        message: `Every cell is a surcharge (≥ baseline) · spread code:${fmt(max - min)}.`,
      },
    ];
  }
  return [];
}

// ──────────────────────────────────────────────────────────────────
// Generator 7 — narrow-spread (probably un-differentiated)
// ──────────────────────────────────────────────────────────────────

/**
 * If the spread (max − min) is smaller than {@link
 * NARROW_SPREAD_THRESHOLD}, the table is probably stub data the
 * actuary hasn't differentiated yet. Emit a calm hint.
 */
export function generateNarrowSpread(
  input: InsightInput,
): readonly Insight[] {
  const values = allValues(input);
  if (values.length < 2) return [];
  const spread = Math.max(...values) - Math.min(...values);
  if (spread < NARROW_SPREAD_THRESHOLD) {
    return [
      {
        kind: "narrow-spread",
        severity: "info",
        message: `Narrow spread (code:${fmt(spread)}) — looks un-differentiated.`,
      },
    ];
  }
  return [];
}

// ──────────────────────────────────────────────────────────────────
// Generator 8 — compare-delta (PR 34.6 — fires only when compare
// mode is on, i.e. `filedCells` is provided)
// ──────────────────────────────────────────────────────────────────

/**
 * For each row, compute the mean fractional delta between the
 * current cell values and the filed snapshot. Emit one insight
 * per row whose magnitude exceeds {@link COMPARE_DELTA_THRESHOLD}
 * (overridable via `input.compareDeltaThreshold`).
 *
 * Per Brief 34 §3 J3: "Where the curves diverge, deltas surface in
 * the insights panel ('Vintage row up 5%')."
 *
 * The insight anchors to the row's first cell so click-to-jump
 * lands on a stable cell. Cells missing from EITHER side are
 * skipped (delta undefined). A row with no comparable cells emits
 * nothing.
 */
export function generateCompareDelta(input: InsightInput): readonly Insight[] {
  const filed = input.filedCells;
  if (!filed || filed.size === 0) return [];
  const threshold = input.compareDeltaThreshold ?? COMPARE_DELTA_THRESHOLD;
  const { rowAxis, colAxis, cells } = input;
  const is2D = colAxis !== undefined;
  const out: Insight[] = [];

  for (const row of rowAxis.values) {
    const deltas: number[] = [];
    let firstColId: string | null = null;
    if (is2D) {
      for (const col of colAxis!.values) {
        const key = cellKey(row.id, col.id);
        const cur = cells.get(key);
        const old = filed.get(key);
        if (cur === undefined || old === undefined) continue;
        if (old === 0) continue; // avoid div-by-zero
        deltas.push((cur - old) / old);
        if (firstColId === null) firstColId = col.id;
      }
    } else {
      const key = cellKey(row.id, null);
      const cur = cells.get(key);
      const old = filed.get(key);
      if (cur !== undefined && old !== undefined && old !== 0) {
        deltas.push((cur - old) / old);
      }
    }
    if (deltas.length === 0) continue;
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    if (Math.abs(mean) < threshold) continue;
    const pct = mean * 100;
    const direction = mean > 0 ? "up" : "down";
    const pctStr = `${Math.abs(pct).toFixed(1)}%`;
    out.push({
      kind: "compare-delta",
      severity: "info",
      message: `Row code:${row.label} ${direction} code:${pctStr} vs filed.`,
      anchor: { rowId: row.id, colId: is2D ? firstColId : null },
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────────

/**
 * Run every generator and merge the results. Order matches the
 * Brief 34 §6 list (range first since it always fires, then the
 * conditionals). Compare-delta runs last so it appears AFTER the
 * "always-on" facts but BEFORE the outliers — the conceptual order
 * is "what's here · how it compares · what stands out". Consumers
 * can also call individual generators if they need finer control
 * over the panel composition.
 */
export function runInsights(input: InsightInput): readonly Insight[] {
  return [
    ...generateRange(input),
    ...generateMonotonicityBreak(input),
    ...generateAllOnSide(input),
    ...generateNarrowSpread(input),
    ...generateDiagonalSmooth(input),
    ...generateAllDefault(input),
    ...generateCompareDelta(input),
    ...generateOutlier(input),
  ];
}
