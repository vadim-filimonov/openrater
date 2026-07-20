/**
 * Exhibits — pure derivations for the wall (current Exhibits design).
 *
 * Everything the exhibit draws is computed here from the plan substrate
 * the API already serves: factor tables (with inline cell maps) and
 * dimensions (with filed level order, geo territories, and the declared
 * monotonicity expectation). No fetching, no JSX — the route renders
 * what these functions return, and the tests pin the derivations.
 *
 * Honesty rules carried from the brief:
 *   - A span is UNIVARIATE (×min–max of one table, others held fixed);
 *     nothing here compounds maxima across tables.
 *   - Monotonicity is judged only where the dimension DECLARES an
 *     expectation — we verify the filing's own claim, never invent one.
 */

import type { PlanDimension, PlanFactorTable } from "@openrater/api-client";

/** How a tile draws. Decided from the table's key dimensions. */
export type TileKind =
  | "strip" // 1 categorical dim, many levels — sorted bar strip
  | "bars" // 1 dim, few levels or geographic — labeled level bars
  | "dots" // 1 dim, ≤3 levels — dot-on-track per level
  | "curve" // 1 banded dim — the classic ILF curve
  | "grid" // 2 dims — the compact cell grid
  | "flat"; // 0 key dims — a single factor

export interface TableSpan {
  readonly min: number;
  readonly max: number;
  /** max/min — the honest univariate "how much can this move price".
   *  Null when min ≤ 0 (a ratio would mislead). */
  readonly ratio: number | null;
}

export interface LevelValue {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

export interface MonotonicityVerdict {
  /** The filing's declared expectation, normalized. */
  readonly expected: "increasing" | "decreasing" | "monotone";
  /** Does the cell sequence (in filed level order) honor it? */
  readonly holds: boolean;
}

export interface ExhibitTile {
  readonly table: PlanFactorTable;
  readonly kind: TileKind;
  readonly span: TableSpan | null;
  /** The resolved key dimension for 1-D tables; null otherwise. */
  readonly dim: PlanDimension | null;
  /** Cell values in filed level order (1-D tables only). */
  readonly values: readonly LevelValue[];
  /** Present only when the dimension declares an expectation. */
  readonly monotonicity: MonotonicityVerdict | null;
}

/** min/max/ratio over a table's cell values; null when empty. */
export function tableSpan(
  cells: Readonly<Record<string, number>>,
): TableSpan | null {
  const values = Object.values(cells).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, ratio: min > 0 ? max / min : null };
}

/** Format a span badge: "×0.74–2.10" (trailing-zero-stable, mono-ready). */
export function formatSpan(span: TableSpan): string {
  return `×${span.min.toFixed(2)}–${span.max.toFixed(2)}`;
}

/**
 * Resolve a table's single key dimension. `key_dimensions` entries are
 * dim ids in current authoring; slugs appear in older plans — accept
 * either.
 */
export function resolveKeyDimension(
  table: PlanFactorTable,
  dims: readonly PlanDimension[],
): PlanDimension | null {
  if (table.key_dimensions.length !== 1) return null;
  const key = table.key_dimensions[0];
  return dims.find((d) => d.dim_id === key || d.slug === key) ?? null;
}

/**
 * A 1-D table's cell for a given level. The seeded/authoring encoding
 * keys cells by the bare level id; the documented client-side encoding
 * is `dim=level`. Accept both, bare id first.
 */
export function cellValueForLevel(
  table: PlanFactorTable,
  dim: PlanDimension,
  levelId: string,
): number | null {
  const direct = table.cells[levelId];
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const namespaced = table.cells[`${dim.dim_id}=${levelId}`];
  if (typeof namespaced === "number" && Number.isFinite(namespaced))
    return namespaced;
  return null;
}

interface LevelRecord {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly kind?: unknown;
}

