/**
 * probe-math — Brief 89 §3 (89.3): analytics before data, pure math.
 *
 * The plan is a data generator. Everything here derives from the
 * AUTHORED substrate alone — no book, no fabrication:
 *
 *   · computeStructuralDrivers — per-variable swing from authored
 *     factor spreads (max/min authored cell value across the tables
 *     keyed by the dim). "Structural — unweighted by any book": it
 *     ranks what the plan CAN do to premium, not what a book mix did.
 *     Flat/tableless variables rank last, honestly labeled.
 *
 *   · rate-card helpers — axis candidates (keyable dims), the runtime
 *     input key per dim (via deriveRequiredInputs — the SAME key the
 *     engine reads), the representative value per level (mirroring
 *     synthesizeRepresentativeRisk's shapes: banded → an in-range raw
 *     number, categorical/geo → the level id), the bounded cartesian
 *     grid, and the CSV serialization of a scored card.
 *
 * Pure data-in / data-out — no React, no I/O. Tested.
 */

import type { DimensionRow } from "../DimensionsTable";
import { levelsForKeying } from "../keying";
import {
  deriveRequiredInputs,
  type FactorTableLike,
  type StageLike,
} from "../InputsWorkspace/deriveRequiredInputs";

// ─────────────────────────────────────────────────────────────────
// Structural drivers (R9 B2)
// ─────────────────────────────────────────────────────────────────

export interface StructuralDriver {
  /** Dim slug — the variable's identity. */
  readonly id: string;
  readonly label: string;
  /** max/min authored factor across the dim's tables (null → flat). */
  readonly swing: number | null;
  readonly spreadMin: number | null;
  readonly spreadMax: number | null;
  /** Tables keyed by this dim that carry authored cells. */
  readonly tableCount: number;
  /** True when nothing authored differentiates this variable. */
  readonly flat: boolean;
}

interface CellsLike {
  readonly get: (
    tableId: string,
  ) => ReadonlyMap<string, string | number> | undefined;
}

function tablesKeyedBy(
  factorTables: readonly FactorTableLike[],
  slug: string,
): readonly FactorTableLike[] {
  return factorTables.filter((t) => {
    const keys = t.key_dimensions ?? (t.key_dimension ? [t.key_dimension] : []);
    return keys.includes(slug);
  });
}

/**
 * Rank every dimension by its AUTHORED premium leverage. A 2-D table's
 * spread attributes to BOTH keying dims (the spread exists along both
 * axes of the authored grid — v1 keeps attribution simple + honest).
 */
export function computeStructuralDrivers(
  dimensions: readonly DimensionRow[],
  factorTables: readonly FactorTableLike[],
  cells: CellsLike | undefined,
): readonly StructuralDriver[] {
  const out: StructuralDriver[] = [];
  for (const dim of dimensions) {
    const tables = tablesKeyedBy(factorTables, dim.slug);
    let min: number | null = null;
    let max: number | null = null;
    let tableCount = 0;
    for (const t of tables) {
      const tCells = cells?.get(t.id);
      if (!tCells || tCells.size === 0) continue;
      let saw = false;
      for (const v of tCells.values()) {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) continue;
        saw = true;
        if (min === null || n < min) min = n;
        if (max === null || n > max) max = n;
      }
      if (saw) tableCount += 1;
    }
    const swing =
      min !== null && max !== null && min > 0 && max > min ? max / min : null;
    out.push({
      id: dim.slug,
      label: dim.display_name || dim.slug,
      swing,
      spreadMin: min,
      spreadMax: max,
      tableCount,
      flat: swing === null,
    });
  }
  // Biggest authored leverage first; flat/tableless last, alpha within.
  return out.sort((a, b) => {
    if (a.swing !== null && b.swing !== null) return b.swing - a.swing;
    if (a.swing !== null) return -1;
    if (b.swing !== null) return 1;
    return a.label.localeCompare(b.label);
  });
}

// ─────────────────────────────────────────────────────────────────
// Rate card (R9 B1)
// ─────────────────────────────────────────────────────────────────

export interface RateCardLevel {
  readonly id: string;
  readonly label: string;
  /** The externalInputs value this level represents (banded → raw
   *  in-range number; categorical/geo → the level id). */
  readonly value: string | number;
}

export interface RateCardAxis {
  readonly dimSlug: string;
  readonly label: string;
  /** The runtime input key the engine reads for this dim. */
  readonly inputKey: string;
  readonly levels: readonly RateCardLevel[];
  /** Levels beyond the cap, not rendered (honest count; 0 = none). */
  readonly truncated: number;
}

/** Dims that can key a card: they carry keyable levels. */
export function probeAxisCandidates(
  dimensions: readonly DimensionRow[],
): readonly DimensionRow[] {
  return dimensions.filter((d) => levelsForKeying(d).length > 0);
}

