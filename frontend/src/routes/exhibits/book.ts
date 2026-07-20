/**
 * Exhibits — the book's derivations (current Exhibits design).
 *
 * A book is a CSV of risks, one row per risk, columns = the plan's
 * inputs (the Walk-4 recipe). It exists only inside this page: parsed
 * client-side, rated through the SAME projection + policy pipeline the
 * what-if always used (`rateBookSide`), never stored. Wire-string
 * coercion happens at the engine seam (`coercePlanExternalInputs`
 * inside `evaluatePolicyBook`) — nothing here guesses a type.
 *
 * Everything below is pure: parse → submissions → portrait stats /
 * impact movers / refusal changes. The route renders what these
 * return; the tests pin them.
 */

import {
  parseCsvForInputs,
  projectRowsToExternalInputs,
  type RerateBookSubmission,
} from "@openrater/ui";
import {
  resolveBandedLevel,
  resolveCategoricalLevel,
  resolveGeographicValue,
  type DimensionLevel,
  type PolicyBookResult,
} from "@openrater/contracts";
import type {
  PlanDimension,
  PlanFactorTable,
  StageSummary,
} from "@openrater/api-client";
import { cellValueForLevel } from "./anatomy";

/** The client-side MVP cap — above this, refuse with the cap NAMED. */
export const BOOK_ROW_CAP = 2000;

/** Key-column candidates, first present wins; else rows key by index. */
const KEY_COLUMNS = ["case_id", "policy_id", "risk_id", "id"] as const;

export interface ParsedBook {
  readonly filename: string;
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
  readonly keyColumn: string | null;
}

export type ParseBookResult =
  | { readonly ok: true; readonly book: ParsedBook }
  | { readonly ok: false; readonly error: string };

export function parseBook(filename: string, text: string): ParseBookResult {
  const parsed = parseCsvForInputs(text, { maxSampleRows: BOOK_ROW_CAP + 1 });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error.message };
  }
  const snapshot = parsed.snapshot;
  if (snapshot.totalRowCount === 0) {
    return { ok: false, error: `${filename} has a header but no rows.` };
  }
  if (snapshot.totalRowCount > BOOK_ROW_CAP) {
    return {
      ok: false,
      error:
        `${filename} has ${snapshot.totalRowCount.toLocaleString("en-US")} rows — ` +
        `this page rates up to ${BOOK_ROW_CAP.toLocaleString("en-US")} in the browser. ` +
        `Split the file, or run it through the batch API.`,
    };
  }
  const keyColumn =
    KEY_COLUMNS.find((c) => snapshot.columns.includes(c)) ?? null;
  if (keyColumn !== null) {
    const seen = new Set<string>();
    for (const row of snapshot.sample_rows) {
      const key = row[keyColumn] ?? "";
      if (key !== "" && seen.has(key)) {
        return {
          ok: false,
          error:
            `${filename}: duplicate ${keyColumn} ${JSON.stringify(key)} — ` +
            `every row needs its own key so the two sides can be joined.`,
        };
      }
      if (key !== "") seen.add(key);
    }
  }
  return {
    ok: true,
    book: {
      filename,
      columns: snapshot.columns,
      rows: snapshot.sample_rows,
      keyColumn,
    },
  };
}

/**
 * The projection seam (the Walk-4 grammar, same as the live Run path
 * and the Meridian oracle test): the plan's `input_node` stages declare
 * the input dictionary + dtypes; the book's headers ARE the inputs, so
 * the column map is the identity over that dictionary. Unmapped CSV
 * columns (notes, expected_* oracles) never reach the engine.
 */
export function bookProjection(stages: readonly StageSummary[]): {
  readonly columnMap: Readonly<Record<string, string>>;
  readonly inputDtypes: Readonly<
    Record<string, "number" | "boolean" | "date" | "string">
  >;
} {
  const columnMap: Record<string, string> = {};
  const inputDtypes: Record<string, "number" | "boolean" | "date" | "string"> =
    {};
  for (const stage of stages) {
    if (stage.stage_kind !== "input_node") continue;
    const config = stage.config_json;
    if (config["source"] === "derived") continue;
    const field = String(
      config["name"] ?? config["source_path"] ?? stage.stage_id,
    );
    columnMap[field] = field;
    const dt = String(config["data_type"] ?? "string");
    inputDtypes[field] =
      dt === "money" || dt === "int" || dt === "number" || dt === "float"
        ? "number"
        : dt === "bool" || dt === "boolean"
          ? "boolean"
          : dt === "date"
            ? "date"
            : "string";
  }
  return { columnMap, inputDtypes };
}

/** One submission per CSV row — the shape `rateBookSide` rates. With
 *  `stages`, inputs project through the declared dictionary + dtypes
 *  (typed, unmapped columns dropped); without, raw strings pass and
 *  the engine's conservative seam coercion applies. */