/** Cell values in the dimension's FILED order; missing cells skipped.
 *
 *  Geographic dims rate their TERRITORIES, not their member levels —
 *  the levels are ZIPs/counties, the cells are keyed by territory id
 *  (Brief 44 §3.1) — so a grouped geo dim reads `geo_territories`. */
export function orderedLevelValues(
  table: PlanFactorTable,
  dim: PlanDimension,
): readonly LevelValue[] {
  const territories = dim.geo_territories;
  const domain: readonly { id?: unknown; label?: unknown }[] =
    isGeographic(dim) && territories !== null && territories !== undefined && territories.length > 0
      ? territories
      : (dim.levels as readonly LevelRecord[]);
  const out: LevelValue[] = [];
  for (const raw of domain) {
    const id = typeof raw.id === "string" ? raw.id : null;
    if (id === null) continue;
    const value = cellValueForLevel(table, dim, id);
    if (value === null) continue;
    const label = typeof raw.label === "string" && raw.label !== "" ? raw.label : id;
    out.push({ id, label, value });
  }
  return out;
}

/** True when the dim reads as banded (declared shape or level kind). */
function isBanded(dim: PlanDimension): boolean {
  if (dim.shape === "banded") return true;
  const first = (dim.levels as readonly LevelRecord[])[0];
  return first !== undefined && first.kind === "banded";
}

/** True when the dim reads as geographic (either era's marker). */
function isGeographic(dim: PlanDimension): boolean {
  return dim.dimension_type === "geographic" || dim.shape === "geographic";
}

/** Strip threshold — above this many levels, labels become texture. */
const STRIP_MIN_LEVELS = 13;

/** Decide how a table draws. */
export function tileKindFor(
  table: PlanFactorTable,
  dims: readonly PlanDimension[],
): TileKind {
  if (table.key_dimensions.length >= 2) return "grid";
  if (table.key_dimensions.length === 0) return "flat";
  const dim = resolveKeyDimension(table, dims);
  if (dim === null) return "flat";
  if (isGeographic(dim)) return "bars";
  if (isBanded(dim)) return "curve";
  const levelCount = dim.levels.length;
  if (levelCount > 0 && levelCount <= 3) return "dots";
  if (levelCount >= STRIP_MIN_LEVELS) return "strip";
  return "bars";
}

/**
 * Normalize the wire's `monotonicity_expected` (string | boolean | null)
 * to a declared expectation, or null when the filing declares none.
 */
export function normalizeMonotonicity(
  raw: string | boolean | null | undefined,
): MonotonicityVerdict["expected"] | null {
  if (raw === true) return "monotone";
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "increasing" || s === "ascending") return "increasing";
  if (s === "decreasing" || s === "descending") return "decreasing";
  if (s === "monotone" || s === "true") return "monotone";
  return null;
}

function nonDecreasing(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev === undefined || curr === undefined) continue;
    if (curr < prev) return false;
  }
  return true;
}

/**
 * Verify the declared expectation against the filed-order cell values.
 * Null when the dim declares nothing or there are <2 values to judge.
 */
export function monotonicityVerdict(
  dim: PlanDimension,
  values: readonly LevelValue[],
): MonotonicityVerdict | null {
  const expected = normalizeMonotonicity(dim.monotonicity_expected);
  if (expected === null || values.length < 2) return null;
  const seq = values.map((v) => v.value);
  const up = nonDecreasing(seq);
  const down = nonDecreasing([...seq].reverse());
  const holds =
    expected === "increasing" ? up : expected === "decreasing" ? down : up || down;
  return { expected, holds };
}

/**
 * The wall: one tile per factor table, sorted by univariate span ratio
 * (widest lever first — the sort order IS the tornado), stable on
 * display name so equal-span tiles don't shuffle between renders.
 */