function isBanded(dim: DimensionRow): boolean {
  return (dim as { shape?: string }).shape === "banded";
}

/** Mirror synthesizeRepresentativeRisk's value shapes per level. */
export function axisValueForLevel(
  dim: DimensionRow,
  level: { readonly id: string; readonly label?: string; readonly lo?: unknown },
): string | number {
  if (isBanded(dim) && typeof level.lo === "number") return level.lo;
  return level.id;
}

/**
 * The runtime input key per dim slug — the id `deriveRequiredInputs`
 * assigns (the SAME string `stagesToRuntimePlan` reads inputs under).
 * Falls back to the slug for dims the structure doesn't reference yet.
 */
export function dimInputKeys(
  stages: readonly StageLike[],
  dimensions: readonly DimensionRow[],
  factorTables: readonly FactorTableLike[],
): ReadonlyMap<string, string> {
  const derived = deriveRequiredInputs(
    stages,
    // The deriver reads slug/display_name/shape — DimensionRow carries all.
    dimensions as unknown as Parameters<typeof deriveRequiredInputs>[1],
    { factorTables },
  );
  const map = new Map<string, string>();
  for (const d of derived) {
    if (d.dimSlug && !map.has(d.dimSlug)) map.set(d.dimSlug, d.id);
  }
  for (const dim of dimensions) {
    if (!map.has(dim.slug)) map.set(dim.slug, dim.slug);
  }
  return map;
}

export function buildAxis(
  dim: DimensionRow,
  inputKey: string,
  levelCap: number,
): RateCardAxis {
  const all = levelsForKeying(dim);
  const kept = all.slice(0, levelCap);
  return {
    dimSlug: dim.slug,
    label: dim.display_name || dim.slug,
    inputKey,
    levels: kept.map((l) => ({
      id: l.id,
      label: l.label || l.id,
      value: axisValueForLevel(dim, l as { id: string; lo?: unknown }),
    })),
    truncated: Math.max(0, all.length - kept.length),
  };
}

export interface RateCardCellSpec {
  readonly rowLevelId: string;
  readonly colLevelId: string | null;
  /** Full externalInputs for the engine: pins overridden by the axes. */
  readonly inputs: Readonly<Record<string, unknown>>;
}

/**
 * The bounded cartesian: representative pins × row levels (× col
 * levels when a second axis is set). Row-major — cell order matches
 * reading order, so the scorer's results zip back positionally.
 */
