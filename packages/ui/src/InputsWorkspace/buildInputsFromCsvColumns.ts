/**
 * Brief 49 — "Create inputs from these columns."
 *
 * Pure transform: a loaded CSV's columns + sample rows → a batch of
 * `DimensionRow`s plus the `column_map` that binds each new input back to
 * its source column. Drives the one-click CTA in the InputsWorkspace empty
 * state (QA findings #1 "loading a CSV creates no inputs" + #7 "no seed
 * levels from CSV").
 *
 * Inference, per column, from the sample:
 *   · every non-empty value numeric → shape "banded", equal-width bands
 *     across [min, max] (empty when there's no range to band, e.g. one
 *     distinct value).
 *   · otherwise                     → shape "categorical", distinct values
 *     seeded as levels, **capped** so identifier columns (acct_id, name)
 *     stay empty rather than fabricate thousands of levels.
 *
 * `deriveRequiredInputs` keys a dim-input on its `slug`, so the returned
 * `columnMap` is `slug → column` — a deterministic, fully-mapped result, not
 * a reliance on fuzzy auto-match.
 *
 * Levels are built directly (`slugify(value)` id, verbatim label) — NOT via
 * `parseLevelPaste`, which splits on the first comma and would corrupt CSV
 * values like `"Riverside Youth Foundation, Inc"`.
 */
import { generateEqualWidthBands } from "../DimensionEditor/banded-utils";
import { slugifyLabel } from "../DimensionEditor/LevelRowsTable";
import type { DimensionRow } from "../DimensionsTable";

/**
 * Mirrors parseCsv's number detection: digits with optional comma thousands
 * separators and an optional decimal, optionally negative.
 */
const NUMBER_RE = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;

export interface BuildInputsOptions {
  /** Slugs already taken by existing dims; new slugs dedupe against these. */
  readonly existingSlugs?: readonly string[];
  /** Max distinct values seeded as categorical levels (default 50). */
  readonly levelCap?: number;
  /** Equal-width bands seeded for numeric columns (default 5). */
  readonly bandCount?: number;
}

export interface BuildInputsResult {
  /** New dimensions to append to the plan. */
  readonly dims: readonly DimensionRow[];
  /** `slug → source column`. Merge into `PlanInputMapping.column_map`. */
  readonly columnMap: Readonly<Record<string, string>>;
  /** Categorical dims that got levels seeded from the data. */
  readonly seededCount: number;
  /** Categorical dims left with empty levels (high cardinality / no values). */
  readonly emptyCount: number;
  /** Numeric dims created as banded. */
  readonly bandedCount: number;
}

/** Reserve a unique slug against `taken`, suffixing `_2`, `_3`, … on collision. */
function reserveSlug(base: string, taken: Set<string>): string {
  const root = base === "" ? "input" : base;
  let slug = root;
  let n = 2;
  while (taken.has(slug)) {
    slug = `${root}_${n}`;
    n += 1;
  }
  taken.add(slug);
  return slug;
}

/** Non-empty, trimmed string values for one column across the sample rows. */
function columnValues(
  rows: readonly Readonly<Record<string, unknown>>[],
  column: string,
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const raw = row[column];
    if (raw === null || raw === undefined) continue;
    const s = String(raw).trim();
    if (s !== "") out.push(s);
  }
  return out;
}

function isNumericColumn(values: readonly string[]): boolean {
  return values.length > 0 && values.every((v) => NUMBER_RE.test(v));
}

function distinctInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function buildInputsFromCsvColumns(
  columns: readonly string[],
  sampleRows: readonly Readonly<Record<string, unknown>>[],
  options: BuildInputsOptions = {},
): BuildInputsResult {
  const levelCap = options.levelCap ?? 50;
  const bandCount = options.bandCount ?? 5;
  const takenSlugs = new Set<string>(options.existingSlugs ?? []);

  const dims: DimensionRow[] = [];
  const columnMap: Record<string, string> = {};
  let seededCount = 0;
  let emptyCount = 0;
  let bandedCount = 0;

  for (const column of columns) {
    const values = columnValues(sampleRows, column);
    const slug = reserveSlug(slugifyLabel(column), takenSlugs);
    columnMap[slug] = column;

    if (isNumericColumn(values)) {
      const nums = values.map((v) => Number(v.replace(/,/g, "")));
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      // Bands are half-open [lo, hi). Without headroom the MAX sample
      // value lands exactly on the exclusive top boundary and reads as a
      // mismatch on first run (a value == the final `hi` matches no band).
      // Pad the upper bound so every sample value is strictly interior:
      // +1 for integer columns (keeps band edges tidy for counts), a small
      // relative epsilon otherwise. The user refines these ranges anyway.
      const span = max - min;
      const paddedMax =
        span === 0
          ? max + 1
          : nums.every(Number.isInteger)
            ? max + 1
            : max + span * 1e-4;
      const bands = generateEqualWidthBands(min, paddedMax, bandCount);
      dims.push({
        id: slug,
        slug,
        display_name: column,
        data_type: "number",
        role: "rating-input",
        dimension_type: "standard",
        shape: "banded",
        levels: bands.map((l) => ({
          kind: "banded" as const,
          id: l.id,
          label: l.label,
          lo: l.lo!,
          hi: l.hi!,
        })),
      });
      bandedCount += 1;
      continue;
    }

    const distinct = distinctInOrder(values);
    const seed = distinct.length > 0 && distinct.length <= levelCap;
    const levelSlugs = new Set<string>();
    const levels = seed
      ? distinct.map((v) => ({
          kind: "categorical" as const,
          id: reserveSlug(slugifyLabel(v), levelSlugs),
          label: v,
        }))
      : [];
    if (seed) seededCount += 1;
    else emptyCount += 1;

    dims.push({
      id: slug,
      slug,
      display_name: column,
      data_type: "string",
      role: "rating-input",
      dimension_type: "standard",
      shape: "categorical",
      levels,
    });
  }

  return { dims, columnMap, seededCount, emptyCount, bandedCount };
}