export function exhibitTiles(
  dims: readonly PlanDimension[],
  tables: readonly PlanFactorTable[],
): readonly ExhibitTile[] {
  const tiles = tables.map((table): ExhibitTile => {
    const kind = tileKindFor(table, dims);
    const dim = resolveKeyDimension(table, dims);
    const values = dim === null ? [] : orderedLevelValues(table, dim);
    return {
      table,
      kind,
      span: tableSpan(table.cells),
      dim,
      values,
      monotonicity:
        dim !== null && kind === "curve"
          ? monotonicityVerdict(dim, values)
          : null,
    };
  });
  return [...tiles].sort((a, b) => {
    const ra = a.span?.ratio ?? 0;
    const rb = b.span?.ratio ?? 0;
    if (rb !== ra) return rb - ra;
    return a.table.display_name.localeCompare(b.table.display_name);
  });
}

/** The stage's drawing order: strips rank by value (shape), everything
 *  else keeps the FILED level order. Tables and exports mirror this. */
export function drawnValuesFor(tile: ExhibitTile): readonly LevelValue[] {
  return tile.kind === "strip"
    ? [...tile.values].sort((a, b) => b.value - a.value)
    : tile.values;
}

/**
 * Compare drawing order for DENSE strips (hundreds of class codes):
 * moved levels surface first, largest relative move leading, so the
 * diff is never buried under fourteen screens of unchanged rows.
 * Unchanged levels keep their value-sorted order below. Identity when
 * nothing moved (or no B side) — the portrait order stands.
 */
export function compareDrawnOrder(
  values: readonly LevelValue[],
  bValues: ReadonlyMap<string, number> | null,
): readonly LevelValue[] {
  if (bValues === null) return values;
  const move = (v: LevelValue): number => {
    const b = bValues.get(v.id);
    if (b === undefined) return 0;
    const delta = Math.abs(b - v.value);
    if (delta <= 1e-9) return 0;
    return v.value !== 0 ? Math.abs(b / v.value - 1) : delta;
  };
  const changed = values
    .filter((v) => move(v) > 0)
    .sort((a, b) => move(b) - move(a));
  if (changed.length === 0) return values;
  return [...changed, ...values.filter((v) => move(v) === 0)];
}

// ── The lede's counted facts (template inputs, never prose-by-AI) ────

export interface LedeFacts {
  /** Rating inputs the plan asks for (its dimensions). */
  readonly answers: number;
  /** The widest lever, by univariate ratio. */
  readonly widest: { readonly name: string; readonly ratio: number } | null;
  /** Geographic story, when the plan has one. */
  readonly territory: {
    readonly count: number;
    readonly grain: string;
    /** Largest tilt away from ×1.00 among territory-keyed tables, in %. */
    readonly tiltPct: number | null;
  } | null;
}

export function ledeFacts(
  dims: readonly PlanDimension[],
  tiles: readonly ExhibitTile[],
): LedeFacts {
  const widestTile = tiles.find((t) => (t.span?.ratio ?? 0) > 1);
  const geoDim = dims.find((d) => isGeographic(d));
  let territory: LedeFacts["territory"] = null;
  if (geoDim !== undefined) {
    const territoryCount =
      geoDim.geo_territories !== null && geoDim.geo_territories !== undefined
        ? geoDim.geo_territories.length
        : geoDim.levels.length;
    const geoTiles = tiles.filter((t) => t.dim?.dim_id === geoDim.dim_id);
    let tiltPct: number | null = null;
    for (const t of geoTiles) {
      if (t.span === null) continue;
      const tilt = Math.max(t.span.max - 1, 1 - t.span.min) * 100;
      if (tiltPct === null || tilt > tiltPct) tiltPct = tilt;
    }
    territory = {
      count: territoryCount,
      grain: geoDim.geo_granularity ?? "territory",
      tiltPct,
    };
  }
  return {
    answers: dims.length,
    widest:
      widestTile !== undefined && widestTile.span !== null && widestTile.span.ratio !== null
        ? {
            name: widestTile.table.display_name,
            ratio: widestTile.span.ratio,
          }
        : null,
    territory,
  };
}