export function toSubmissions(
  book: ParsedBook,
  stages?: readonly StageSummary[],
): readonly RerateBookSubmission[] {
  const projection = stages === undefined ? null : bookProjection(stages);
  const projected =
    projection === null
      ? null
      : projectRowsToExternalInputs(book.rows, projection.columnMap, {
          inputDtypes: projection.inputDtypes,
        });
  return book.rows.map((row, i) => {
    const fromColumn =
      book.keyColumn !== null ? (row[book.keyColumn] ?? "") : "";
    const key = fromColumn !== "" ? fromColumn : `row-${i + 1}`;
    return {
      submission_id: key,
      locations: [
        { location_key: "primary", inputs: projected?.[i] ?? row },
      ],
    };
  });
}

// ── Reading one rated policy ─────────────────────────────────────────

/** A policy's premium under a side: composed final first, else the
 *  side's resolved premium field off the rolled totals. Null = not
 *  rateable. */
export function policyPremium(
  result: PolicyBookResult,
  premiumField: string,
): number | null {
  if ((result.row_errors ?? 0) > 0) return null;
  if (result.composed !== undefined && Number.isFinite(result.composed.final))
    return result.composed.final;
  const raw = result.rollup.rolled[premiumField];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** Why a policy has no premium — the NAMED facet, never a blank. */
export function refusalReason(result: PolicyBookResult): string {
  const errors = result.row_errors ?? 0;
  if (errors > 0)
    return `${errors} location row${errors === 1 ? "" : "s"} cannot be rated`;
  return "no premium resolved";
}

// ── Portrait: the book on one plan ───────────────────────────────────

export interface PortraitBookStats {
  readonly count: number;
  readonly rated: number;
  readonly total: number;
  readonly average: number;
  readonly min: number | null;
  readonly max: number | null;
  /** tier → policy count, insertion-ordered by first appearance. */
  readonly tiers: readonly (readonly [string, number])[];
  readonly refused: readonly {
    readonly key: string;
    readonly reason: string;
  }[];
}

export function portraitStats(
  results: readonly PolicyBookResult[],
  premiumField: string,
): PortraitBookStats {
  let total = 0;
  let rated = 0;
  let min: number | null = null;
  let max: number | null = null;
  const tiers = new Map<string, number>();
  const refused: { key: string; reason: string }[] = [];
  for (const result of results) {
    const premium = policyPremium(result, premiumField);
    if (premium === null) {
      refused.push({ key: result.policy_id, reason: refusalReason(result) });
      continue;
    }
    rated += 1;
    total += premium;
    min = min === null ? premium : Math.min(min, premium);
    max = max === null ? premium : Math.max(max, premium);
    const tier = result.appetite.tier;
    tiers.set(tier, (tiers.get(tier) ?? 0) + 1);
  }
  return {
    count: results.length,
    rated,
    total,
    average: rated > 0 ? total / rated : 0,
    min,
    max,
    tiers: [...tiers.entries()],
    refused,
  };
}

// ── Impact: the same book on two sides ───────────────────────────────

export interface BookMover {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly pct: number;
  /** The changed factor that moved most for this risk. Null when no
   *  changed table resolves for the row. */
  readonly driver: string | null;
}

/** One changed 1-D pairing the driver hunt walks. */
export interface DriverPair {
  readonly a: PlanFactorTable;
  readonly b: PlanFactorTable;
  readonly dim: PlanDimension;
}

/**
 * dim slug → the input field that feeds it, harvested from the chain
 * stages' own lookup bindings (`dimensions: { slug: field }` anywhere
 * in a stage's config). The dims usually don't carry `source_field`;
 * the STAGE binding is the authored truth the projector itself reads.
 */
export function dimFieldBindings(
  stages: readonly StageSummary[],
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const record = value as Record<string, unknown>;
    const dims = record["dimensions"];
    if (dims !== null && typeof dims === "object" && !Array.isArray(dims)) {
      for (const [slug, binding] of Object.entries(
        dims as Record<string, unknown>,
      )) {
        // Two authored shapes: a bare field string, or the richer
        // `{ path, source }` binding the ingester writes.
        const field =
          typeof binding === "string"
            ? binding
            : binding !== null &&
                typeof binding === "object" &&
                typeof (binding as { path?: unknown }).path === "string"
              ? (binding as { path: string }).path
              : null;
        if (field !== null && field !== "") out[slug] = field;
      }
    }
    for (const child of Object.values(record)) walk(child);
  };
  for (const stage of stages) walk(stage.config_json);
  return out;
}

/**
 * Name the changed factor that moved most for ONE risk — resolved with
 * the engine's OWN level resolvers (`resolveBandedLevel` /
 * `resolveCategoricalLevel` / `resolveGeographicValue`), so the driver
 * and the premium can never disagree about which cell a row hit.
 * Null when no changed table resolves a differing cell for the row.
 */