export function buildRateCardGrid(
  pins: Readonly<Record<string, unknown>>,
  rowAxis: RateCardAxis,
  colAxis: RateCardAxis | null,
): readonly RateCardCellSpec[] {
  const out: RateCardCellSpec[] = [];
  for (const r of rowAxis.levels) {
    if (colAxis === null) {
      out.push({
        rowLevelId: r.id,
        colLevelId: null,
        inputs: { ...pins, [rowAxis.inputKey]: r.value },
      });
      continue;
    }
    for (const c of colAxis.levels) {
      out.push({
        rowLevelId: r.id,
        colLevelId: c.id,
        inputs: {
          ...pins,
          [rowAxis.inputKey]: r.value,
          [colAxis.inputKey]: c.value,
        },
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Probe book (89.4, B3) — the sweep + the readout math
// ─────────────────────────────────────────────────────────────────

export interface ProbeSweep {
  /** Row 0 is ALWAYS the pure representative base — the reference
   *  cell every later attribution diffs against. */
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  /** Cells dropped by the cap (honest count; 0 = full coverage). */
  readonly truncated: number;
  /** Input keys the sweep varies, in axis-rank order. */
  readonly variables: readonly string[];
}

function sweepKey(row: Readonly<Record<string, unknown>>): string {
  return Object.entries(row)
    .map(([k, v]) => `${k} ${String(v)}`)
    .sort()
    .join("");
}

/**
 * One-at-a-time sweeps per variable off the base pins, plus the
 * top-2-axes cross (axes arrive rank-ordered), capped. Deterministic
 * and duplicate-free — a level equal to the base's pin produces the
 * base row again and is skipped, so the scored space is exactly the
 * distinct cells.
 */
export function buildProbeSweep(
  pins: Readonly<Record<string, unknown>>,
  axes: readonly RateCardAxis[],
  cap: number,
): ProbeSweep {
  const rows: Readonly<Record<string, unknown>>[] = [{ ...pins }];
  const seen = new Set<string>([sweepKey(pins)]);
  let truncated = 0;
  const push = (row: Readonly<Record<string, unknown>>): void => {
    const key = sweepKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    if (rows.length >= cap) {
      truncated += 1;
      return;
    }
    rows.push(row);
  };
  for (const axis of axes) {
    for (const level of axis.levels) {
      push({ ...pins, [axis.inputKey]: level.value });
    }
  }
  const [a, b] = axes;
  if (a && b) {
    for (const la of a.levels) {
      for (const lb of b.levels) {
        push({ ...pins, [a.inputKey]: la.value, [b.inputKey]: lb.value });
      }
    }
  }
  return { rows, truncated, variables: axes.map((x) => x.inputKey) };
}

/**
 * The default sweep off the plan's authored substrate: every keyable
 * dim becomes an axis (levels capped like the rate card's rows),
 * ranked by authored structural swing so the top-2 cross covers the
 * plan's biggest levers. One call for the mount — the same ranking
 * the rate card defaults to.
 */
export function buildDefaultProbeSweep(args: {
  readonly stages: readonly StageLike[];
  readonly dimensions: readonly DimensionRow[];
  readonly factorTables: readonly FactorTableLike[];
  readonly cells?: CellsLike | undefined;
  readonly pins: Readonly<Record<string, unknown>>;
  readonly levelCap?: number;
  readonly cap?: number;
}): ProbeSweep {
  const { stages, dimensions, factorTables, cells, pins } = args;
  const levelCap = args.levelCap ?? 20;
  const cap = args.cap ?? 500;
  const candidates = probeAxisCandidates(dimensions);
  const keys = dimInputKeys(stages, dimensions, factorTables);
  const drivers = computeStructuralDrivers(candidates, factorTables, cells);
  const order = new Map(drivers.map((d, i) => [d.id, i] as const));
  const axes = [...candidates]
    .sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99))
    .map((dim) => buildAxis(dim, keys.get(dim.slug) ?? dim.slug, levelCap));
  return buildProbeSweep(pins, axes, cap);
}

/** One persisted probe row, as the runs store returns it (the book
 *  path's projected inputs + outputs + verdict). */
export interface ProbeResultRow {
  readonly inputs?: Readonly<Record<string, unknown>> | undefined;
  readonly outputs?: Readonly<Record<string, unknown>> | undefined;
  readonly row_status?: string | undefined;
  readonly eligibility_tier?: string | undefined;
}

export interface ProbeVariableReadout {
  readonly inputKey: string;
  /** Cells attributed to this variable's one-at-a-time sweep (incl.
   *  the base cell — it carries the variable's representative level). */
  readonly cells: number;
  readonly premiumMin: number | null;
  readonly premiumMax: number | null;
  /** max/min over the variable's written premiums (null → flat or
   *  nothing written along this sweep). */
  readonly swing: number | null;
  readonly declined: number;
  /** Which swept values declined, worst-first — the gate-coverage
   *  attribution ("Fire Resistive → declined"). */
  readonly declinedValues: readonly { value: string; count: number }[];
}

export interface ProbeReadout {
  readonly total: number;
  readonly priced: number;
  readonly declined: number;
  readonly errors: number;
  /** Range over PRICED (non-declined, non-error) cells. */
  readonly premiumMin: number | null;
  readonly premiumMax: number | null;
  readonly variables: readonly ProbeVariableReadout[];
  /** Cells that varied 2+ keys (the axes cross). */
  readonly crossCells: number;
  /** The representative base itself declines — every readout line
   *  inherits that verdict, so the card says it out loud. */
  readonly baseDeclined: boolean;
}

interface CellFacet {
  readonly premium: number | null;
  readonly declined: boolean;
  readonly error: boolean;
}

function facetOf(
  row: ProbeResultRow,
  premiumColumn: string,
): CellFacet {
  const error = row.row_status === "error";
  const declined = !error && row.eligibility_tier === "decline";
  const raw = row.outputs?.[premiumColumn];
  const premium =
    !error && !declined && typeof raw === "number" && Number.isFinite(raw)
      ? raw
      : null;
  return { premium, declined, error };
}

/**
 * The probe-book readout, derived from the persisted rows alone.
 * Attribution is a diff against row 0 (the base): the key(s) where a
 * row's PROJECTED inputs differ name the variable it swept — no
 * side-channel sweep spec to drift out of sync with what was scored.
 * Values compare as strings because the projection layer's dtype
 * coercion is applied to base and sweep rows alike.
 */
export function analyzeProbeRows(
  rows: readonly ProbeResultRow[],
  premiumColumn: string,
): ProbeReadout | null {
  const base = rows[0];
  if (!base) return null;
  const baseInputs = base.inputs ?? {};
  const baseFacet = facetOf(base, premiumColumn);

  interface VarAcc {
    cells: number;
    min: number | null;
    max: number | null;
    declined: number;
    declinedValues: Map<string, number>;
  }
  const vars = new Map<string, VarAcc>();
  const varAcc = (key: string): VarAcc => {
    let acc = vars.get(key);
    if (!acc) {
      acc = {
        cells: 0,
        min: null,
        max: null,
        declined: 0,
        declinedValues: new Map(),
      };
      vars.set(key, acc);
    }
    return acc;
  };
  const foldPremium = (acc: VarAcc, premium: number | null): void => {
    if (premium === null) return;
    if (acc.min === null || premium < acc.min) acc.min = premium;
    if (acc.max === null || premium > acc.max) acc.max = premium;
  };

  let priced = 0;
  let declined = 0;
  let errors = 0;
  let crossCells = 0;
  let premiumMin: number | null = null;
  let premiumMax: number | null = null;

  for (const [i, row] of rows.entries()) {
    const facet = facetOf(row, premiumColumn);
    if (facet.error) errors += 1;
    else if (facet.declined) declined += 1;
    else if (facet.premium !== null) {
      priced += 1;
      if (premiumMin === null || facet.premium < premiumMin)
        premiumMin = facet.premium;
      if (premiumMax === null || facet.premium > premiumMax)
        premiumMax = facet.premium;
    }
    if (i === 0) continue;

    const inputs = row.inputs ?? {};
    const keys = new Set([...Object.keys(baseInputs), ...Object.keys(inputs)]);
    const diff: string[] = [];
    for (const k of keys) {
      if (String(baseInputs[k] ?? "") !== String(inputs[k] ?? "")) diff.push(k);
    }
    if (diff.length !== 1) {
      if (diff.length > 1) crossCells += 1;
      continue;
    }
    const key = diff[0]!;
    const acc = varAcc(key);
    acc.cells += 1;
    foldPremium(acc, facet.premium);
    if (facet.declined) {
      acc.declined += 1;
      const v = String(inputs[key] ?? "");
      acc.declinedValues.set(v, (acc.declinedValues.get(v) ?? 0) + 1);
    }
  }

  // The base cell belongs to every swept variable's range (it carries
  // that variable's representative level).
  for (const acc of vars.values()) {
    acc.cells += 1;
    foldPremium(acc, baseFacet.premium);
  }

  const variables: ProbeVariableReadout[] = [...vars.entries()]
    .map(([inputKey, acc]) => ({
      inputKey,
      cells: acc.cells,
      premiumMin: acc.min,
      premiumMax: acc.max,
      swing:
        acc.min !== null && acc.max !== null && acc.min > 0 && acc.max > acc.min
          ? acc.max / acc.min
          : null,
      declined: acc.declined,
      declinedValues: [...acc.declinedValues.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => {
      if (a.swing !== null && b.swing !== null) return b.swing - a.swing;
      if (a.swing !== null) return -1;
      if (b.swing !== null) return 1;
      return a.inputKey.localeCompare(b.inputKey);
    });

  return {
    total: rows.length,
    priced,
    declined,
    errors,
    premiumMin,
    premiumMax,
    variables,
    crossCells,
    baseDeclined: baseFacet.declined,
  };
}

export interface RateCardCellResult {
  readonly rowLevelId: string;
  readonly colLevelId: string | null;
  /** Premium in dollars; null → no number (withheld / declined). */
  readonly premium: number | null;
  /** "decline" | "referral" | … when a gate fired; null otherwise. */
  readonly tier: string | null;
  /** The refusal's plan-words note when premium is withheld. */
  readonly note: string | null;
}

/** Serialize a scored card to CSV (the artifact actuaries circulate). */
export function buildRateCardCsv(
  rowAxis: RateCardAxis,
  colAxis: RateCardAxis | null,
  cells: readonly RateCardCellResult[],
): string {
  const esc = (s: string): string =>
    /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const byKey = new Map(
    cells.map((c) => [`${c.rowLevelId} ${c.colLevelId ?? ""}`, c] as const),
  );
  const cellText = (c: RateCardCellResult | undefined): string => {
    if (!c) return "";
    // Cents precision — a raw float's 1379.3999999999999 is noise,
    // not honesty.
    if (c.premium !== null) return String(Math.round(c.premium * 100) / 100);
    return c.tier === "decline" ? "declined" : (c.note ?? "withheld");
  };
  const lines: string[] = [];
  if (colAxis === null) {
    lines.push([esc(rowAxis.label), "premium"].join(","));
    for (const r of rowAxis.levels) {
      lines.push(
        [esc(r.label), cellText(byKey.get(`${r.id} `))].join(","),
      );
    }
  } else {
    lines.push(
      [esc(rowAxis.label), ...colAxis.levels.map((c) => esc(c.label))].join(
        ",",
      ),
    );
    for (const r of rowAxis.levels) {
      lines.push(
        [
          esc(r.label),
          ...colAxis.levels.map((c) =>
            cellText(byKey.get(`${r.id} ${c.id}`)),
          ),
        ].join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