export function moverDriver(
  row: Readonly<Record<string, string>>,
  pairs: readonly DriverPair[],
  bindings: Readonly<Record<string, string>> = {},
): string | null {
  let best: string | null = null;
  let bestMove = 0;
  for (const pair of pairs) {
    const dim = pair.dim;
    const column = bindings[dim.slug] ?? dim.source_field ?? dim.slug;
    const raw = row[column] ?? row[dim.dim_id];
    if (raw === undefined || raw === "") continue;
    // Wire levels may omit `aliases`; the contracts resolvers assume
    // the normalized shape (aliases always an array) — default it.
    const levels = (
      dim.levels as readonly Record<string, unknown>[]
    ).map((level) =>
      level["kind"] === "categorical" && !Array.isArray(level["aliases"])
        ? { ...level, aliases: [] }
        : level,
    ) as unknown as readonly DimensionLevel[];
    let key: string | null = null;
    if (dim.dimension_type === "geographic") {
      key = resolveGeographicValue(
        // The wire dim IS the lookup-domain shape; its polymorphic
        // `levels` records widen through unknown (same rows, loose type).
        dim as unknown as Parameters<typeof resolveGeographicValue>[0],
        raw,
      ).key;
    } else if (dim.shape === "banded" || levels[0]?.kind === "banded") {
      const numeric = Number(raw.replace(/[$,\s]/g, ""));
      key = Number.isFinite(numeric)
        ? resolveBandedLevel(levels, numeric)
        : null;
    } else {
      key = resolveCategoricalLevel(levels, raw);
    }
    if (key === null) continue;
    const from = cellValueForLevel(pair.a, dim, key);
    const to = cellValueForLevel(pair.b, dim, key);
    if (from === null || to === null) continue;
    if (Math.abs(from - to) <= 1e-9) continue;
    const move = from !== 0 ? Math.abs(to / from - 1) : Math.abs(to - from);
    if (move > bestMove) {
      bestMove = move;
      best = `${pair.a.slug || pair.a.table_id} ${key} ${from.toFixed(2)}→${to.toFixed(2)}`;
    }
  }
  return best;
}

export interface ImpactStats {
  readonly matched: number;
  readonly aTotal: number;
  readonly bTotal: number;
  readonly deltaPct: number | null;
  readonly up: readonly BookMover[];
  readonly down: readonly BookMover[];
  readonly refusedInB: readonly {
    readonly key: string;
    readonly premium: number;
    readonly reason: string;
  }[];
  readonly refusedInA: readonly {
    readonly key: string;
    readonly premium: number;
    readonly reason: string;
  }[];
}

export function impactStats(
  aResults: readonly PolicyBookResult[],
  bResults: readonly PolicyBookResult[],
  aField: string,
  bField: string,
  driverFor: (policyKey: string) => string | null = () => null,
  moverLimit = 3,
): ImpactStats {
  const bById = new Map(bResults.map((r) => [r.policy_id, r]));
  let matched = 0;
  let aTotal = 0;
  let bTotal = 0;
  const movers: BookMover[] = [];
  const refusedInB: { key: string; premium: number; reason: string }[] = [];
  const refusedInA: { key: string; premium: number; reason: string }[] = [];
  for (const a of aResults) {
    const b = bById.get(a.policy_id);
    if (b === undefined) continue;
    const pa = policyPremium(a, aField);
    const pb = policyPremium(b, bField);
    if (pa !== null && pb === null) {
      refusedInB.push({ key: a.policy_id, premium: pa, reason: refusalReason(b) });
      continue;
    }
    if (pa === null && pb !== null) {
      refusedInA.push({ key: a.policy_id, premium: pb, reason: refusalReason(a) });
      continue;
    }
    if (pa === null || pb === null) continue;
    matched += 1;
    aTotal += pa;
    bTotal += pb;
    if (Math.abs(pb - pa) > 1e-9 && pa !== 0) {
      movers.push({
        key: a.policy_id,
        from: pa,
        to: pb,
        pct: (pb / pa - 1) * 100,
        driver: driverFor(a.policy_id),
      });
    }
  }
  const up = movers
    .filter((m) => m.pct > 0)
    .sort((x, y) => y.pct - x.pct)
    .slice(0, moverLimit);
  const down = movers
    .filter((m) => m.pct < 0)
    .sort((x, y) => x.pct - y.pct)
    .slice(0, moverLimit);
  return {
    matched,
    aTotal,
    bTotal,
    deltaPct: aTotal > 0 ? (bTotal / aTotal - 1) * 100 : null,
    up,
    down,
    refusedInB,
    refusedInA,
  };
}

/** $5,768 / $31.6k — money at band altitude. */
export function fmtMoney(v: number): string {
  if (Math.abs(v) >= 100_000)
    return `$${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 })}k`;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
